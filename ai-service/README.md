# WaveHouse AI Service

Requires Python 3.10 or later. From this directory:

```sh
python -m venv .venv
```

Activate `.venv` (`.venv\Scripts\Activate.ps1` on PowerShell, or
`source .venv/bin/activate` on macOS/Linux), then:

```sh
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`GET /` returns service information, `/health` returns service health, and
`/docs` serves interactive API documentation. The container runs this FastAPI
application with Uvicorn, following the [FastAPI container guidance](https://fastapi.tiangolo.com/deployment/docker/).

Gemini/RAG, forecasts, routing and database integration are not implemented yet;
no API key is required for these status endpoints.
