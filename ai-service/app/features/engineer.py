"""Build deterministic per-ingredient features without leaking future approvals.

No missing day is silently converted to zero. Only approved and completely mapped
HISTORICAL theoretical demand may be used as a supervised-training observation.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from ..config.settings import FeatureSettings
from ..schemas.common import (
    AvailabilityStatus, CoverageStatus, DemandBasis, IngredientUnit, Shift,
    decimal_text,
)
from ..schemas.inputs import ForecastRequest
from ..schemas.outputs import DemandObservation

LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


@dataclass(frozen=True)
class FeatureRow:
    branch_id: UUID
    ingredient_id: UUID
    unit: IngredientUnit | None
    business_date: date
    shift: Shift
    day_of_week: int
    is_weekend: bool
    day_type: str
    special_day: str | None
    lag_demand: dict[int, str | None]
    rolling_mean: dict[int, str | None]
    verified_history_count: int
    ready_for_model: bool
    warnings: tuple[str, ...]


def _before_business_date(business_date: date) -> datetime:
    """Conservative as-of cutoff: start of the target business date in Vietnam."""
    return datetime.combine(business_date, time.min, tzinfo=LOCAL_TZ)


def _verified_observation(row: DemandObservation) -> bool:
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


def prepare_features(
    request: ForecastRequest,
    settings: FeatureSettings = FeatureSettings(),
) -> tuple[FeatureRow, ...]:
    """Prepare AI2 inputs, not forecasts. Never use records known only after cutoff."""
    cutoff = _before_business_date(request.business_date)
    eligible: dict[tuple[UUID, date, Shift, UUID, IngredientUnit], list[DemandObservation]] = defaultdict(list)
    excluded = Counter()
    for row in request.historical_observations:
        if (
            row.branch_id != request.branch_id
            or row.business_date >= request.business_date
            or row.shift != request.shift
            or row.available_at >= cutoff
        ):
            continue
        if not _verified_observation(row):
            excluded[row.ingredient_id] += 1
            continue
        key = (row.branch_id, row.business_date, row.shift, row.ingredient_id, row.unit)
        eligible[key].append(row)

    day_type = "WEEKEND" if request.business_date.weekday() >= 5 else "WEEKDAY"
    special_day: str | None = None
    day_matches = [
        item for item in request.contextual_features.calendar
        if item.business_date == request.business_date and item.available_at < cutoff
    ]
    calendar_ambiguous = len(day_matches) > 1
    if len(day_matches) == 1:
        day_type = day_matches[0].day_type
        special_day = day_matches[0].special_day

    results: list[FeatureRow] = []
    for ingredient in request.ingredients:
        warnings: list[str] = []
        if calendar_ambiguous:
            warnings.append("AMBIGUOUS_CALENDAR_SIGNAL")
        if ingredient.unit is None or ingredient.available_at >= cutoff:
            warnings.append("INGREDIENT_METADATA_NOT_KNOWN_AS_OF_DATE")
        if excluded[ingredient.id]:
            warnings.append("INCOMPLETE_OR_APPROXIMATE_HISTORY_EXCLUDED")

        history: dict[date, Decimal] = {}
        duplicates = False
        if ingredient.unit is not None:
            for key, rows in eligible.items():
                if key[3] != ingredient.id or key[4] != ingredient.unit:
                    continue
                if len(rows) > 1:
                    duplicates = True
                    continue
                history[key[1]] = rows[0].theoretical_demand
        if duplicates:
            warnings.append("DUPLICATE_VERIFIED_OBSERVATIONS_EXCLUDED")

        lags: dict[int, str | None] = {}
        for lag in settings.lag_days:
            prior_date = request.business_date - timedelta(days=lag)
            quantity = history.get(prior_date)
            lags[lag] = decimal_text(quantity) if quantity is not None else None

        rolling: dict[int, str | None] = {}
        for days in settings.rolling_days:
            quantities = [
                history.get(request.business_date - timedelta(days=lag))
                for lag in range(1, days + 1)
            ]
            # A missing day is UNKNOWN, not an observed zero.
            if any(quantity is None for quantity in quantities):
                rolling[days] = None
            else:
                rolling[days] = decimal_text(sum(quantities, Decimal("0")) / Decimal(days))

        ready = (
            ingredient.unit is not None
            and ingredient.available_at < cutoff
            and len(history) >= settings.minimum_verified_observations
            and not duplicates
        )
        if not ready:
            warnings.append("INSUFFICIENT_VERIFIED_HISTORY")
        results.append(FeatureRow(
            branch_id=request.branch_id,
            ingredient_id=ingredient.id,
            unit=ingredient.unit,
            business_date=request.business_date,
            shift=request.shift,
            day_of_week=request.business_date.weekday(),
            is_weekend=request.business_date.weekday() >= 5,
            day_type=day_type,
            special_day=special_day,
            lag_demand=lags,
            rolling_mean=rolling,
            verified_history_count=len(history),
            ready_for_model=ready,
            warnings=tuple(dict.fromkeys(warnings)),
        ))
    return tuple(results)
