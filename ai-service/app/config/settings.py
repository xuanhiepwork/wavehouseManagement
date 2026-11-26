"""Explicit immutable processing configuration. No environment files are loaded."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureSettings:
    lag_days: tuple[int, ...] = (1, 7, 14)
    rolling_days: tuple[int, ...] = (7, 28)
    minimum_verified_observations: int = 1

    def __post_init__(self) -> None:
        for values in (self.lag_days, self.rolling_days):
            if not values or len(set(values)) != len(values) or any(type(value) is not int or not 1 <= value <= 3660 for value in values):
                raise ValueError("Feature windows require unique positive calendar day offsets")
        if type(self.minimum_verified_observations) is not int or self.minimum_verified_observations < 1:
            raise ValueError("Minimum history must be a positive integer")
