"""Shared test fixtures."""

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import conninfo, sql

from gears_matcher.catalogue import build_catalogue
from gears_matcher.catalogue.aliases import GDL_TO_MD
from gears_matcher.catalogue.models import Catalogue
from gears_matcher.catalogue.sources import DirTree
from gears_matcher.models import Gear

FIXTURES = Path(__file__).parent / "fixtures"


class _FixtureMd(DirTree):
    """The excerpt lives at tests/fixtures/GEARS.md; the parser asks for docs/GEARS.md."""

    def __init__(self) -> None:
        super().__init__(FIXTURES, "md-sha")

    def read(self, path: str) -> str:
        return (FIXTURES / "GEARS.md").read_text()


@pytest.fixture(scope="session")
def fixture_catalogue() -> Catalogue:
    """T1's catalogue built from the committed fixture excerpts (no gears-rust needed)."""
    aliases = {k: v for k, v in GDL_TO_MD.items() if k in {"event-broker", "authn-resolver"}}
    return build_catalogue(_FixtureMd(), DirTree(FIXTURES / "gdl", "gdl-sha"), aliases=aliases)


@pytest.fixture(scope="session")
def fixture_gears(fixture_catalogue: Catalogue) -> tuple[Gear, ...]:
    """The fixture catalogue's gears."""
    return fixture_catalogue.gears


# The run store's tests need a PostgreSQL server (no SQLite stand-in: the store has one dialect).
# GEARS_MATCHER_TEST_PG is a URL for a role that may create databases; each test gets a database of
# its own, dropped after it. Without one the tests skip locally and fail in CI, so they cannot go
# unrun by accident.
TEST_PG = "GEARS_MATCHER_TEST_PG"


@pytest.fixture
def pg_url() -> Iterator[str]:
    """A fresh, empty database for one test, as a connection URL."""
    server = os.environ.get(TEST_PG, "").strip()
    if not server:
        if os.environ.get("CI"):
            pytest.fail(f"{TEST_PG} is not set: the run store's tests need PostgreSQL")
        pytest.skip(f"{TEST_PG} is not set (a PostgreSQL URL for a CREATEDB role)")
    name = f"gm_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(server, autocommit=True) as db:
        db.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield conninfo.make_conninfo(server, dbname=name)
    finally:
        with psycopg.connect(server, autocommit=True) as db:
            db.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
