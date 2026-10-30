"""API shell; AI prediction endpoints are not implemented yet."""

from fastapi import FastAPI

app = FastAPI(title="WaveHouse AI Service", version="1.0.0")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "WaveHouse AI Service", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
