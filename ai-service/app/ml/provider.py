"""AI2 ForecastProvider backed by explicitly trained ridge model artifacts.

Inference is advisory and read-only. It neither reads the database nor invokes
B7 or stock-document APIs. Missing models/data never produce fabricated values.
"""

from datetime import datetime, time, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from math import isfinite
from zoneinfo import ZoneInfo

from ..features.engineer import prepare_features
from ..schemas.common import (
    AvailabilityStatus, CoverageStatus, DemandBasis, ForecastStatus,
    IngredientUnit,
)
from ..schemas.inputs import ForecastRequest
from ..schemas.outputs import (
    ForecastCoverage, ForecastPrediction, ForecastResponse, QualityWarning,
)
from .dataset import SeriesKey, encode_features, feature_names
from .training import ModelRegistry

LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _quantity(number: float, unit: IngredientUnit, rounding: str) -> Decimal:
    if not isfinite(number) or number < 0:
        raise ValueError("Invalid ML prediction quantity")
    quantum = Decimal("1") if unit == IngredientUnit.piece else Decimal("0.000001")
    return Decimal(str(number)).quantize(quantum, rounding=rounding)


def _coverage(request: ForecastRequest, ingredient_id, unit) -> ForecastCoverage:
    cutoff = datetime.combine(request.business_date, time.min, tzinfo=LOCAL_TZ)
    rows = [
        row for row in request.historical_observations
        if row.branch_id == request.branch_id
        and row.ingredient_id == ingredient_id
        and row.shift == request.shift
        and row.business_date < request.business_date
        and row.available_at < cutoff
    ]
    verified = [
        row for row in rows
        if row.unit == unit
        and row.basis == DemandBasis.VERIFIED_HISTORICAL_THEORETICAL
        and row.coverage == CoverageStatus.COMPLETE
        and row.approved_report_count == 1
        and row.recipe_coverage == Decimal("1")
        and row.availability in (
            AvailabilityStatus.APPROVED_ZERO_SALES,
            AvailabilityStatus.APPROVED_RECORDED_SALES,
        )
    ]
    approximate = [row for row in rows if row.basis == DemandBasis.APPROXIMATE_CURRENT_RECIPE]
    return ForecastCoverage(
        verified_observations=len(verified),
        approximate_observations=len(approximate),
        complete_slots=len({(row.business_date, row.shift) for row in verified}),
        recipe_coverage=Decimal("1") if verified else None,
    )


class TrainedRidgeForecastProvider:
    """Implements the AI1 ForecastProvider protocol without side effects."""

    def __init__(self, registry: ModelRegistry) -> None:
        self.registry = registry
        self._models = {model.key: model for model in registry.models}
        if len(self._models) != len(registry.models):
            raise ValueError("Duplicate trained model keys")

    def forecast(self, request: ForecastRequest) -> ForecastResponse:
        cutoff = datetime.combine(request.business_date, time.min, tzinfo=LOCAL_TZ)
        features = prepare_features(request, self.registry.settings)
        predictions: list[ForecastPrediction] = []
        for ingredient, feature in zip(request.ingredients, features):
            coverage = _coverage(request, ingredient.id, ingredient.unit)
            warnings = [
                QualityWarning(
                    code=code, severity="WARNING",
                    message=f"AI1 feature quality flag: {code}",
                    ingredient_id=ingredient.id,
                ) for code in feature.warnings
            ]
            model = None
            if ingredient.unit is not None:
                model = self._models.get(SeriesKey(
                    request.branch_id, ingredient.id, ingredient.unit, request.shift,
                ))
            if (not feature.ready_for_model or ingredient.unit is None
                    or "AMBIGUOUS_CALENDAR_SIGNAL" in feature.warnings):
                status = ForecastStatus.INSUFFICIENT_DATA
                code = "INSUFFICIENT_VERIFIED_HISTORY"
            elif model is None:
                status = ForecastStatus.MODEL_NOT_CONFIGURED
                code = "NO_TRAINED_MODEL_FOR_SERIES"
            elif (model.trained_at >= cutoff
                    or model.feature_names != feature_names(self.registry.settings)):
                status = ForecastStatus.MODEL_NOT_CONFIGURED
                code = "MODEL_NOT_AVAILABLE_AS_OF_DATE"
            else:
                try:
                    raw = model.parameters.predict(encode_features(feature, self.registry.settings))
                    radius = model.metrics.residual_radius
                    if not isfinite(radius) or radius < 0:
                        raise ValueError("Invalid validation residual radius")
                    prediction = _quantity(raw, ingredient.unit, ROUND_HALF_UP if ingredient.unit != IngredientUnit.piece else ROUND_CEILING)
                    lower = _quantity(max(0.0, raw - radius), ingredient.unit, ROUND_FLOOR)
                    upper = _quantity(raw + radius, ingredient.unit, ROUND_CEILING)
                    predictions.append(ForecastPrediction(
                        ingredient_id=ingredient.id, unit=ingredient.unit,
                        status=ForecastStatus.AVAILABLE,
                        predicted_demand=prediction,
                        uncertainty_lower=lower,
                        uncertainty_upper=upper,
                        model_version=model.model_version,
                        data_coverage=coverage,
                        warnings=tuple(warnings),
                    ))
                    continue
                except (ArithmeticError, ValueError, OverflowError):
                    status = ForecastStatus.MODEL_NOT_CONFIGURED
                    code = "MODEL_NUMERIC_OUTPUT_INVALID"
            warnings.append(QualityWarning(
                code=code, severity="WARNING",
                message="The AI model cannot return a supported forecast for this series.",
                ingredient_id=ingredient.id,
            ))
            predictions.append(ForecastPrediction(
                ingredient_id=ingredient.id, unit=ingredient.unit,
                status=status, data_coverage=coverage,
                warnings=tuple(warnings),
            ))

        overall = (
            ForecastStatus.AVAILABLE
            if any(row.status == ForecastStatus.AVAILABLE for row in predictions)
            else ForecastStatus.MODEL_NOT_CONFIGURED
            if any(row.status == ForecastStatus.MODEL_NOT_CONFIGURED for row in predictions)
            else ForecastStatus.INSUFFICIENT_DATA
        )
        return ForecastResponse(
            branch_id=request.branch_id, business_date=request.business_date,
            shift=request.shift, predictions=tuple(predictions),
            generated_at=datetime.now(timezone.utc), status=overall,
        )
