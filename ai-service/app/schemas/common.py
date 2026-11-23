"""Shared wire contracts: camelCase, exact decimals, explicit local business dates."""

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
import re
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer


TIMEZONE = "Asia/Ho_Chi_Minh"
SCHEMA_VERSION = "AI1"


def _camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.title() for part in rest)


class AIContract(BaseModel):
    """Only declared business fields are accepted; credentials/notes are not data."""

    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
        allow_inf_nan=False,
        validate_default=True,
        hide_input_in_errors=True,
    )


def _uuid(value: Any) -> UUID:
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value):
        raise ValueError("UUID string required")
    return UUID(value)


def _business_date(value: Any) -> date:
    if type(value) is date:
        return value
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Business date must use YYYY-MM-DD")
    return date.fromisoformat(value)


def _instant(value: Any) -> datetime:
    if isinstance(value, str):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
            raise ValueError("Timestamp must contain an explicit UTC offset")
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timezone-aware timestamp required")
    return value.astimezone(timezone.utc)


def decimal_text(value: Decimal) -> str:
    """Never send IEEE floats or exponential notation over the integration boundary."""
    result = format(value, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return "0" if result in ("", "-0") else result


def _decimal(value: Any, *, database_quantity: bool) -> Decimal:
    if isinstance(value, Decimal):
        raw = format(value, "f")
    elif isinstance(value, str):
        raw = value
    else:
        raise ValueError("Decimal quantities must be strings, never binary floats")
    if len(raw) > 120 or not re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d{1,6})?", raw):
        raise ValueError("Use a canonical decimal string with at most six fractional places")
    try:
        number = Decimal(raw)
    except InvalidOperation as error:
        raise ValueError("Invalid decimal quantity") from error
    if not number.is_finite():
        raise ValueError("Finite decimal required")
    if database_quantity and len(raw.lstrip("-").split(".")[0]) > 12:
        raise ValueError("Quantity exceeds PostgreSQL numeric(18,6)")
    return number


def _db_quantity(value: Any) -> Decimal:
    return _decimal(value, database_quantity=True)


def _calculated_quantity(value: Any) -> Decimal:
    return _decimal(value, database_quantity=False)


def _ratio(value: Any) -> Decimal:
    if not isinstance(value, (Decimal, str)):
        raise ValueError("Coverage ratios must use decimal strings")
    try:
        result = Decimal(value)
    except InvalidOperation as error:
        raise ValueError("Invalid coverage ratio") from error
    if not result.is_finite() or result < 0 or result > 1:
        raise ValueError("Coverage must be between zero and one")
    return result


DomainId = Annotated[UUID, BeforeValidator(_uuid)]
BusinessDate = Annotated[date, BeforeValidator(_business_date)]
Instant = Annotated[datetime, BeforeValidator(_instant)]
Quantity = Annotated[Decimal, BeforeValidator(_db_quantity), PlainSerializer(decimal_text, return_type=str, when_used="json")]
NonnegativeQuantity = Annotated[Quantity, Field(ge=0)]
PositiveQuantity = Annotated[Quantity, Field(gt=0)]
# Aggregation is not a DB write: its result must not inherit a single-row numeric(18,6) limit.
CalculatedQuantity = Annotated[Decimal, BeforeValidator(_calculated_quantity), Field(ge=0), PlainSerializer(decimal_text, return_type=str, when_used="json")]
CoverageRatio = Annotated[Decimal, BeforeValidator(_ratio), PlainSerializer(decimal_text, return_type=str, when_used="json")]
PositiveInt = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
Count = Annotated[int, Field(strict=True, ge=0)]


class Shift(str, Enum):
    MORNING = "MORNING"
    AFTERNOON = "AFTERNOON"
    EVENING = "EVENING"


class IngredientUnit(str, Enum):
    g = "g"
    ml = "ml"
    piece = "piece"


class SalesStatus(str, Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    RETURNED = "RETURNED"
    APPROVED = "APPROVED"


class MappingMode(str, Enum):
    VERIFIED_ONLY = "VERIFIED_ONLY"
    ALLOW_CURRENT_APPROXIMATION = "ALLOW_CURRENT_APPROXIMATION"


class DemandBasis(str, Enum):
    VERIFIED_HISTORICAL_THEORETICAL = "VERIFIED_HISTORICAL_THEORETICAL"
    APPROXIMATE_CURRENT_RECIPE = "APPROXIMATE_CURRENT_RECIPE"


class AvailabilityStatus(str, Enum):
    NO_REPORT = "NO_REPORT"
    UNAPPROVED_REPORT = "UNAPPROVED_REPORT"
    APPROVED_ZERO_SALES = "APPROVED_ZERO_SALES"
    APPROVED_RECORDED_SALES = "APPROVED_RECORDED_SALES"
    INVALID = "INVALID"


class CoverageStatus(str, Enum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    MISSING = "MISSING"
    INVALID = "INVALID"


class ForecastStatus(str, Enum):
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    MODEL_NOT_CONFIGURED = "MODEL_NOT_CONFIGURED"
    AVAILABLE = "AVAILABLE"
