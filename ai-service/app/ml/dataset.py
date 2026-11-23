"""Leakage-safe supervised rows for AI2; only AI1 verified theoretical demand.

This module has no file, network, database or inventory side effects.
A missing day is never inserted as a zero-demand training label.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from math import isfinite, log1p
from uuid import UUID
from zoneinfo import ZoneInfo

from ..config.settings import FeatureSettings
from ..features.engineer import FeatureRow, prepare_features
from ..schemas.common import (
    AvailabilityStatus, CoverageStatus, DemandBasis, IngredientUnit, Shift,
)
from ..schemas.inputs import (
    CalendarSignal, ForecastContext, ForecastRequest, IngredientRecord,
)
from ..schemas.outputs import DemandObservation, PreparedDataset

LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


@dataclass(frozen=True)
class SeriesKey:
    branch_id: UUID
    ingredient_id: UUID
    unit: IngredientUnit
    shift: Shift

    def text(self) -> str:
        return f"{self.branch_id}/{self.ingredient_id}/{self.unit.value}/{self.shift.value}"


@dataclass(frozen=True)
class TrainingSample:
    series: SeriesKey
    business_date: date
    features: tuple[float, ...]
    actual_demand: float
    available_at: datetime


@dataclass(frozen=True)
class SampleBuildReport:
    accepted: int
    skipped: int
    skipped_reasons: tuple[tuple[str, int], ...]


def feature_names(settings: FeatureSettings) -> tuple[str, ...]:
    return (
        *(f"weekday_{day}" for day in range(7)),
        "is_weekend", "day_type_weekday", "day_type_weekend", "day_type_holiday",
        "has_special_day", "log_verified_history_count",
        *(name for lag in settings.lag_days
          for name in (f"log_lag_{lag}", f"lag_{lag}_missing")),
        *(name for days in settings.rolling_days
          for name in (f"log_rolling_{days}", f"rolling_{days}_missing")),
    )


def _log_nonnegative(value: Decimal | str | int) -> float:
    number = float(value)
    if not isfinite(number) or number < 0:
        raise ValueError("ML feature or label is negative or not finite")
    result = log1p(number)
    if not isfinite(result):
        raise ValueError("ML feature is outside supported numeric range")
    return result


def encode_features(row: FeatureRow, settings: FeatureSettings) -> tuple[float, ...]:
    """Deterministic, fixed-width, missingness-aware representation.

    Zero is used as the *numeric placeholder* for missing lags only when a
    companion missingness flag is 1. This is not a zero-demand observation.
    """
    values: list[float] = [float(row.day_of_week == day) for day in range(7)]
    values.extend((
        float(row.is_weekend), float(row.day_type == "WEEKDAY"),
        float(row.day_type == "WEEKEND"), float(row.day_type == "HOLIDAY"),
        float(row.special_day is not None), _log_nonnegative(row.verified_history_count),
    ))
    for lag in settings.lag_days:
        quantity = row.lag_demand.get(lag)
        values.extend((0.0 if quantity is None else _log_nonnegative(quantity),
                       float(quantity is None)))
    for days in settings.rolling_days:
        quantity = row.rolling_mean.get(days)
        values.extend((0.0 if quantity is None else _log_nonnegative(quantity),
                       float(quantity is None)))
    result = tuple(values)
    if len(result) != len(feature_names(settings)) or not all(isfinite(v) for v in result):
        raise ValueError("Invalid or mismatched feature vector")
    return result


def _eligible(row: DemandObservation) -> bool:
    return (
        row.basis == DemandBasis.VERIFIED_HISTORICAL_THEORETICAL
        and row.coverage == CoverageStatus.COMPLETE
        and row.availability in (
            AvailabilityStatus.APPROVED_RECORDED_SALES,
            AvailabilityStatus.APPROVED_ZERO_SALES,
        )
        and row.approved_report_count == 1
        and row.recipe_coverage == Decimal("1")
    )


def build_supervised_samples(
    prepared: PreparedDataset,
    ingredients: tuple[IngredientRecord, ...],
    trained_at: datetime,
    settings: FeatureSettings = FeatureSettings(),
    calendar: tuple[CalendarSignal, ...] = (),
) -> tuple[tuple[TrainingSample, ...], SampleBuildReport]:
    """Create as-of-date training examples from fully verified AI1 observations.

    The label may only be used if its approval was known before *trained_at*.
    Features for date D use observations available before D at 00:00 VN time.
    """
    if trained_at.tzinfo is None or trained_at.utcoffset() is None:
        raise ValueError("trained_at must include a timezone")
    if prepared.validation_failed or any(w.severity == "ERROR" for w in prepared.warnings):
        raise ValueError("AI1 dataset has fatal validation errors; do not train")
    if prepared.exported_at is None or prepared.exported_at > trained_at:
        raise ValueError("Dataset export must be known by model training time")
    if not prepared.coverage:
        raise ValueError("Expected-slot coverage is required to distinguish missing data from zero")

    ingredient_map = {item.id: item for item in ingredients}
    if len(ingredient_map) != len(ingredients):
        raise ValueError("Duplicate ingredient metadata IDs")
    slot_map = {(item.branch_id, item.business_date, item.shift): item for item in prepared.coverage}
    if len(slot_map) != len(prepared.coverage):
        raise ValueError("Duplicate expected slots in AI1 coverage")

    grouped: dict[SeriesKey, list[DemandObservation]] = defaultdict(list)
    excluded: Counter[str] = Counter()
    train_date = trained_at.astimezone(LOCAL_TZ).date()
    for observation in prepared.observations:
        if not _eligible(observation):
            excluded["UNVERIFIED_OR_PARTIAL"] += 1
            continue
        if observation.available_at >= trained_at or observation.business_date >= train_date:
            excluded["LABEL_UNAVAILABLE_AT_TRAIN_TIME"] += 1
            continue
        item = ingredient_map.get(observation.ingredient_id)
        if item is None or item.unit != observation.unit:
            excluded["INGREDIENT_METADATA_OR_UNIT_MISSING"] += 1
            continue
        slot = slot_map.get((observation.branch_id, observation.business_date, observation.shift))
        if (slot is None or slot.coverage != CoverageStatus.COMPLETE
                or slot.availability != observation.availability
                or slot.report_id not in observation.report_ids):
            excluded["APPROVED_SLOT_EVIDENCE_INCONSISTENT"] += 1
            continue
        grouped[SeriesKey(observation.branch_id, observation.ingredient_id,
                          observation.unit, observation.shift)].append(observation)

    samples: list[TrainingSample] = []
    for key, observations in sorted(grouped.items(), key=lambda pair: pair[0].text()):
        ordered = sorted(observations, key=lambda obs: obs.business_date)
        if len({row.business_date for row in ordered}) != len(ordered):
            raise ValueError(f"Duplicate verified labels for {key.text()}")
        ingredient = ingredient_map[key.ingredient_id]
        for index, target in enumerate(ordered):
            # Strictly earlier rows; AI1 independently enforces available_at <
            # start of the target business date and correct branch/shift/unit.
            request = ForecastRequest(
                branch_id=key.branch_id,
                business_date=target.business_date,
                shift=key.shift,
                ingredients=(ingredient,),
                historical_observations=tuple(ordered[:index]),
                contextual_features=ForecastContext(calendar=calendar),
            )
            row = prepare_features(request, settings)[0]
            if not row.ready_for_model or "AMBIGUOUS_CALENDAR_SIGNAL" in row.warnings:
                excluded["FEATURES_NOT_AVAILABLE_AS_OF_TARGET"] += 1
                continue
            try:
                samples.append(TrainingSample(
                    series=key, business_date=target.business_date,
                    features=encode_features(row, settings),
                    actual_demand=float(target.theoretical_demand),
                    available_at=target.available_at,
                ))
            except (OverflowError, ValueError):
                excluded["NUMERIC_FEATURE_INVALID"] += 1

    samples.sort(key=lambda item: (item.series.text(), item.business_date))
    return tuple(samples), SampleBuildReport(
        accepted=len(samples), skipped=sum(excluded.values()),
        skipped_reasons=tuple(sorted(excluded.items())),
    )
