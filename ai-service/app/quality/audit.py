"""Collect structured data quality findings; never silently hide invalid records."""

from typing import Literal

from ..schemas.outputs import QualityWarning


class QualityCollector:
    def __init__(self) -> None:
        self._warnings: list[QualityWarning] = []

    @property
    def warnings(self) -> tuple[QualityWarning, ...]:
        return tuple(self._warnings)

    @property
    def has_errors(self) -> bool:
        return any(item.severity == "ERROR" for item in self._warnings)

    def add(
        self,
        code: str,
        message: str,
        severity: Literal["INFO", "WARNING", "ERROR"] = "WARNING",
        **context: object,
    ) -> None:
        self._warnings.append(
            QualityWarning(code=code, message=message, severity=severity, **context)
        )
