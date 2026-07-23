"""Thin SQLite storage layer (sync sqlite3 behind async-friendly helpers).

SQLite writes are fast and the engine's concurrency is I/O-bound on model calls,
so a module-level connection with a lock is sufficient for v1.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from typing import Any, Optional

from . import config

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(config.SCHEMA_PATH.read_text())
    return _conn


def init() -> None:
    with _lock:
        _connect()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def execute(sql: str, params: tuple = ()) -> None:
    with _lock:
        conn = _connect()
        conn.execute(sql, params)
        conn.commit()


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def query_one(sql: str, params: tuple = ()) -> Optional[dict[str, Any]]:
    rows = query(sql, params)
    return rows[0] if rows else None


def j(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def unj(value: Optional[str], default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default


def now() -> float:
    return time.time()
