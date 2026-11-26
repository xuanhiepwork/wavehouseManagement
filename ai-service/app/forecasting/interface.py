"""Future AI2 provider boundary and an explicitly nonpredictive AI1 response."""

from datetime import datetime, time, timezone
from typing import Protocol
from zoneinfo import ZoneInfo

from ..schemas.common import (
    AvailabilityStatus, CoverageStatus, DemandBasis, ForecastStatus,
)
from ..schemas.inputs import ForecastRequest
from ..schemas.outputs import (
    ForecastCoverage, ForecastPrediction, ForecastResponse, QualityWarning,
)

LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


class ForecastProvider(Protocol):
    """AI2 must implement this interface without write permissions to business data."""

    def forecast(self, request: ForecastRequest) -> ForecastResponse:
        ...


def unconfigured_forecast(request: ForecastRequest) -> ForecastResponse:
    """AI1 cannot predict: return explicit missing-model/data statuses, never fake numbers."""
    cutoff = datetime.combine(request.business_date, time.min, tzinfo=LOCAL_TZ)
    predictions: list[ForecastPrediction] = []
    for item in request.ingredients:
        verified = [
            row for row in request.historical_observations
            if row.branch_id == request.branch_id
            and row.ingredient_id == item.id
            and row.shift == request.shift
            and row.unit == item.unit
            and row.business_date < request.business_date
            and row.available_at < cutoff
            and row.basis == DemandBasis.VERIFIED_HISTORICAL_THEORETICAL
            and row.coverage == CoverageStatus.COMPLETE
            and row.approved_report_count == 1
            and row.recipe_coverage == 1
            and row.availability in (
                AvailabilityStatus.APPROVED_RECORDED_SALES,
                AvailabilityStatus.APPROVED_ZERO_SALES,
            )
        ]
        approximate = [
            row for row in request.historical_observations
            if row.branch_id == request.branch_id
            and row.ingredient_id == item.id
            and row.shift == request.shift
            and row.business_date < request.business_date
            and row.available_at < cutoff
            and row.basis == DemandBasis.APPROXIMATE_CURRENT_RECIPE
        ]
        status = (ForecastStatus.MODEL_NOT_CONFIGURED if verified and item.unit is not None and item.available_at < cutoff
                  else ForecastStatus.INSUFFICIENT_DATA)
        code = ("MODEL_NOT_CONFIGURED" if status == ForecastStatus.MODEL_NOT_CONFIGURED
                else "NO_VERIFIED_HISTORY")
        predictions.append(ForecastPrediction(
            ingredient_id=item.id, unit=item.unit, status=status,
            data_coverage=ForecastCoverage(
                verified_observations=len(verified),
                approximate_observations=len(approximate),
                complete_slots=len({(r.business_date, r.shift) for r in verified}),
            ),
            warnings=(QualityWarning(
                code=code, severity="INFO",
                message="AI1 has no trained forecasting model or adequate verified observations.",
                ingredient_id=item.id,
            ),),
        ))
    overall = (
        ForecastStatus.MODEL_NOT_CONFIGURED
        if any(row.status == ForecastStatus.MODEL_NOT_CONFIGURED for row in predictions)
        else ForecastStatus.INSUFFICIENT_DATA
    )
    return ForecastResponse(
        branch_id=request.branch_id,
        business_date=request.business_date,
        shift=request.shift,
        predictions=tuple(predictions),
        generated_at=datetime.now(timezone.utc),
        status=overall,
    )
