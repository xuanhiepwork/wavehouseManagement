"""Standalone AI3 FastAPI entry point: uvicorn app.ai3_main:app (during final QA).

This file does not replace any existing app/main.py in the repository.
Bind to 127.0.0.1 or an isolated private network only.
"""

from fastapi import FastAPI
from .api.internal import router

app = FastAPI(
    title="WaveHouse AI3 Internal Forecasting",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.include_router(router)
