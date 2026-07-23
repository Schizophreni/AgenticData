"""Runtime configuration."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
DATA_DIR = Path(os.environ.get("AUTODATA_DATA_DIR", BASE_DIR / "var"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(os.environ.get("AUTODATA_DB", DATA_DIR / "autodata.sqlite3"))
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# Grounding source (the downloaded Zhihu corpus). Overridable per-recipe.
ZHIHU_IMG_DIRS = [
    Path(p) for p in os.environ.get(
        "ZHIHU_IMG_DIRS",
        "/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download/img:"
        "/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download/img2",
    ).split(":") if p
]

# Must not exceed the serving engine's --limit-mm-per-prompt image=N, or the
# request is rejected outright.
MAX_IMAGES_PER_DOC = int(os.environ.get("AUTODATA_MAX_IMAGES", "8"))

# Concurrency / safety caps.
MAX_INFLIGHT_DOCS = int(os.environ.get("AUTODATA_MAX_INFLIGHT", "4"))
DEFAULT_STEP_BUDGET = int(os.environ.get("AUTODATA_STEP_BUDGET", "15"))
HTTP_MAX_RETRIES = int(os.environ.get("AUTODATA_HTTP_RETRIES", "5"))
HTTP_TIMEOUT = float(os.environ.get("AUTODATA_HTTP_TIMEOUT", "120"))

# CORS origin for the Vite dev server.
FRONTEND_ORIGIN = os.environ.get("AUTODATA_FRONTEND_ORIGIN", "http://localhost:5173")
