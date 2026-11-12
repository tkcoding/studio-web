"""Runs, their idempotency keys and their reports, in PostgreSQL (ADR-0071 §5).

A run row keeps what a caller can read (state, progress, usage, outcome, error), the report, and,
only while the run is not finished, the request itself, so a restart can run it again. Document
text is dropped the moment a run ends.

The database is the service's own (`gears_matcher` on the Studio PostgreSQL cluster in a
deployment). The runtime role cannot create databases, so `create_database` is run before the
service starts by a role that can (the chart's init container, the backend's bootstrap role); the
table is created here, at start, if it is missing. Connections come from a small pool, so worker
threads and request threads never share one.
"""

import re
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

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
    created_at  DOUBLE PRECISION NOT NULL,
    started_at  DOUBLE PRECISION,
    finished_at DOUBLE PRECISION,
    progress    JSONB,
    usage       JSONB NOT NULL,
    outcome     JSONB,
    error       JSONB,
    report      TEXT,
    request     JSONB
);
CREATE INDEX IF NOT EXISTS runs_in_progress ON runs (created_at)
    WHERE state IN ('queued', 'running', 'cancelling');
"""
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,62}$")
Row = dict[str, Any]


class RunStore:
    """`conninfo` is a libpq connection string or URL; empty takes the `PG*` environment."""

    def __init__(self, conninfo: str, *, pool_size: int = 4) -> None:
        self.pool: ConnectionPool[psycopg.Connection[Row]] = ConnectionPool(
            conninfo,
            min_size=1,
            max_size=max(pool_size, 1),
            kwargs={"autocommit": True, "row_factory": dict_row},
            timeout=30,
            open=False,
            name="gears-matcher-runs",
        )
        self.pool.open(wait=True, timeout=30)
        with self.pool.connection() as db:
            db.execute(_SCHEMA)

    def close(self) -> None:
        self.pool.close()

    def ping(self) -> None:
        """Raises if the database cannot be read."""
        with self.pool.connection() as db:
            db.execute("SELECT 1 FROM runs LIMIT 1").fetchall()

    def create(
        self, run_id: str, key: str, digest: str, request: dict[str, Any], now: float
    ) -> None:
        """A new queued run. Raises `psycopg.errors.UniqueViolation` if the key is already used."""
        usage = {"calls": 0, "cache_hits": 0, "input_tokens": 0, "output_tokens": 0}
        with self.pool.connection() as db:
            db.execute(
                "INSERT INTO runs (id, idem_key, body_digest, state, created_at, usage, request) "
                "VALUES (%s, %s, %s, 'queued', %s, %s, %s)",
                (run_id, key, digest, now, Jsonb(usage), Jsonb(request)),
            )

    def get(self, run_id: str) -> Row | None:
        with self.pool.connection() as db:
            return db.execute("SELECT * FROM runs WHERE id = %s", (run_id,)).fetchone()

    def by_key(self, key: str) -> Row | None:
        with self.pool.connection() as db:
            return db.execute("SELECT * FROM runs WHERE idem_key = %s", (key,)).fetchone()

    def update(self, run_id: str, **fields: Any) -> None:
        """Set some columns of a run. JSON columns take Python values; None clears one."""
        unknown = set(fields) - set(_COLUMNS)
        if unknown:
            raise ValueError(f"not a run column: {sorted(unknown)}")
        values = [
            Jsonb(v) if k in _JSON_COLUMNS and v is not None else v for k, v in fields.items()
        ]
        sets = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in fields)
        with self.pool.connection() as db:
            db.execute(sql.SQL("UPDATE runs SET {} WHERE id = %s").format(sets), (*values, run_id))

    def set_state(self, run_id: str, state: str, only_from: tuple[str, ...]) -> bool:
        """Change the state if it is one of `only_from` (so two callers cannot both win)."""
        with self.pool.connection() as db:
            cur = db.execute(
                "UPDATE runs SET state = %s WHERE id = %s AND state = ANY(%s)",
                (state, run_id, list(only_from)),
            )
            return cur.rowcount == 1

    def active_count(self) -> int:
        with self.pool.connection() as db:
            row = db.execute(
                "SELECT COUNT(*) AS n FROM runs WHERE state = ANY(%s)", (list(IN_PROGRESS),)
            ).fetchone()
            return int(row["n"]) if row else 0

    def unfinished(self) -> list[Row]:
        """Runs a restart interrupted, oldest first."""
        with self.pool.connection() as db:
            return db.execute(
                "SELECT * FROM runs WHERE state = ANY(%s) ORDER BY created_at",
                (list(IN_PROGRESS),),
            ).fetchall()

    def delete(self, run_id: str) -> None:
        with self.pool.connection() as db:
            db.execute("DELETE FROM runs WHERE id = %s", (run_id,))


def create_database(conninfo: str, name: str, owner: str | None = None) -> bool:
    """Create the database `name` (owned by `owner`) unless it exists; True if it was created.

    `conninfo` is a role that may create databases, connected to any existing database. Names are
    checked before they are used, and CREATE DATABASE cannot run in a transaction, hence autocommit.
    """
    for value, kind in ((name, "database name"), (owner, "owner")):
        if value is not None and not _IDENTIFIER.match(value):
            raise ValueError(f"unsafe {kind}: {value!r}")
    with psycopg.connect(conninfo, autocommit=True) as db:
        if db.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            return False
        statement = sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name))
        if owner:
            statement = sql.SQL("{} OWNER {}").format(statement, sql.Identifier(owner))
        db.execute(statement)
        return True
