"""Runs, their idempotency keys and their reports, in SQLite (ADR-0071 §5).

A run row keeps what a caller can read (state, progress, usage, outcome, error), the report, and,
only while the run is not finished, the request itself, so a restart can run it again. Document
text is dropped the moment a run ends.

Each call opens its own short connection (WAL mode), so worker threads and request threads never
share one. This is the whole of the storage the service needs; where it lives for good is the open
question in ADR-0071, and this class is what would be replaced.
"""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

IN_PROGRESS = ("queued", "running", "cancelling")
TERMINAL = ("succeeded", "partial", "failed", "cancelled")
_JSON_COLUMNS = ("progress", "usage", "outcome", "error", "request")
_COLUMNS = (
    "state",
    "started_at",
    "finished_at",
    "progress",
    "usage",
    "outcome",
    "error",
    "report",
    "request",
)
_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    idem_key    TEXT NOT NULL UNIQUE,
    body_digest TEXT NOT NULL,
    state       TEXT NOT NULL,
    created_at  REAL NOT NULL,
    started_at  REAL,
    finished_at REAL,
    progress    TEXT,
    usage       TEXT NOT NULL,
    outcome     TEXT,
    error       TEXT,
    report      TEXT,
    request     TEXT
)
"""
Row = dict[str, Any]


class RunStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(_SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    @staticmethod
    def _row(raw: sqlite3.Row | None) -> Row | None:
        if raw is None:
            return None
        row: Row = dict(raw)
        for name in _JSON_COLUMNS:
            if row[name] is not None:
                row[name] = json.loads(row[name])
        return row

    def ping(self) -> None:
        """Raises if the database cannot be read."""
        with self._connect() as db:
            db.execute("SELECT 1 FROM runs LIMIT 1").fetchall()

    def create(
        self, run_id: str, key: str, digest: str, request: dict[str, Any], now: float
    ) -> None:
        """A new queued run. Raises `sqlite3.IntegrityError` if the key is already used."""
        usage = json.dumps({"calls": 0, "cache_hits": 0, "input_tokens": 0, "output_tokens": 0})
        with self._connect() as db:
            db.execute(
                "INSERT INTO runs (id, idem_key, body_digest, state, created_at, usage, request) "
                "VALUES (?, ?, ?, 'queued', ?, ?, ?)",
                (run_id, key, digest, now, usage, json.dumps(request)),
            )

    def get(self, run_id: str) -> Row | None:
        with self._connect() as db:
            return self._row(db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone())

    def by_key(self, key: str) -> Row | None:
        with self._connect() as db:
            return self._row(db.execute("SELECT * FROM runs WHERE idem_key = ?", (key,)).fetchone())

    def update(self, run_id: str, **fields: Any) -> None:
        """Set some columns of a run. JSON columns take Python values; None clears one."""
        unknown = set(fields) - set(_COLUMNS)
        if unknown:
            raise ValueError(f"not a run column: {sorted(unknown)}")
        values = [
            json.dumps(v) if k in _JSON_COLUMNS and v is not None else v for k, v in fields.items()
        ]
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self._connect() as db:
            db.execute(f"UPDATE runs SET {sets} WHERE id = ?", (*values, run_id))  # noqa: S608 -- columns are checked above

    def set_state(self, run_id: str, state: str, only_from: tuple[str, ...]) -> bool:
        """Change the state if it is one of `only_from` (so two callers cannot both win)."""
        marks = ", ".join("?" for _ in only_from)
        with self._connect() as db:
            cur = db.execute(
                f"UPDATE runs SET state = ? WHERE id = ? AND state IN ({marks})",  # noqa: S608 -- marks only
                (state, run_id, *only_from),
            )
            return cur.rowcount == 1

    def active_count(self) -> int:
        marks = ", ".join("?" for _ in IN_PROGRESS)
        with self._connect() as db:
            row = db.execute(
                f"SELECT COUNT(*) FROM runs WHERE state IN ({marks})",  # noqa: S608 -- marks only
                IN_PROGRESS,
            ).fetchone()
            return int(row[0])

    def unfinished(self) -> list[Row]:
        """Runs a restart interrupted, oldest first."""
        marks = ", ".join("?" for _ in IN_PROGRESS)
        with self._connect() as db:
            rows = db.execute(
                f"SELECT * FROM runs WHERE state IN ({marks}) ORDER BY created_at",  # noqa: S608
                IN_PROGRESS,
            ).fetchall()
        return [r for r in (self._row(x) for x in rows) if r is not None]

    def delete(self, run_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM runs WHERE id = ?", (run_id,))
