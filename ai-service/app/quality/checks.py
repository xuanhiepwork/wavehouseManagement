"""Quality diagnostics that do not log raw exports or validation inputs."""

from collections.abc import Iterable
from typing import Any

from pydantic import ValidationError

from app.schemas.outputs import QualityWarning


# Unknown extra keys may contain private user content. Do not echo those keys.
_CONTRACT_FIELDS = frozenset(
    "schema_version schemaVersion timezone exported_at exportedAt expected_slots "
    "expectedSlots ingredients reports historical_recipes historicalRecipes "
    "current_recipes currentRecipes mapping_mode mappingMode export_complete "
    "exportComplete stock_count_proxies stockCountProxies id unit min_stock "
    "minStock available_at availableAt ingredient_id ingredientId quantity "
    "product_variant_id productVariantId product_id productId size version "
    "created_at createdAt recipe_id recipeId recipe_version recipeVersion "
    "evidence_id evidenceId recipe_reference recipeReference report_id reportId "
    "number lines branch_id branchId business_date businessDate shift status "
    "current_revision_number currentRevisionNumber submitted_revision_number "
    "submittedRevisionNumber approved_revision_number approvedRevisionNumber "
    "approved_at approvedAt revisions variance".split()
)


def validation_warnings(error: ValidationError) -> tuple[QualityWarning, ...]:
    """Expose contract error locations, never the rejected values or context."""
    warnings: list[QualityWarning] = []
    for issue in error.errors(
        include_url=False, include_context=False, include_input=False
    ):
        location = issue.get("loc", ())
        parts = [
            str(part) if isinstance(part, int) or part in _CONTRACT_FIELDS
            else "unknown_field"
            for part in location
        ]
        index = next((part for part in location if isinstance(part, int)), None)
        warnings.append(QualityWarning(
            code="INPUT_VALIDATION_ERROR",
            severity="ERROR",
            message="Input does not satisfy the AI1 data contract.",
            field_path=".".join(parts) or "$",
            record_index=index,
        ))
    return tuple(warnings)


class QualityCollector:
    """Small explicit accumulator; callers decide which records are excluded."""

    def __init__(self) -> None:
        self.items: list[QualityWarning] = []

    def add(
        self,
        code: str,
        message: str,
        *,
        severity: str = "WARNING",
        **location: Any,
    ) -> None:
        self.items.append(QualityWarning(
            code=code, severity=severity, message=message, **location
        ))

    def extend(self, warnings: Iterable[QualityWarning]) -> None:
        self.items.extend(warnings)
