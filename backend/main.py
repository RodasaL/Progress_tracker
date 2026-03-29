from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(
    os.environ.get(
        "DB_PATH",
        str(BASE_DIR / "backend" / "data" / "progress_tracker.db"),
    )
).resolve()
DIST_DIR = Path(os.environ.get("DIST_DIR", str(BASE_DIR / "dist"))).resolve()
TIME_API_BASE_URL = os.environ.get("TIME_API_BASE_URL", "https://timeapi.io/api/Time/current/zone")
TIME_API_TIMEZONE = os.environ.get("TIME_API_TIMEZONE", "UTC")


class StatePayload(BaseModel):
    state: dict[str, Any]


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                state_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def get_state() -> dict[str, Any] | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT state_json FROM app_state WHERE id = 1").fetchone()
    if not row:
        return None

    try:
        return json.loads(row[0])
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Stored state is corrupted") from exc


def save_state(state: dict[str, Any]) -> None:
    state_json = json.dumps(state, separators=(",", ":"))
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO app_state (id, state_json, updated_at)
            VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (state_json,),
        )


def fetch_time_from_timeapi() -> dict[str, str]:
    query = parse.urlencode({"timeZone": TIME_API_TIMEZONE})
    url = f"{TIME_API_BASE_URL}?{query}"

    try:
        with request.urlopen(url, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (error.URLError, TimeoutError, json.JSONDecodeError):
        now = datetime.now(timezone.utc)
        return {
            "now": now.isoformat(),
            "today": now.date().isoformat(),
            "timezone": "UTC",
            "source": "fallback-local",
        }

    year = payload.get("year")
    month = payload.get("month")
    day = payload.get("day")
    hour = payload.get("hour", 0)
    minute = payload.get("minute", 0)
    seconds = payload.get("seconds", 0)

    if isinstance(year, int) and isinstance(month, int) and isinstance(day, int):
        now_text = f"{year:04d}-{month:02d}-{day:02d}T{int(hour):02d}:{int(minute):02d}:{int(seconds):02d}"
        today_text = f"{year:04d}-{month:02d}-{day:02d}"
    else:
        date_time_text = str(payload.get("dateTime") or "")
        now_text = date_time_text if date_time_text else datetime.now(timezone.utc).isoformat()
        today_text = now_text.split("T")[0]

    return {
        "now": now_text,
        "today": today_text,
        "timezone": str(payload.get("timeZone") or TIME_API_TIMEZONE),
        "source": "timeapi.io",
    }


init_db()
app = FastAPI(title="Progress Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api", include_in_schema=False)
@app.get("/api/", include_in_schema=False)
def api_index() -> RedirectResponse:
    return RedirectResponse(url="/docs", status_code=307)


@app.get("/api/time")
def server_time() -> dict[str, str]:
    return fetch_time_from_timeapi()


@app.get("/api/state")
def read_state() -> dict[str, Any]:
    state = get_state()
    return {"state": state}


@app.put("/api/state")
def write_state(payload: StatePayload) -> dict[str, str]:
    save_state(payload.state)
    return {"status": "saved"}


if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/{path:path}")
def spa(path: str) -> FileResponse:
    index_file = DIST_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(
            status_code=404,
            detail="dist/index.html not found. Run `npm run build` first.",
        )

    requested = DIST_DIR / path
    if path and requested.exists() and requested.is_file():
        return FileResponse(requested)

    return FileResponse(index_file)


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("backend.main:app", host=host, port=port, reload=False)
