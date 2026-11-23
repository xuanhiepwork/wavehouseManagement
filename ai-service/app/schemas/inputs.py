"""AI1 minimal authorized backend projections, not raw Prisma user/report objects."""

from typing import Literal

from pydantic import Field, model_validator

from .common import (
    AIContract, BusinessDate, DomainId, IngredientUnit, Instant, MappingMode,
    NonnegativeQuantity, PositiveInt, PositiveQuantity, Quantity, SalesStatus, Shift,
)
from .outputs import DemandObservation


class IngredientRecord(AIContract):
    id: DomainId
    unit: IngredientUnit | None
    min_stock: NonnegativeQuantity = "0"
    available_at: Instant


class RecipeIngredientRecord(AIContract):
    ingredient_id: DomainId
    quantity: PositiveQuantity
    unit: IngredientUnit | None


class RecipeRecord(AIContract):
    id: DomainId
    product_variant_id: DomainId
    product_id: DomainId
    size: Literal["S", "M", "L"]
    version: PositiveInt
    created_at: Instant
    available_at: Instant
    ingredients: tuple[RecipeIngredientRecord, ...] = Field(max_length=500)


class HistoricalRecipeReference(AIContract):
    """Future AI3 attested link, absent from current W7.3; never inferred from dates."""

    recipe_id: DomainId
    recipe_version: PositiveInt
    product_variant_id: DomainId
    evidence_id: DomainId
    available_at: Instant


class SalesLine(AIContract):
    id: DomainId
    product_id: DomainId | None
    size: Literal["S", "M", "L", "OTHER"]
    quantity: int = Field(strict=True, ge=0, le=999_999)
    recipe_reference: HistoricalRecipeReference | None = None


class SalesRevision(AIContract):
    id: DomainId
    report_id: DomainId
    number: PositiveInt
    created_at: Instant
    lines: tuple[SalesLine, ...] = Field(max_length=100)


class SalesReportRecord(AIContract):
    id: DomainId
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    status: SalesStatus
    current_revision_number: PositiveInt
    submitted_revision_number: PositiveInt | None = None
    approved_revision_number: PositiveInt | None = None
    approved_at: Instant | None = None
    available_at: Instant
    revisions: tuple[SalesRevision, ...] = Field(max_length=1000)


class ExpectedSlot(AIContract):
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift


class StockCountProxy(AIContract):
    """Quality context only. B6 variance must never become a sales demand label."""

    id: DomainId
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    status: SalesStatus
    ingredient_id: DomainId
    unit: IngredientUnit | None
    variance: Quantity | None
    available_at: Instant


class PreparationRequest(AIContract):
    schema_version: Literal["AI1"] = "AI1"
    timezone: Literal["Asia/Ho_Chi_Minh"] = "Asia/Ho_Chi_Minh"
    exported_at: Instant
    expected_slots: tuple[ExpectedSlot, ...] = Field(min_length=1, max_length=100_000)
    ingredients: tuple[IngredientRecord, ...] = Field(min_length=1, max_length=5000)
    reports: tuple[SalesReportRecord, ...] = Field(max_length=100_000)
    historical_recipes: tuple[RecipeRecord, ...] = Field(default=(), max_length=20_000)
    current_recipes: tuple[RecipeRecord, ...] = Field(default=(), max_length=20_000)
    mapping_mode: MappingMode = MappingMode.VERIFIED_ONLY
    export_complete: bool = Field(default=True, strict=True)
    stock_count_proxies: tuple[StockCountProxy, ...] = Field(default=(), max_length=100_000)


class CalendarSignal(AIContract):
    business_date: BusinessDate
    day_type: Literal["WEEKDAY", "WEEKEND", "HOLIDAY"]
    special_day: str | None = Field(default=None, pattern=r"^[A-Z0-9][A-Z0-9_-]{0,63}$")
    available_at: Instant


class InventorySnapshot(AIContract):
    branch_id: DomainId
    ingredient_id: DomainId
    unit: IngredientUnit
    quantity: Quantity
    as_of: Instant
    available_at: Instant


class ForecastContext(AIContract):
    calendar: tuple[CalendarSignal, ...] = Field(default=(), max_length=5000)
    inventory: tuple[InventorySnapshot, ...] = Field(default=(), max_length=5000)


class ForecastRequest(AIContract):
    schema_version: Literal["AI1"] = "AI1"
    timezone: Literal["Asia/Ho_Chi_Minh"] = "Asia/Ho_Chi_Minh"
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    ingredients: tuple[IngredientRecord, ...] = Field(min_length=1, max_length=5000)
    historical_observations: tuple[DemandObservation, ...] = Field(default=(), max_length=100_000)
    contextual_features: ForecastContext = Field(default_factory=ForecastContext)

    @model_validator(mode="after")
    def unique_targets(self) -> "ForecastRequest":
        if len({row.id for row in self.ingredients}) != len(self.ingredients):
            raise ValueError("Requested ingredients must be unique")
        return self
