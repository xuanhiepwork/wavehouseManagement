"""Prepare exact theoretical demand from an authorized, read-only export.

There is deliberately no database client, network client, inventory writer,
training call, or implicit lookup of today's active recipe in this module.
"""

from collections import defaultdict
from datetime import datetime
from decimal import Decimal, localcontext
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.quality.checks import QualityCollector, validation_warnings
from app.schemas.common import (
    AvailabilityStatus, CoverageStatus, DemandBasis, MappingMode, SalesStatus,
)
from app.schemas.inputs import (
    IngredientRecord, PreparationRequest, RecipeRecord, SalesLine,
    SalesReportRecord, SalesRevision,
)
from app.schemas.outputs import (
    DemandContribution, DemandObservation, PreparedDataset, SlotCoverage,
)


_ZERO = Decimal("0")
_ONE = Decimal("1")
_LOCAL_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def _slot(record: Any) -> tuple[Any, ...]:
    return record.branch_id, record.business_date, record.shift


def _location(report: SalesReportRecord) -> dict[str, Any]:
    return {
        "branch_id": report.branch_id,
        "business_date": report.business_date,
        "shift": report.shift,
        "report_id": report.id,
    }


def _unique_records(
    records: tuple[Any, ...], name: str, quality: QualityCollector,
) -> tuple[dict[UUID, Any], set[UUID]]:
    """Deduplicate identical transport copies; quarantine conflicting IDs."""
    result: dict[UUID, Any] = {}
    conflicts: set[UUID] = set()
    for index, record in enumerate(records):
        if record.id in conflicts:
            quality.add(f"CONFLICTING_{name}", "Conflicting source ID remains excluded.",
                        severity="ERROR", record_index=index)
        elif record.id not in result:
            result[record.id] = record
        elif result[record.id] == record:
            quality.add(f"DUPLICATE_{name}", "An identical transport copy was counted once.",
                        record_index=index)
        else:
            quality.add(f"CONFLICTING_{name}", "Conflicting records share a source ID; all copies are excluded.",
                        severity="ERROR", record_index=index)
            conflicts.add(record.id)
            del result[record.id]
    return result, conflicts


def _recipe_indexes(
    request: PreparationRequest,
    ingredients: dict[UUID, IngredientRecord],
    quality: QualityCollector,
) -> tuple[dict[UUID, RecipeRecord], dict[tuple[Any, ...], RecipeRecord]]:
    # The same unchanged Recipe can legitimately be both historical and active.
    recipes, _ = _unique_records(
        request.historical_recipes + request.current_recipes, "RECIPE", quality
    )
    invalid: set[UUID] = set()
    for recipe in recipes.values():
        if recipe.available_at > request.exported_at or recipe.created_at > request.exported_at:
            invalid.add(recipe.id)
            quality.add("RECIPE_NOT_AVAILABLE_AT_EXPORT", "Recipe timestamps are later than the export.", severity="ERROR")
        if not recipe.ingredients:
            invalid.add(recipe.id)
            quality.add("EMPTY_RECIPE", "A recipe without ingredient composition cannot establish historical coverage.", severity="ERROR")
        seen: set[UUID] = set()
        for item in recipe.ingredients:
            ingredient = ingredients.get(item.ingredient_id)
            if item.ingredient_id in seen:
                invalid.add(recipe.id)
                quality.add("DUPLICATE_RECIPE_INGREDIENT", "Recipe repeats an ingredient; the recipe is excluded.",
                            severity="ERROR", ingredient_id=item.ingredient_id)
            seen.add(item.ingredient_id)
            if ingredient is None:
                invalid.add(recipe.id)
                quality.add("MISSING_INGREDIENT_REFERENCE", "Recipe references an ingredient absent from the supplied catalog.",
                            ingredient_id=item.ingredient_id)
            elif ingredient.unit is None or item.unit is None:
                invalid.add(recipe.id)
                quality.add("MISSING_INGREDIENT_UNIT", "Recipe or ingredient unit is unavailable; quantities are not inferred.",
                            ingredient_id=item.ingredient_id)
            elif ingredient.unit != item.unit:
                invalid.add(recipe.id)
                quality.add("INCOMPATIBLE_INGREDIENT_UNITS", "Recipe and ingredient use incompatible units; no conversion is assumed.",
                            severity="ERROR", ingredient_id=item.ingredient_id)
    usable = {key: value for key, value in recipes.items() if key not in invalid}
    historical_ids = {recipe.id for recipe in request.historical_recipes}
    historical = {key: recipe for key, recipe in usable.items() if key in historical_ids}
    current: dict[tuple[Any, ...], RecipeRecord] = {}
    conflicts: set[tuple[Any, ...]] = set()
    for recipe in request.current_recipes:
        if recipe.id not in usable:
            continue
        key = recipe.product_id, recipe.size
        if key in conflicts:
            continue
        previous = current.get(key)
        if previous is not None and previous.id != recipe.id:
            del current[key]
            conflicts.add(key)
            quality.add("AMBIGUOUS_CURRENT_RECIPE", "More than one supplied current recipe maps to the same product and size; approximation is excluded.", severity="ERROR")
        else:
            current[key] = usable[recipe.id]
    return historical, current


def _approved_revision(
    report: SalesReportRecord,
    exported_at: datetime,
    quality: QualityCollector,
) -> SalesRevision | None:
    location = _location(report)
    if (
        report.approved_at is None
        or report.approved_revision_number is None
        or report.approved_revision_number != report.current_revision_number
        or report.approved_revision_number != report.submitted_revision_number
        or report.approved_at > exported_at
        or report.business_date > report.approved_at.astimezone(_LOCAL_ZONE).date()
    ):
        quality.add("INVALID_APPROVED_REVISION", "Approval metadata does not identify the current submitted revision consistently.", severity="ERROR", **location)
        return None
    by_number: dict[int, SalesRevision] = {}
    invalid_numbers: set[int] = set()
    revision_ids: dict[UUID, SalesRevision] = {}
    for revision in report.revisions:
        if revision.report_id != report.id:
            quality.add("REVISION_REPORT_MISMATCH", "A supplied revision belongs to another report and is excluded.", severity="ERROR", revision_number=revision.number, **location)
            invalid_numbers.add(revision.number)
            continue
        previous = by_number.get(revision.number)
        previous_id = revision_ids.get(revision.id)
        if previous is not None:
            if previous == revision:
                quality.add("DUPLICATE_REPORT_REVISION", "An identical revision copy was counted once.", revision_number=revision.number, **location)
            else:
                invalid_numbers.add(revision.number)
                quality.add("CONFLICTING_REPORT_REVISION", "Conflicting copies of a revision are excluded.", severity="ERROR", revision_number=revision.number, **location)
        elif previous_id is not None and previous_id.number != revision.number:
            invalid_numbers.update((previous_id.number, revision.number))
            quality.add("CONFLICTING_REVISION_ID", "A revision ID is associated with multiple revision numbers.", severity="ERROR", **location)
        else:
            by_number[revision.number] = revision
            revision_ids[revision.id] = revision
    number = report.approved_revision_number
    revision = by_number.get(number)
    if number in invalid_numbers or revision is None:
        quality.add("MISSING_APPROVED_REVISION", "The exact approved revision is missing or conflicting; other revisions are not substituted.", severity="ERROR", revision_number=number, **location)
        return None
    if revision.created_at > report.approved_at:
        quality.add("INVALID_REVISION_CHRONOLOGY", "Approved revision was created after approval.", severity="ERROR", revision_number=number, **location)
        return None
    ids = [line.id for line in revision.lines]
    if len(set(ids)) != len(ids):
        quality.add("DUPLICATE_SALES_LINE", "Approved revision repeats a sales-line ID and cannot be counted reliably.", severity="ERROR", revision_number=number, **location)
        return None
    if any(line.quantity == 0 for line in revision.lines):
        # W7.3 validates positive quantities on submission; true zero shifts use
        # an explicitly approved empty revision, not zero-valued draft lines.
        quality.add("INCONSISTENT_APPROVED_SALES_QUANTITY", "Approved sales lines must be positive; zero sales require an approved empty revision.", severity="ERROR", revision_number=number, **location)
        return None
    if len(report.revisions) > 1:
        quality.add("NON_EFFECTIVE_REVISIONS_EXCLUDED", "Only the effective approved revision contributes demand; revision history is not summed.", severity="INFO", revision_number=number, **location)
    return revision


def _mapping(
    line: SalesLine,
    report: SalesReportRecord,
    historical: dict[UUID, RecipeRecord],
    current: dict[tuple[Any, ...], RecipeRecord],
    request: PreparationRequest,
    quality: QualityCollector,
) -> tuple[RecipeRecord, DemandBasis, datetime, UUID | None] | None:
    location = {**_location(report), "sales_line_id": line.id}
    if line.product_id is None or line.size == "OTHER":
        quality.add("MISSING_PRODUCT_VARIANT_REFERENCE", "The sales line has no supported product and size reference; a name is never used for matching.", **location)
        return None
    reference = line.recipe_reference
    if reference is not None:
        recipe = historical.get(reference.recipe_id)
        if recipe is None:
            quality.add("HISTORICAL_RECIPE_UNAVAILABLE", "The explicitly referenced historical recipe version is unavailable or invalid.", **location)
        elif (
            recipe.version != reference.recipe_version
            or recipe.product_variant_id != reference.product_variant_id
            or recipe.product_id != line.product_id
            or recipe.size != line.size
        ):
            quality.add("HISTORICAL_RECIPE_REFERENCE_MISMATCH", "Historical recipe identity, version, product variant or size does not match the sales line.", severity="ERROR", **location)
        elif (
            reference.available_at > request.exported_at
            or recipe.created_at.astimezone(_LOCAL_ZONE).date() > report.business_date
        ):
            quality.add("INVALID_HISTORICAL_RECIPE_CHRONOLOGY", "Historical mapping evidence is unavailable at export or recipe creation is later than the sale date.", severity="ERROR", **location)
        else:
            return recipe, DemandBasis.VERIFIED_HISTORICAL_THEORETICAL, max(recipe.available_at, reference.available_at), reference.evidence_id
    else:
        quality.add("MISSING_HISTORICAL_RECIPE_REFERENCE", "W7.3 sales do not snapshot recipe composition; exact historical demand is unavailable without explicit mapping evidence.", **location)
    if request.mapping_mode == MappingMode.ALLOW_CURRENT_APPROXIMATION:
        recipe = current.get((line.product_id, line.size))
        if recipe is not None:
            quality.add("CURRENT_RECIPE_APPROXIMATION", "Explicit opt-in uses a supplied current recipe as an approximation; this is not verified historical consumption.", **location)
            return recipe, DemandBasis.APPROXIMATE_CURRENT_RECIPE, recipe.available_at, None
        quality.add("CURRENT_RECIPE_UNAVAILABLE", "No unambiguous supplied current recipe is available for the requested approximation.", **location)
    return None


def _coverage(mapped: int, total: int) -> CoverageStatus:
    if total == 0 or mapped == total:
        return CoverageStatus.COMPLETE
    return CoverageStatus.PARTIAL if mapped else CoverageStatus.MISSING


def _fraction(mapped: int, total: int) -> Decimal:
    if total == 0:
        return _ONE
    # Finite representation for coverage only. Demand products/sums remain exact.
    return Decimal(mapped) / Decimal(total)


def prepare_dataset(request: PreparationRequest) -> PreparedDataset:
    """Return a dataset without mutating its input or any external system.

    Partial observations are known contributions, never complete demand labels.
    An approximate observation includes verified contributions plus explicitly
    approximated remaining lines for that report, and is a separate stream.
    """
    quality = QualityCollector()
    ingredients, _ = _unique_records(request.ingredients, "INGREDIENT", quality)
    for ingredient_id, ingredient in list(ingredients.items()):
        if ingredient.available_at > request.exported_at:
            quality.add("INGREDIENT_NOT_AVAILABLE_AT_EXPORT", "Ingredient metadata is not yet available at export.", severity="ERROR", ingredient_id=ingredient_id)
            del ingredients[ingredient_id]
        elif ingredient.unit is None:
            quality.add("MISSING_INGREDIENT_UNIT", "Ingredient unit is missing; no demand observation will be emitted for it.", ingredient_id=ingredient_id)
    historical, current = _recipe_indexes(request, ingredients, quality)
    reports, conflicting_report_ids = _unique_records(request.reports, "SALES_REPORT", quality)
    records_by_slot: dict[tuple[Any, ...], list[SalesReportRecord]] = defaultdict(list)
    for report in reports.values():
        records_by_slot[_slot(report)].append(report)
    # Conflicting copies must still reserve their original slots so an expected
    # slot cannot accidentally be described as a genuine missing report.
    conflicting_slots = {
        _slot(report) for report in request.reports
        if report.id in conflicting_report_ids
    }
    expected = {_slot(slot) for slot in request.expected_slots}
    if len(expected) != len(request.expected_slots):
        quality.add("DUPLICATE_EXPECTED_SLOT", "Duplicate supplied expected slots were counted once.")
    if not request.expected_slots:
        quality.add("EXPECTED_SCHEDULE_UNAVAILABLE", "No expected branch/shift schedule was supplied; missing shifts cannot be inferred from absent rows.")
    if not request.export_complete:
        quality.add("INCOMPLETE_SOURCE_EXPORT", "The export is incomplete; absent reports cannot establish no-report or zero demand.")
    for proxy in request.stock_count_proxies:
        quality.add("UNRELIABLE_INVENTORY_VARIANCE_PROXY", "B6 inventory variance includes unexplained differences and is excluded from theoretical demand and model targets.",
                    branch_id=proxy.branch_id, business_date=proxy.business_date,
                    shift=proxy.shift, ingredient_id=proxy.ingredient_id)

    observations: list[DemandObservation] = []
    contributions: list[DemandContribution] = []
    coverage_rows: list[SlotCoverage] = []
    accepted = 0
    rejected = len(conflicting_report_ids)
    all_slots = expected | set(records_by_slot) | conflicting_slots
    ordered_slots = sorted(all_slots, key=lambda key: (str(key[0]), key[1], str(key[2])))
    # Input DB quantities have at most 18 digits. This local context also covers
    # multiplication by sales integers and bounded aggregation without changing
    # the process-global Decimal context used by another module.
    with localcontext() as context:
        context.prec = 80
        for key in ordered_slots:
            branch_id, business_date, shift = key
            records = records_by_slot.get(key, [])
            basic = {"branch_id": branch_id, "business_date": business_date, "shift": shift}
            if key in conflicting_slots or len(records) > 1:
                quality.add("CONFLICTING_BRANCH_SHIFT_REPORTS", "The same branch/date/shift has conflicting reports; the slot is quarantined.", severity="ERROR", **basic)
                coverage_rows.append(SlotCoverage(**basic, availability=AvailabilityStatus.INVALID, coverage=CoverageStatus.INVALID))
                rejected += len(records)
                continue
            if not records:
                availability = AvailabilityStatus.NO_REPORT if request.export_complete else AvailabilityStatus.INVALID
                quality.add("MISSING_APPROVED_REPORT" if request.export_complete else "REPORT_AVAILABILITY_UNKNOWN",
                            "Expected branch/date/shift has no report in the complete export." if request.export_complete else "An incomplete export cannot determine whether an expected report exists.", **basic)
                coverage_rows.append(SlotCoverage(**basic, availability=availability, coverage=CoverageStatus.MISSING))
                continue
            report = records[0]
            report_basic = {**basic, "report_id": report.id}
            if report.available_at > request.exported_at:
                quality.add("REPORT_NOT_AVAILABLE_AT_EXPORT", "Report availability timestamp is later than the export.", severity="ERROR", **report_basic)
                coverage_rows.append(SlotCoverage(**report_basic, availability=AvailabilityStatus.INVALID, coverage=CoverageStatus.INVALID))
                rejected += 1
                continue
            if report.status != SalesStatus.APPROVED:
                quality.add("UNAPPROVED_REPORT_EXCLUDED", "Draft, submitted and returned reports do not contribute official historical demand.", **report_basic)
                coverage_rows.append(SlotCoverage(**report_basic, availability=AvailabilityStatus.UNAPPROVED_REPORT,
                                                 coverage=CoverageStatus.MISSING, available_at=report.available_at))
                continue
            revision = _approved_revision(report, request.exported_at, quality)
            if revision is None:
                coverage_rows.append(SlotCoverage(**report_basic, availability=AvailabilityStatus.INVALID,
                                                 coverage=CoverageStatus.INVALID, available_at=report.available_at))
                rejected += 1
                continue
            accepted += 1
            total = sum(line.quantity for line in revision.lines)
            availability = AvailabilityStatus.APPROVED_RECORDED_SALES if total else AvailabilityStatus.APPROVED_ZERO_SALES
            available_at = max(report.available_at, report.approved_at, revision.created_at)
            verified_mapped = 0
            approximate_mapped = 0
            verified_totals: dict[UUID, Decimal] = defaultdict(lambda: _ZERO)
            approximate_totals: dict[UUID, Decimal] = defaultdict(lambda: _ZERO)
            verified_available = available_at
            combined_available = available_at
            for line in revision.lines:
                resolved = _mapping(line, report, historical, current, request, quality)
                if resolved is None:
                    continue
                recipe, basis, recipe_available, evidence_id = resolved
                line_available = max(available_at, recipe_available, *(ingredients[item.ingredient_id].available_at for item in recipe.ingredients))
                combined_available = max(combined_available, line_available)
                verified = basis == DemandBasis.VERIFIED_HISTORICAL_THEORETICAL
                if verified:
                    verified_mapped += line.quantity
                    verified_available = max(verified_available, line_available)
                else:
                    approximate_mapped += line.quantity
                for item in recipe.ingredients:
                    demand = Decimal(line.quantity) * item.quantity
                    target = verified_totals if verified else approximate_totals
                    target[item.ingredient_id] += demand
                    contributions.append(DemandContribution(
                        report_id=report.id, revision_id=revision.id,
                        approved_revision_number=revision.number, sales_line_id=line.id,
                        **basic, product_id=line.product_id, size=line.size,
                        quantity_sold=line.quantity, recipe_id=recipe.id,
                        recipe_version=recipe.version,
                        product_variant_id=recipe.product_variant_id,
                        ingredient_id=item.ingredient_id, unit=item.unit,
                        quantity_per_beverage=item.quantity, theoretical_demand=demand,
                        basis=basis, available_at=line_available,
                        recipe_evidence_id=evidence_id,
                    ))
            verified_coverage = _coverage(verified_mapped, total)
            coverage_rows.append(SlotCoverage(
                **report_basic, approved_revision_number=revision.number,
                availability=availability, coverage=verified_coverage,
                quantity_sold=total, mapped_quantity_sold=verified_mapped,
                available_at=verified_available,
            ))
            if verified_coverage != CoverageStatus.COMPLETE:
                quality.add("INCOMPLETE_RECIPE_COVERAGE", "Unmapped sold beverages may contain any ingredient; known contributions are partial and absent ingredients are not assumed zero.", **report_basic)
            for ingredient in ingredients.values():
                if ingredient.unit is None:
                    continue
                # A complete basket (including a confirmed zero shift) can prove
                # a zero theoretical quantity. A partial basket cannot.
                if verified_coverage == CoverageStatus.COMPLETE or ingredient.id in verified_totals:
                    observations.append(DemandObservation(
                        **basic, ingredient_id=ingredient.id, unit=ingredient.unit,
                        theoretical_demand=verified_totals.get(ingredient.id, _ZERO),
                        basis=DemandBasis.VERIFIED_HISTORICAL_THEORETICAL,
                        coverage=verified_coverage, availability=availability,
                        report_ids=(report.id,), approved_report_count=1,
                        quantity_sold=total, mapped_quantity_sold=verified_mapped,
                        available_at=max(verified_available, ingredient.available_at),
                        recipe_coverage=_fraction(verified_mapped, total),
                    ))
                if not approximate_mapped:
                    continue
                combined_mapped = verified_mapped + approximate_mapped
                combined_coverage = _coverage(combined_mapped, total)
                if combined_coverage == CoverageStatus.COMPLETE or ingredient.id in verified_totals or ingredient.id in approximate_totals:
                    observations.append(DemandObservation(
                        **basic, ingredient_id=ingredient.id, unit=ingredient.unit,
                        theoretical_demand=verified_totals.get(ingredient.id, _ZERO) + approximate_totals.get(ingredient.id, _ZERO),
                        basis=DemandBasis.APPROXIMATE_CURRENT_RECIPE,
                        coverage=combined_coverage, availability=availability,
                        report_ids=(report.id,), approved_report_count=1,
                        quantity_sold=total, mapped_quantity_sold=combined_mapped,
                        available_at=max(combined_available, ingredient.available_at),
                        recipe_coverage=_fraction(combined_mapped, total),
                    ))
    return PreparedDataset(
        exported_at=request.exported_at, observations=tuple(observations),
        contributions=tuple(contributions), coverage=tuple(coverage_rows),
        warnings=tuple(quality.items), accepted_report_count=accepted,
        rejected_report_count=rejected,
    )


def prepare_payload(raw: object) -> PreparedDataset:
    """Validate an untrusted payload before preparation; fail closed as a batch.

    No rejected record is silently removed to produce a misleading clean batch.
    Raw values, notes, credentials and Pydantic error inputs are not returned.
    """
    try:
        request = PreparationRequest.model_validate(raw)
    except ValidationError as error:
        return PreparedDataset(
            exported_at=None, validation_failed=True,
            warnings=validation_warnings(error),
        )
    return prepare_dataset(request)
