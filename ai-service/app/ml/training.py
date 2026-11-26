"""Chronologically validated, per-branch/ingredient/shift AI2 ridge models.

Training is an explicit function call, NEVER triggered on import. No file, DB,
HTTP or inventory side effects. The returned JSON-compatible document may later
be stored by a trusted deployment process after the final QA phase.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timezone
from hashlib import sha256
from json import dumps
from math import ceil, isfinite, sqrt
from uuid import UUID
from zoneinfo import ZoneInfo

from ..config.settings import FeatureSettings
from ..schemas.common import IngredientUnit, Shift
from ..schemas.inputs import CalendarSignal, IngredientRecord
from ..schemas.outputs import PreparedDataset
from .dataset import (
    SampleBuildReport, SeriesKey, TrainingSample, build_supervised_samples,
    feature_names,
)
from .ridge import RidgeParameters, fit_ridge

ARTIFACT_SCHEMA = "AI2_RIDGE_V1"
LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


@dataclass(frozen=True)
class TrainingConfig:
    minimum_examples: int = 32
    minimum_training_examples: int = 24
    minimum_distinct_dates: int = 32
    validation_dates: int = 8
    ridge_alpha: float = 8.0
    residual_quantile: float = 0.90

    def __post_init__(self) -> None:
        if (self.minimum_examples < 3 or self.minimum_training_examples < 2
                or self.minimum_distinct_dates < 3 or self.validation_dates < 2
                or self.minimum_training_examples + self.validation_dates > self.minimum_examples):
            raise ValueError("Insufficient chronological train/validation minimums")
        if (not isfinite(self.ridge_alpha) or self.ridge_alpha <= 0
                or not 0 < self.residual_quantile < 1):
            raise ValueError("Invalid regularization or residual quantile")


@dataclass(frozen=True)
class ValidationMetrics:
    validation_count: int
    from_date: str
    to_date: str
    mae: float
    rmse: float
    wape: float | None
    residual_radius: float
    residual_quantile: float


@dataclass(frozen=True)
class TrainedSeries:
    key: SeriesKey
    model_version: str
    trained_at: datetime
    first_training_date: str
    last_training_date: str
    training_count: int
    ridge_alpha: float
    feature_names: tuple[str, ...]
    parameters: RidgeParameters
    metrics: ValidationMetrics


@dataclass(frozen=True)
class TrainingSkip:
    series: SeriesKey
    reason: str
    available_examples: int


@dataclass(frozen=True)
class ModelRegistry:
    trained_at: datetime
    settings: FeatureSettings
    models: tuple[TrainedSeries, ...]
    skipped: tuple[TrainingSkip, ...]
    source_report: SampleBuildReport

    def to_document(self) -> dict:
        """JSON-safe artifact. Never use pickle or embed credentials."""
        return {
            "schemaVersion": ARTIFACT_SCHEMA,
            "trainedAt": self.trained_at.isoformat(),
            "featureSettings": {
                "lagDays": list(self.settings.lag_days),
                "rollingDays": list(self.settings.rolling_days),
                "minimumVerifiedObservations": self.settings.minimum_verified_observations,
            },
            "models": [_model_document(model) for model in self.models],
            "skipped": [{"series": _series_document(row.series),
                         "reason": row.reason, "availableExamples": row.available_examples}
                        for row in self.skipped],
            "sourceReport": {
                "accepted": self.source_report.accepted,
                "skipped": self.source_report.skipped,
                "skippedReasons": [list(row) for row in self.source_report.skipped_reasons],
            },
        }

    def to_json(self) -> str:
        return dumps(self.to_document(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _series_document(key: SeriesKey) -> dict:
    return {
        "branchId": str(key.branch_id), "ingredientId": str(key.ingredient_id),
        "unit": key.unit.value, "shift": key.shift.value,
    }


def _parameters_document(parameters: RidgeParameters) -> dict:
    return {
        "center": list(parameters.center), "scale": list(parameters.scale),
        "intercept": parameters.intercept, "weights": list(parameters.weights),
    }


def _metrics_document(metrics: ValidationMetrics) -> dict:
    return {
        "validationCount": metrics.validation_count,
        "fromDate": metrics.from_date, "toDate": metrics.to_date,
        "mae": metrics.mae, "rmse": metrics.rmse, "wape": metrics.wape,
        "residualRadius": metrics.residual_radius,
        "residualQuantile": metrics.residual_quantile,
    }


def _model_content(model: TrainedSeries) -> dict:
    return {
        "series": _series_document(model.key),
        "trainedAt": model.trained_at.isoformat(),
        "firstTrainingDate": model.first_training_date,
        "lastTrainingDate": model.last_training_date,
        "trainingCount": model.training_count,
        "ridgeAlpha": model.ridge_alpha,
        "featureNames": list(model.feature_names),
        "parameters": _parameters_document(model.parameters),
        "validation": _metrics_document(model.metrics),
    }


def _version(content: dict) -> str:
    raw = dumps(content, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return "ridge-v1-" + sha256(raw).hexdigest()[:16]


def _model_document(model: TrainedSeries) -> dict:
    return {**_model_content(model), "modelVersion": model.model_version}


def _fit(rows: list[TrainingSample], alpha: float) -> RidgeParameters:
    return fit_ridge(tuple(row.features for row in rows),
                     tuple(row.actual_demand for row in rows), alpha)


def _evaluate(
    model: RidgeParameters,
    validation: list[TrainingSample],
    quantile: float,
) -> ValidationMetrics:
    errors = [abs(model.predict(row.features) - row.actual_demand) for row in validation]
    total_actual = sum(row.actual_demand for row in validation)
    mae = sum(errors) / len(errors)
    rmse = sqrt(sum(error * error for error in errors) / len(errors))
    wape = (sum(errors) / total_actual) if total_actual > 0 else None
    sorted_errors = sorted(errors)
    radius = sorted_errors[max(0, ceil(quantile * len(errors)) - 1)]
    return ValidationMetrics(
        validation_count=len(validation),
        from_date=validation[0].business_date.isoformat(),
        to_date=validation[-1].business_date.isoformat(),
        mae=mae, rmse=rmse, wape=wape,
        residual_radius=radius, residual_quantile=quantile,
    )


def train_ridge_registry(
    prepared: PreparedDataset,
    ingredients: tuple[IngredientRecord, ...],
    trained_at: datetime,
    settings: FeatureSettings = FeatureSettings(),
    config: TrainingConfig = TrainingConfig(),
    calendar: tuple[CalendarSignal, ...] = (),
) -> ModelRegistry:
    """Explicit training entry point; QA must precede any real training execution.

    For each independent branch/ingredient/unit/shift series, hold out the most
    recent validation dates, fit only on earlier dates, evaluate, then refit
    on all eligible observations. No randomly shuffled or future-dated rows.
    """
    samples, build_report = build_supervised_samples(
        prepared, ingredients, trained_at, settings, calendar,
    )
    groups: dict[SeriesKey, list[TrainingSample]] = defaultdict(list)
    for row in samples:
        groups[row.series].append(row)

    models: list[TrainedSeries] = []
    skipped: list[TrainingSkip] = []
    for key, rows in sorted(groups.items(), key=lambda pair: pair[0].text()):
        ordered = sorted(rows, key=lambda sample: sample.business_date)
        dates = sorted({row.business_date for row in ordered})
        if len(ordered) < config.minimum_examples or len(dates) < config.minimum_distinct_dates:
            skipped.append(TrainingSkip(key, "INSUFFICIENT_VERIFIED_SERIES_HISTORY", len(rows)))
            continue
        if len(dates) <= config.validation_dates:
            skipped.append(TrainingSkip(key, "NO_CHRONOLOGICAL_TRAINING_WINDOW", len(rows)))
            continue
        validation_start = dates[-config.validation_dates]
        validation_cutoff = datetime.combine(validation_start, time.min, tzinfo=LOCAL_TZ)
        # Backtest must not train on a past-dated sale whose APPROVAL or
        # recipe evidence only became available after the holdout began.
        training_rows = [
            row for row in ordered
            if row.business_date < validation_start and row.available_at < validation_cutoff
        ]
        validation_rows = [row for row in ordered if row.business_date >= validation_start]
        if len(training_rows) < config.minimum_training_examples or len(validation_rows) < config.validation_dates:
            skipped.append(TrainingSkip(key, "TRAIN_VALIDATION_SPLIT_TOO_SMALL", len(rows)))
            continue
        try:
            historical_model = _fit(training_rows, config.ridge_alpha)
            metrics = _evaluate(historical_model, validation_rows, config.residual_quantile)
            # Refit only after evaluating the chronological holdout.
            final_parameters = _fit(ordered, config.ridge_alpha)
        except (ValueError, OverflowError, ArithmeticError):
            skipped.append(TrainingSkip(key, "NONFINITE_OR_UNFITTABLE_SERIES", len(rows)))
            continue
        draft = TrainedSeries(
            key=key, model_version="", trained_at=trained_at.astimezone(timezone.utc),
            first_training_date=ordered[0].business_date.isoformat(),
            last_training_date=ordered[-1].business_date.isoformat(),
            training_count=len(ordered), ridge_alpha=config.ridge_alpha,
            feature_names=feature_names(settings),
            parameters=final_parameters, metrics=metrics,
        )
        models.append(TrainedSeries(
            key=draft.key, model_version=_version(_model_content(draft)),
            trained_at=draft.trained_at,
            first_training_date=draft.first_training_date,
            last_training_date=draft.last_training_date,
            training_count=draft.training_count,
            ridge_alpha=draft.ridge_alpha,
            feature_names=draft.feature_names,
            parameters=draft.parameters,
            metrics=draft.metrics,
        ))

    return ModelRegistry(
        trained_at=trained_at.astimezone(timezone.utc), settings=settings,
        models=tuple(models), skipped=tuple(skipped), source_report=build_report,
    )


def registry_from_document(document: dict) -> ModelRegistry:
    """Load *trusted* JSON-compatible artifacts only, with structural checks.

    The content checksum is an identity marker, not a cryptographic signature;
    AI3 must authenticate the transport and trusted artifact storage.
    """
    if not isinstance(document, dict) or document.get("schemaVersion") != ARTIFACT_SCHEMA:
        raise ValueError("Unsupported AI2 model artifact")
    settings_data = document["featureSettings"]
    settings = FeatureSettings(
        lag_days=tuple(settings_data["lagDays"]),
        rolling_days=tuple(settings_data["rollingDays"]),
        minimum_verified_observations=settings_data["minimumVerifiedObservations"],
    )
    trained_at = datetime.fromisoformat(document["trainedAt"])
    if trained_at.tzinfo is None or trained_at.utcoffset() is None:
        raise ValueError("Model artifact requires timezone-aware timestamp")
    models: list[TrainedSeries] = []
    for row in document["models"]:
        series = row["series"]
        key = SeriesKey(UUID(series["branchId"]), UUID(series["ingredientId"]),
                        IngredientUnit(series["unit"]), Shift(series["shift"]))
        value = row["parameters"]
        parameters = RidgeParameters(
            center=tuple(float(x) for x in value["center"]),
            scale=tuple(float(x) for x in value["scale"]),
            intercept=float(value["intercept"]),
            weights=tuple(float(x) for x in value["weights"]),
        )
        n = len(feature_names(settings))
        if (len(parameters.center) != n or len(parameters.scale) != n
                or len(parameters.weights) != n
                or any(not isfinite(v) for v in (*parameters.center, *parameters.scale,
                                                 parameters.intercept, *parameters.weights))
                or any(v <= 0 for v in parameters.scale)):
            raise ValueError("Corrupt ridge parameters")
        val = row["validation"]
        metrics = ValidationMetrics(
            validation_count=int(val["validationCount"]),
            from_date=str(val["fromDate"]), to_date=str(val["toDate"]),
            mae=float(val["mae"]), rmse=float(val["rmse"]),
            wape=None if val["wape"] is None else float(val["wape"]),
            residual_radius=float(val["residualRadius"]),
            residual_quantile=float(val["residualQuantile"]),
        )
        if (metrics.validation_count < 1 or metrics.mae < 0 or metrics.rmse < 0
                or not isfinite(metrics.mae) or not isfinite(metrics.rmse)
                or (metrics.wape is not None and (
                    not isfinite(metrics.wape) or metrics.wape < 0
                ))
                or not isfinite(metrics.residual_radius) or metrics.residual_radius < 0
                or not 0 < metrics.residual_quantile < 1):
            raise ValueError("Corrupt validation metadata")
        record = TrainedSeries(
            key=key, model_version=str(row["modelVersion"]),
            trained_at=datetime.fromisoformat(row["trainedAt"]),
            first_training_date=str(row["firstTrainingDate"]),
            last_training_date=str(row["lastTrainingDate"]),
            training_count=int(row["trainingCount"]),
            ridge_alpha=float(row["ridgeAlpha"]),
            feature_names=tuple(row["featureNames"]),
            parameters=parameters, metrics=metrics,
        )
        if (record.feature_names != feature_names(settings)
                or record.trained_at != trained_at
                or record.training_count < 1
                or not isfinite(record.ridge_alpha) or record.ridge_alpha <= 0
                or record.model_version != _version(_model_content(record))):
            raise ValueError("Model version or feature schema mismatch")
        models.append(record)
    if len({row.key for row in models}) != len(models):
        raise ValueError("Duplicate model per branch/ingredient/unit/shift")
    skipped = tuple(TrainingSkip(
        SeriesKey(UUID(item["series"]["branchId"]), UUID(item["series"]["ingredientId"]),
                  IngredientUnit(item["series"]["unit"]), Shift(item["series"]["shift"])),
        str(item["reason"]), int(item["availableExamples"]),
    ) for item in document.get("skipped", ()))
    report = document["sourceReport"]
    source_report = SampleBuildReport(
        accepted=int(report["accepted"]), skipped=int(report["skipped"]),
        skipped_reasons=tuple((str(code), int(count))
                              for code, count in report["skippedReasons"]),
    )
    return ModelRegistry(trained_at=trained_at, settings=settings, models=tuple(models),
                         skipped=skipped, source_report=source_report)
