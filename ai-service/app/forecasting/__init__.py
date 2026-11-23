"""Advisory forecast contracts only; no trained models in AI1."""

from .interface import ForecastProvider, unconfigured_forecast

__all__ = ["ForecastProvider", "unconfigured_forecast"]
