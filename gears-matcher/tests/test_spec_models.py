"""T8 note §3: the two new fields are left out of a dump while they hold their default, so the JSON
of a CF spec is what it was before T8 (and `origin` / `end_line` appear when T8 sets them)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from gears_matcher.models import Requirement, SpecRef
from gears_matcher.spec import Spec, load_spec

FIXTURES = Path(__file__).parent / "fixtures" / "spec"
STUDIO = FIXTURES / "bundle-studio"
TODO = FIXTURES / "todo-app" / "PRD.md"


def _requirement(**changes: object) -> Requirement:
    base: dict[str, object] = {
        "id": "t8-0123456789",
        "title": "Login",
        "text": "Users can sign in.",
        "kind": "fr",
        "must_level": None,
        "priority": None,
        "planned": False,
        "source": SpecRef(path="idea.md", line=3, heading=None),
    }
    return Requirement.model_validate(base | changes)


def test_a_cf_requirement_dumps_without_origin_and_end_line() -> None:
    data = json.loads(_requirement().model_dump_json())
    assert "origin" not in data
    assert "end_line" not in data["source"]
    assert "origin" not in _requirement().model_dump()


def test_an_extracted_requirement_dumps_both() -> None:
    req = _requirement(
        origin="extracted", source=SpecRef(path="idea.md", line=3, heading="H", end_line=5)
    )
    data = json.loads(req.model_dump_json())
    assert data["origin"] == "extracted"
    assert data["source"]["end_line"] == 5


@pytest.mark.parametrize("origin", ["template", "extracted"])
@pytest.mark.parametrize("end_line", [None, 3, 9])
def test_a_dump_reads_back_equal(origin: str, end_line: int | None) -> None:
    req = _requirement(origin=origin, source=SpecRef(path="a.md", line=3, end_line=end_line))
    assert Requirement.model_validate_json(req.model_dump_json()) == req


def test_a_passage_cannot_end_before_it_starts() -> None:
    assert SpecRef(path="a.md", line=4, end_line=4).end_line == 4
    with pytest.raises(ValidationError, match="end_line 3 is before line 4"):
        SpecRef(path="a.md", line=4, end_line=3)


def test_a_spec_holding_an_extracted_requirement_keeps_its_fields_when_nested() -> None:
    spec = load_spec(TODO)
    extracted = _requirement(origin="extracted", source=SpecRef(path="x.md", line=1, end_line=2))
    mixed = spec.model_copy(update={"requirements": (*spec.requirements, extracted)})
    last = json.loads(mixed.model_dump_json())["requirements"][-1]
    assert (last["origin"], last["source"]["end_line"]) == ("extracted", 2)
    assert Spec.model_validate_json(mixed.model_dump_json()) == mixed
