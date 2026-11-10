"""Shared test fixtures."""

from pathlib import Path

import pytest

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
