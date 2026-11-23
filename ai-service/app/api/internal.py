"""Authenticated, read-only AI2 inference endpoint for trusted Express backend.

No training, model writes, database access, inventory writes or background jobs.
A model registry artifact is read lazily only when an authorized request arrives.
"""

from functools import lru_cache
from hmac import compare_digest
import json
import os
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..forecasting.interface import unconfigured_forecast
from ..ml.provider import TrainedRidgeForecastProvider
from ..ml.training import registry_from_document
from ..schemas.inputs import ForecastRequest

router = APIRouter(prefix="/internal/ai/v1", tags=["internal-ai3"])
_MAX_REQUEST_BYTES = 8 * 1024 * 1024
_MAX_MODEL_BYTES = 12 * 1024 * 1024


def _authorize(shared_key: str | None) -> None:
    configured_key = os.environ.get("WAVEHOUSE_AI3_SHARED_KEY", "")
    # Refuse to serve when the key is missing, weak or not identical.
    if len(configured_key) < 32:
        raise HTTPException(status_code=503, detail="AI service not configured")
    if not isinstance(shared_key, str) or not compare_digest(shared_key, configured_key):
        raise HTTPException(status_code=401, detail="Unauthorized")


@lru_cache(maxsize=1)
def _provider() -> TrainedRidgeForecastProvider | None:
    """Lazy artifact read, cached until service restart (no hot-reload or training)."""
    filename = os.environ.get("WAVEHOUSE_AI3_MODEL_ARTIFACT", "").strip()
    if not filename:
        return None
    path = Path(filename).expanduser()
    if not path.is_file() or path.stat().st_size > _MAX_MODEL_BYTES:
        raise ValueError("AI model artifact unavailable or oversized")
    # Artifact is trusted deployment input, NOT user-submitted pickle/code.
    with path.open("r", encoding="utf-8") as stream:
        document = json.load(stream)
    registry = registry_from_document(document)
    return TrainedRidgeForecastProvider(registry)


async def _read_bounded(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared:
        try:
            length = int(declared)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid content length") from exc
        if length > _MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="AI request too large")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > _MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="AI request too large")
        data.extend(chunk)
    return bytes(data)


@router.get("/status")
def status(x_wavehouse_ai_key: str | None = Header(default=None)) -> dict[str, object]:
    """Authenticated configuration indicator; not a forecast/health public endpoint."""
    _authorize(x_wavehouse_ai_key)
    return {"service": "wavehouse-ai3", "advisoryOnly": True,
            "modelArtifactConfigured": bool(os.environ.get("WAVEHOUSE_AI3_MODEL_ARTIFACT"))}


@router.post("/forecast")
async def forecast(
    request: Request,
    x_wavehouse_ai_key: str | None = Header(default=None),
) -> JSONResponse:
    _authorize(x_wavehouse_ai_key)
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="Use application/json")
    raw = await _read_bounded(request)
    try:
        payload = ForecastRequest.model_validate_json(raw)
    except (ValueError, ValidationError) as exc:
        # Never echo data, tokens, private reports or Pydantic input back to caller.
        raise HTTPException(status_code=422, detail="Invalid AI1 forecast request") from exc

    try:
        provider = _provider()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="AI model artifact unavailable") from exc

    try:
        result = provider.forecast(payload) if provider is not None else unconfigured_forecast(payload)
    except (ValueError, ArithmeticError, OverflowError) as exc:
        raise HTTPException(status_code=503, detail="AI inference unavailable") from exc

    return JSONResponse(content=result.model_dump(mode="json", by_alias=True))
