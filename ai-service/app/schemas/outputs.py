"""Demand preparation and future model outputs; quantities serialize as strings."""

from typing import Literal

from pydantic import Field, model_validator

from .common import (
    AIContract, AvailabilityStatus, BusinessDate, CalculatedQuantity, Count,
    CoverageRatio, CoverageStatus, DemandBasis, DomainId, ForecastStatus,
    IngredientUnit, Instant, PositiveInt, PositiveQuantity, Shift,
)


class QualityWarning(AIContract):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,79}$")
    severity: Literal["INFO", "WARNING", "ERROR"]
    message: str = Field(max_length=500)
    branch_id: DomainId | None = None
    business_date: BusinessDate | None = None
    shift: Shift | None = None
    report_id: DomainId | None = None
    revision_number: PositiveInt | None = None
    sales_line_id: DomainId | None = None
    ingredient_id: DomainId | None = None
    record_index: Count | None = None
    field_path: str | None = Field(default=None, max_length=500)


class DemandContribution(AIContract):
    report_id: DomainId
    revision_id: DomainId
    approved_revision_number: PositiveInt
    sales_line_id: DomainId
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    product_id: DomainId
    size: Literal["S", "M", "L"]
    quantity_sold: Count
    recipe_id: DomainId
    recipe_version: PositiveInt
    product_variant_id: DomainId
    recipe_evidence_id: DomainId | None = None
    ingredient_id: DomainId
    unit: IngredientUnit
    quantity_per_beverage: PositiveQuantity
    theoretical_demand: CalculatedQuantity
    basis: DemandBasis
    available_at: Instant


class SlotCoverage(AIContract):
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    availability: AvailabilityStatus
    coverage: CoverageStatus
    report_id: DomainId | None = None
    approved_revision_number: PositiveInt | None = None
    quantity_sold: Count = 0
    mapped_quantity_sold: Count = 0
    available_at: Instant | None = None


class DemandObservation(AIContract):
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    ingredient_id: DomainId
    unit: IngredientUnit
    theoretical_demand: CalculatedQuantity
    basis: DemandBasis
    coverage: CoverageStatus
    availability: AvailabilityStatus
    report_ids: tuple[DomainId, ...]
    approved_report_count: Count
    quantity_sold: Count
    mapped_quantity_sold: Count
    available_at: Instant
    recipe_coverage: CoverageRatio


class PreparedDataset(AIContract):
    schema_version: Literal["AI1"] = "AI1"
    timezone: Literal["Asia/Ho_Chi_Minh"] = "Asia/Ho_Chi_Minh"
    exported_at: Instant | None = None
    observations: tuple[DemandObservation, ...] = ()
    contributions: tuple[DemandContribution, ...] = ()
    coverage: tuple[SlotCoverage, ...] = ()
    warnings: tuple[QualityWarning, ...] = ()
    accepted_report_count: Count = 0
    rejected_report_count: Count = 0
    validation_failed: bool = Field(default=False, strict=True)


class ForecastCoverage(AIContract):
    verified_observations: Count = 0
    approximate_observations: Count = 0
    expected_slots: Count = 0
    complete_slots: Count = 0
    recipe_coverage: CoverageRatio | None = None


class ForecastPrediction(AIContract):
    ingredient_id: DomainId
    unit: IngredientUnit | None
    status: ForecastStatus
    predicted_demand: CalculatedQuantity | None = None
    uncertainty_lower: CalculatedQuantity | None = None
    uncertainty_upper: CalculatedQuantity | None = None
    model_version: str | None = Field(default=None, max_length=120)
    data_coverage: ForecastCoverage
    warnings: tuple[QualityWarning, ...] = ()

    @model_validator(mode="after")
    def coherent_prediction(self) -> "ForecastPrediction":
        bounds = (self.uncertainty_lower, self.uncertainty_upper)
        if self.status != ForecastStatus.AVAILABLE:
            if self.predicted_demand is not None or any(value is not None for value in bounds):
                raise ValueError("Unavailable model must not invent predictions or bounds")
        else:
            if self.predicted_demand is None or self.unit is None or not self.model_version:
                raise ValueError("Available prediction requires quantity, unit and model provenance")
            if (bounds[0] is None) != (bounds[1] is None):
                raise ValueError("Supply both uncertainty bounds or neither")
            if bounds[0] is not None and bounds[1] is not None and not bounds[0] <= self.predicted_demand <= bounds[1]:
                raise ValueError("Prediction must lie within its uncertainty bounds")
        return self


class ForecastResponse(AIContract):
    schema_version: Literal["AI1"] = "AI1"
    timezone: Literal["Asia/Ho_Chi_Minh"] = "Asia/Ho_Chi_Minh"
    branch_id: DomainId
    business_date: BusinessDate
    shift: Shift
    predictions: tuple[ForecastPrediction, ...]
    generated_at: Instant
    status: ForecastStatus
    advisory_only: Literal[True] = True
