"""Internal immutable feature records, separate from public forecast DTOs.

Values remain Decimal until a future model's explicitly documented numeric
conversion step.  A missing value is None, never an automatically imputed zero.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, localcontext
from enum import Enum
from uuid import UUID


class ObservationState(str, Enum):
    NO_REPORT = "NO_REPORT"
    UNAPPROVED_REPORT = "UNAPPROVED_REPORT"
    APPROVED_ZERO_SALES = "APPROVED_ZERO_SALES"
    APPROVED_RECORDED_SALES = "APPROVED_RECORDED_SALES"
    UNKNOWN_AS_OF_CUTOFF = "UNKNOWN_AS_OF_CUTOFF"
    AMBIGUOUS_REPORT = "AMBIGUOUS_REPORT"


class DemandChannel(str, Enum):
    VERIFIED = "VERIFIED"
    APPROXIMATE = "APPROXIMATE"


@dataclass(frozen=True)
class FeatureWarning:
    code: str
    message: str
    branch_id: UUID | None = None
    ingredient_id: UUID | None = None
    business_date: date | None = None


@dataclass(frozen=True)
class LagFeature:
    days: int
    business_date: date
    value: Decimal | None
    state: ObservationState
    recipe_coverage: Decimal | None


@dataclass(frozen=True)
class RollingFeature:
    window_days: int
    mean: Decimal | None
    observed_days: int
    expected_days: int
    approved_report_count: int
    missing_report_days: int
    unapproved_report_days: int
    unavailable_days: int
    partial_recipe_days: int
    ambiguous_days: int
    average_recipe_coverage: Decimal | None

    @property
    def observation_coverage(self) -> Decimal | None:
        if self.expected_days == 0:
            return None
        with localcontext() as context:
            context.prec = 50
            return Decimal(self.observed_days) / Decimal(self.expected_days)


@dataclass(frozen=True)
class HistoryFeatures:
    channel: DemandChannel
    lags: tuple[LagFeature, ...]
    rolling: tuple[RollingFeature, ...]
    complete_observation_count: int
    approved_report_count: int
    expected_slot_count: int
    recipe_coverage: Decimal | None
    latest_demand: Decimal | None
    latest_business_date: date | None
    has_missing_report: bool
    has_unapproved_report: bool
    has_partial_recipe_history: bool
    has_unknown_availability: bool


@dataclass(frozen=True)
class IngredientFeatures:
    branch_id: UUID
    ingredient_id: UUID
    unit: str
    business_date: date
    shift: str
    day_of_week: int
    is_weekend: bool
    special_day_category: str | None
    verified_history: HistoryFeatures
    approximate_history: HistoryFeatures
    minimum_stock: Decimal | None
    on_hand: Decimal | None
    inventory_available_at: datetime | None


@dataclass(frozen=True)
class FeatureBatch:
    branch_id: UUID
    business_date: date
    shift: str
    history_cutoff: datetime
    rows: tuple[IngredientFeatures, ...]
    warnings: tuple[FeatureWarning, ...]
