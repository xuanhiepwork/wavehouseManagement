"""Prepare date-level features from validated, read-only demand observations.

Both the business date and event availability must precede the target Vietnam
date.  Partial recipe contributions are visible through coverage flags but are
never treated as complete demand observations for lag/rolling quantities.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, localcontext

from ..schemas.common import AvailabilityStatus, CoverageStatus, DemandBasis
from ..schemas.inputs import ForecastRequest
from ..schemas.outputs import DemandObservation, PreparedDataset, SlotCoverage
from .calendar import available_before, calendar_features, target_date_cutoff
from .models import (
    DemandChannel,
    FeatureBatch,
    FeatureWarning,
    HistoryFeatures,
    IngredientFeatures,
    LagFeature,
    ObservationState,
    RollingFeature,
)


APPROVED_STATES = {
    AvailabilityStatus.APPROVED_ZERO_SALES,
    AvailabilityStatus.APPROVED_RECORDED_SALES,
}
BASIS_BY_CHANNEL = {
    DemandChannel.VERIFIED: DemandBasis.VERIFIED_HISTORICAL_THEORETICAL,
    DemandChannel.APPROXIMATE: DemandBasis.APPROXIMATE_CURRENT_RECIPE,
}


def _mean(values: list[Decimal]) -> Decimal | None:
    if not values:
        return None
    with localcontext() as context:
        context.prec = 50
        return sum(values, Decimal(0)) / Decimal(len(values))


def _state(slot: SlotCoverage | None, observation: DemandObservation | None) -> ObservationState:
    if slot is not None:
        value = slot.availability.value
    elif observation is not None:
        value = observation.availability.value
    else:
        return ObservationState.UNKNOWN_AS_OF_CUTOFF
    if value == AvailabilityStatus.INVALID.value:
        return ObservationState.AMBIGUOUS_REPORT
    return ObservationState(value)


def _usable(observation: DemandObservation | None) -> bool:
    return (
        observation is not None
        and observation.coverage == CoverageStatus.COMPLETE
        and observation.availability in APPROVED_STATES
        and observation.recipe_coverage == Decimal(1)
    )


def _history_features(
    channel: DemandChannel,
    observations: dict[date, DemandObservation],
    slots: dict[date, SlotCoverage],
    target: date,
    lag_days: tuple[int, ...],
    rolling_days: tuple[int, ...],
) -> HistoryFeatures:
    known_dates = set(slots) | set(observations)
    eligible = {day: row for day, row in observations.items() if _usable(row)}
    report_ids = {
        slot.report_id for slot in slots.values()
        if slot.availability in APPROVED_STATES and slot.report_id is not None
    }
    report_ids.update(report_id for row in observations.values() for report_id in row.report_ids)

    def recipe_coverage(day: date) -> Decimal | None:
        row = observations.get(day)
        if row is not None:
            return row.recipe_coverage
        slot = slots.get(day)
        if slot is None or slot.availability not in APPROVED_STATES:
            return None
        if slot.availability == AvailabilityStatus.APPROVED_ZERO_SALES:
            return Decimal(1)
        with localcontext() as context:
            context.prec = 50
            if slot.quantity_sold == 0:
                return None
            return Decimal(slot.mapped_quantity_sold) / Decimal(slot.quantity_sold)

    def partial_recipe(day: date) -> bool:
        row = observations.get(day)
        slot = slots.get(day)
        if row is not None:
            return row.coverage != CoverageStatus.COMPLETE or row.recipe_coverage != Decimal(1)
        return (
            slot is not None
            and slot.availability == AvailabilityStatus.APPROVED_RECORDED_SALES
        )

    lags = tuple(
        LagFeature(
            days=days,
            business_date=target - timedelta(days=days),
            value=(eligible[target - timedelta(days=days)].theoretical_demand
                   if target - timedelta(days=days) in eligible else None),
            state=_state(slots.get(target - timedelta(days=days)), observations.get(target - timedelta(days=days))),
            recipe_coverage=recipe_coverage(target - timedelta(days=days)),
        )
        for days in lag_days
    )
    rolling: list[RollingFeature] = []
    for window_days in rolling_days:
        days = [target - timedelta(days=offset) for offset in range(1, window_days + 1)]
        states = [_state(slots.get(day), observations.get(day)) for day in days]
        window_report_ids = {
            slots[day].report_id for day in days
            if day in slots and slots[day].availability in APPROVED_STATES
            and slots[day].report_id is not None
        }
        window_report_ids.update(
            report_id for day in days if day in observations
            for report_id in observations[day].report_ids
        )
        rolling.append(RollingFeature(
            window_days=window_days,
            mean=_mean([eligible[day].theoretical_demand for day in days if day in eligible]),
            observed_days=sum(day in eligible for day in days),
            expected_days=sum(day in known_dates for day in days),
            approved_report_count=len(window_report_ids),
            missing_report_days=states.count(ObservationState.NO_REPORT),
            unapproved_report_days=states.count(ObservationState.UNAPPROVED_REPORT),
            unavailable_days=states.count(ObservationState.UNKNOWN_AS_OF_CUTOFF),
            partial_recipe_days=sum(partial_recipe(day) for day in days),
            ambiguous_days=states.count(ObservationState.AMBIGUOUS_REPORT),
            average_recipe_coverage=_mean([
                value for day in days if (value := recipe_coverage(day)) is not None
            ]),
        ))
    latest_day = max(eligible) if eligible else None
    all_states = [_state(slots.get(day), observations.get(day)) for day in known_dates]
    return HistoryFeatures(
        channel=channel,
        lags=lags,
        rolling=tuple(rolling),
        complete_observation_count=len(eligible),
        approved_report_count=len(report_ids),
        expected_slot_count=len(known_dates),
        recipe_coverage=_mean([value for day in known_dates if (value := recipe_coverage(day)) is not None]),
        latest_demand=eligible[latest_day].theoretical_demand if latest_day is not None else None,
        latest_business_date=latest_day,
        has_missing_report=ObservationState.NO_REPORT in all_states,
        has_unapproved_report=ObservationState.UNAPPROVED_REPORT in all_states,
        has_partial_recipe_history=any(partial_recipe(day) for day in known_dates),
        has_unknown_availability=any(item.unavailable_days > 0 for item in rolling),
    )


def build_features(
    dataset: PreparedDataset,
    request: ForecastRequest,
    *,
    lag_days: tuple[int, ...] = (1, 7, 14),
    rolling_days: tuple[int, ...] = (7, 28),
) -> FeatureBatch:
    """Create one row per requested ingredient, without modifying input data.

    Calendar-day lag 7 means the exact date seven days earlier in the same
    branch and shift, not the seventh most recent observed report.  Rolling
    means exclude missing and partial rows; their coverage counters remain
    explicit.  Expected slots come only from supplied data/coverage, never an
    invented operating schedule.  Unknown calendar days remain unknown.

    ``dataset.observations`` is the single source of historical observations.
    If a caller also supplies request.historical_observations, it must be an
    equal copy; a conflicting second history invalidates history for this call.
    """
    for values in (lag_days, rolling_days):
        if not values or any(type(value) is not int or value < 1 or value > 366 for value in values):
            raise ValueError("Lag/rolling days must be integers from 1 through 366")
        if len(set(values)) != len(values):
            raise ValueError("Lag/rolling days must not contain duplicates")
    cutoff = target_date_cutoff(request.business_date)
    warnings: list[FeatureWarning] = []

    def warn(code: str, message: str, *, ingredient_id=None, business_date=None) -> None:
        warnings.append(FeatureWarning(code, message, request.branch_id, ingredient_id, business_date))

    invalid_history = dataset.validation_failed
    if invalid_history:
        warn("DATASET_VALIDATION_FAILED", "Dataset validation failed; historical demand features are unavailable.")
    if request.historical_observations and request.historical_observations != dataset.observations:
        invalid_history = True
        warn("HISTORICAL_INPUT_MISMATCH", "Conflicting histories were supplied; neither history is used for feature values.")

    slots_grouped: dict[date, list[SlotCoverage]] = defaultdict(list)
    if not invalid_history:
        for slot in dataset.coverage:
            if slot.branch_id != request.branch_id or slot.shift != request.shift:
                continue
            if slot.business_date >= request.business_date:
                warn("FUTURE_BUSINESS_DATE_EXCLUDED", "A slot on or after the target date was excluded.", business_date=slot.business_date)
                continue
            if slot.available_at is None or not available_before(slot.available_at, cutoff):
                warn("SLOT_UNAVAILABLE_AT_CUTOFF", "A slot has no availability evidence before the prediction date.", business_date=slot.business_date)
                continue
            slots_grouped[slot.business_date].append(slot)
    slots: dict[date, SlotCoverage] = {}
    ambiguous_dates: set[date] = set()
    for day, rows in slots_grouped.items():
        if len(rows) != 1:
            ambiguous_dates.add(day)
            warn("DUPLICATE_SLOT_COVERAGE", "Multiple coverage rows identify the same branch/date/shift; that slot was excluded.", business_date=day)
        else:
            slots[day] = rows[0]

    observations_grouped: dict[tuple, list[DemandObservation]] = defaultdict(list)
    ingredient_map = {ingredient.id: ingredient for ingredient in request.ingredients}
    if not invalid_history:
        for row in dataset.observations:
            if row.branch_id != request.branch_id or row.shift != request.shift or row.ingredient_id not in ingredient_map:
                continue
            if row.business_date >= request.business_date:
                warn("FUTURE_BUSINESS_DATE_EXCLUDED", "Demand on or after the target date was excluded.", ingredient_id=row.ingredient_id, business_date=row.business_date)
                continue
            if not available_before(row.available_at, cutoff):
                warn("DEMAND_UNAVAILABLE_AT_CUTOFF", "Demand mapping was not available before the prediction date.", ingredient_id=row.ingredient_id, business_date=row.business_date)
                continue
            ingredient = ingredient_map[row.ingredient_id]
            if ingredient.unit is None or row.unit != ingredient.unit:
                warn("INCOMPATIBLE_INGREDIENT_UNIT", "Demand unit does not match the requested ingredient unit; no conversion is inferred.", ingredient_id=row.ingredient_id, business_date=row.business_date)
                continue
            if not available_before(ingredient.available_at, cutoff):
                continue
            if row.availability not in APPROVED_STATES or row.approved_report_count != 1 or len(row.report_ids) != 1:
                warn("INVALID_DEMAND_PROVENANCE", "Demand does not identify exactly one approved source report.", ingredient_id=row.ingredient_id, business_date=row.business_date)
                continue
            slot = slots.get(row.business_date)
            if row.business_date in ambiguous_dates or (slot is not None and (
                slot.availability not in APPROVED_STATES or slot.report_id not in row.report_ids
            )):
                warn("DEMAND_COVERAGE_CONFLICT", "Demand and slot approval provenance conflict; the observation was excluded.", ingredient_id=row.ingredient_id, business_date=row.business_date)
                continue
            observations_grouped[(row.ingredient_id, row.basis, row.business_date)].append(row)
    observations: dict[tuple, DemandObservation] = {}
    for key, rows in observations_grouped.items():
        if len(rows) != 1:
            warn("DUPLICATE_DEMAND_OBSERVATION", "Duplicate ingredient/channel/date observations were excluded instead of summed.", ingredient_id=key[0], business_date=key[2])
        else:
            observations[key] = rows[0]

    special_day_category: str | None = None
    signals = [signal for signal in request.contextual_features.calendar
               if signal.business_date == request.business_date and available_before(signal.available_at, cutoff)]
    if signals:
        latest_at = max(signal.available_at for signal in signals)
        latest = [signal for signal in signals if signal.available_at == latest_at]
        if len({(signal.day_type, signal.special_day) for signal in latest}) == 1:
            special_day_category = latest[0].special_day or latest[0].day_type.value
        else:
            warn("CONFLICTING_CALENDAR_SIGNALS", "Equally recent calendar signals disagree; no special-day feature is set.")
    if any(signal.business_date == request.business_date and not available_before(signal.available_at, cutoff)
           for signal in request.contextual_features.calendar):
        warn("CALENDAR_UNAVAILABLE_AT_CUTOFF", "Calendar signals unavailable before the target date were excluded.")

    weekday, weekend = calendar_features(request.business_date)
    result: list[IngredientFeatures] = []
    for ingredient in request.ingredients:
        metadata_available = available_before(ingredient.available_at, cutoff)
        if not metadata_available:
            warn("INGREDIENT_UNAVAILABLE_AT_CUTOFF", "Ingredient metadata was unavailable before the prediction date.", ingredient_id=ingredient.id)
        if ingredient.unit is None:
            warn("MISSING_INGREDIENT_UNIT", "Ingredient unit is missing; demand features are unavailable.", ingredient_id=ingredient.id)
        histories = {
            channel: _history_features(channel, {
                day: row for (ingredient_id, basis, day), row in observations.items()
                if ingredient_id == ingredient.id and basis == BASIS_BY_CHANNEL[channel]
            }, slots, request.business_date, lag_days, rolling_days)
            for channel in DemandChannel
        }
        snapshots = [snapshot for snapshot in request.contextual_features.inventory
                     if snapshot.branch_id == request.branch_id and snapshot.ingredient_id == ingredient.id
                     and snapshot.unit == ingredient.unit and snapshot.as_of < cutoff
                     and available_before(snapshot.available_at, cutoff)]
        on_hand = None
        inventory_available_at = None
        if snapshots and metadata_available and ingredient.unit is not None:
            newest_as_of = max(snapshot.as_of for snapshot in snapshots)
            newest = [snapshot for snapshot in snapshots if snapshot.as_of == newest_as_of]
            newest_available_at = max(snapshot.available_at for snapshot in newest)
            latest_snapshots = [snapshot for snapshot in newest if snapshot.available_at == newest_available_at]
            if len({snapshot.quantity for snapshot in latest_snapshots}) == 1:
                on_hand = latest_snapshots[0].quantity
                inventory_available_at = newest_available_at
            else:
                warn("CONFLICTING_INVENTORY_SNAPSHOTS", "Equally recent inventory snapshots disagree; inventory is unknown.", ingredient_id=ingredient.id)
        if any(snapshot.branch_id == request.branch_id and snapshot.ingredient_id == ingredient.id
               and (snapshot.unit != ingredient.unit or snapshot.as_of >= cutoff or not available_before(snapshot.available_at, cutoff))
               for snapshot in request.contextual_features.inventory):
            warn("INVENTORY_CONTEXT_EXCLUDED", "Inventory context has an incompatible unit or was unavailable before the target date.", ingredient_id=ingredient.id)
        result.append(IngredientFeatures(
            branch_id=request.branch_id,
            ingredient_id=ingredient.id,
            unit=ingredient.unit.value if ingredient.unit is not None else "UNKNOWN",
            business_date=request.business_date,
            shift=request.shift.value,
            day_of_week=weekday,
            is_weekend=weekend,
            special_day_category=special_day_category,
            verified_history=histories[DemandChannel.VERIFIED],
            approximate_history=histories[DemandChannel.APPROXIMATE],
            minimum_stock=ingredient.min_stock if metadata_available else None,
            on_hand=on_hand,
            inventory_available_at=inventory_available_at,
        ))
    return FeatureBatch(request.branch_id, request.business_date, request.shift.value, cutoff, tuple(result), tuple(warnings))
