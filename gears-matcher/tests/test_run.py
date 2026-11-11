"""The library entry point (T9): a spec in, a coverage report out, on a fake model. No network.

The order under test: read the format (T2), read free-form documents with a model (T8) only if
needed, and only then run the matching models (`verified`, T11).
"""

import json
import re
import socket
from pathlib import Path

import pytest

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.extract.prompt import SYSTEM_PROMPT as EXTRACT_SYSTEM
from gears_matcher.judge.llm import ModelClient, ModelOutput
from gears_matcher.matchers import checks, main_job, whole_catalogue
from gears_matcher.run import (
    Hooks,
    InputProblem,
    RunCancelled,
    RunInputs,
    Usage,
    check_spec,
    run_matching,
)

PRD = Path(__file__).parent / "fixtures/spec/todo-app/PRD.md"
REQ = re.compile(r"<requirement>\nid: (\S+)")
BLOCK = re.compile(r"\[(gears-rust/[^\]]+)\]\n(.*?)(?=\n\n\[|\n\nALSO PICKED)", re.S)
NOTES = """# Notes app

Some background about why we build this.

## Requirements

- Users can sign in with their company account.
- Users must not share accounts between people.
"""


class FakeModel:
    """Matching: every requirement gets the first catalogue Gear with a gear.gdl, from both models;
    every check passes; the report check says partial and quotes a line of the card. Extraction:
    the two lines of NOTES. `systems` records which kind of call came when."""

    def __init__(self, gear: str) -> None:
        self.gear = gear
        self.systems: list[str] = []

    @property
    def calls(self) -> int:
        return len(self.systems)

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        self.systems.append(system)
        if system == EXTRACT_SYSTEM:
            quotes = [
                "Users can sign in with their company account.",
                "Users must not share accounts between people.",
            ]
            return self._out({"items": [{"quote": q, "kind": "fr"} for q in quotes]})
        if system == whole_catalogue.SYSTEM:
            picks = [{"gear_id": self.gear, "verdict": "covered"}]
            return self._out(
                {"answers": [{"requirement_id": r, "gears": picks} for r in REQ.findall(user)]}
            )
        if system == main_job.SYSTEM:
            return self._out({"distinctive": "d", "verdict": "core", "reason": "r"})
        blocks = BLOCK.findall(user)
        if system == checks.SYSTEM:
            items = [
                {
                    "gear_id": g,
                    "contribution": "outcome",
                    "reason": "r",
                    "implementation": "implemented",
                }
                for g, _ in blocks
            ]
            return self._out({"main_outcome": "m", "conditions": [], "checks": items})
        items = []
        for g, card in blocks:
            quote = next(line for line in card.split("\n") if len(line.split()) >= 3)
            items.append({"gear_id": g, "verdict": "partial", "none_kind": "", "gives": "it",
                          "left": "the rest", "quote": quote, "reason": "why"})  # fmt: skip
        return self._out({"clarity": "clear", "clarity_reason": "", "main_outcome": "m",
                          "conditions": [], "gears": items})  # fmt: skip

    @staticmethod
    def _out(reply: object) -> ModelOutput:
        return ModelOutput(text=json.dumps(reply), input_tokens=1, output_tokens=1)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", refuse)


def coded(catalogue: Catalogue) -> str:
    return next(
        g.id
        for g in sorted(catalogue.gears, key=lambda g: g.id)
        if any(s.kind == "gear-gdl" for s in g.sources)
    )


def inputs(
    tmp_path: Path, catalogue: Catalogue, model: ModelClient, spec: Path = PRD, **more: object
) -> RunInputs:
    return RunInputs(
        spec_path=spec,
        catalogue=catalogue,
        model_factory=lambda name: (f"fake:{name}", model),
        cache_dir=tmp_path / "cache",
        **more,  # type: ignore[arg-type]
    )


def notes_file(tmp_path: Path, text: str = NOTES) -> Path:
    """One free-form document, named on purpose: T2 hands it over (a folder needs a manifest)."""
    path = tmp_path / "notes.md"
    path.write_text(text)
    return path


def test_a_cf_spec_goes_straight_to_the_matching_models(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    gear = coded(fixture_catalogue)
    model = FakeModel(gear)
    progress: list[tuple[int, int]] = []
    usages: list[Usage] = []
    result = run_matching(
        inputs(tmp_path, fixture_catalogue, model, max_calls=100),
        Hooks(
            on_progress=lambda done, total: progress.append((done, total)), on_usage=usages.append
        ),
    )
    assert {r.coverage for r in result.report.requirements} == {"partial"}
    assert [u.gear_id for u in result.report.recommended_gears] == [gear]
    assert result.requirements == 8
    assert result.not_assessed == 0
    assert result.extraction is None
    assert EXTRACT_SYSTEM not in model.systems, (
        "no model reads a spec that is already in the format"
    )
    assert result.report.provenance.judge.startswith(
        "verified: candidates claude-sonnet-4-6 + claude-opus-5"
    )
    assert progress[-1] == (8, 8)
    assert usages[-1].calls == result.usage.calls == model.calls
    assert result.usage.input_tokens == model.calls


def test_a_rerun_is_answered_from_the_cache(fixture_catalogue: Catalogue, tmp_path: Path) -> None:
    gear = coded(fixture_catalogue)
    first = run_matching(inputs(tmp_path, fixture_catalogue, FakeModel(gear), max_calls=100))
    model = FakeModel(gear)
    again = run_matching(inputs(tmp_path, fixture_catalogue, model, max_calls=100))
    assert first.usage.calls > 0
    assert (again.usage.calls, model.calls) == (0, 0)
    assert again.usage.cache_hits > 0
    assert again.report == first.report


def test_the_products_own_gear_is_never_a_candidate(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    gear = coded(fixture_catalogue)
    result = run_matching(
        inputs(
            tmp_path, fixture_catalogue, FakeModel(gear), max_calls=100, own_gears=frozenset({gear})
        )
    )
    assert gear not in [u.gear_id for u in result.report.recommended_gears]


def test_the_call_budget_leaves_requirements_not_assessed(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    result = run_matching(
        inputs(tmp_path, fixture_catalogue, FakeModel(coded(fixture_catalogue)), max_calls=3)
    )
    assert result.usage.calls == 3
    assert result.not_assessed > 0


def test_cancel_stops_before_the_next_call(fixture_catalogue: Catalogue, tmp_path: Path) -> None:
    model = FakeModel(coded(fixture_catalogue))
    seen: list[Usage] = []
    hooks = Hooks(cancelled=lambda: bool(seen) and seen[-1].calls >= 1, on_usage=seen.append)
    with pytest.raises(RunCancelled):
        run_matching(inputs(tmp_path, fixture_catalogue, model, max_calls=100), hooks)
    assert model.calls == 1, "one call was in flight; none was sent after the cancel"


def test_an_unknown_own_gear_is_refused_before_anything_is_paid(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    model = FakeModel(coded(fixture_catalogue))
    with pytest.raises(InputProblem) as caught:
        run_matching(
            inputs(tmp_path, fixture_catalogue, model, own_gears=frozenset({"gears-rust/nope"}))
        )
    assert caught.value.code == "unknown_own_gear"
    assert model.calls == 0


def test_a_spec_that_is_not_in_the_format_is_refused_unless_reading_is_allowed(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    model = FakeModel(coded(fixture_catalogue))
    with pytest.raises(InputProblem) as caught:
        run_matching(inputs(tmp_path, fixture_catalogue, model, spec=notes_file(tmp_path)))
    assert caught.value.code == "not_a_template"
    assert model.calls == 0


def test_nothing_to_read_is_unreadable(fixture_catalogue: Catalogue, tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(InputProblem) as caught:
        check_spec(empty, extract=True)
    assert caught.value.code == "unreadable_spec"


def test_a_free_form_spec_is_read_first_and_matched_only_after(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    gear = coded(fixture_catalogue)
    model = FakeModel(gear)
    result = run_matching(
        inputs(
            tmp_path,
            fixture_catalogue,
            model,
            spec=notes_file(tmp_path),
            max_calls=100,
            extract_max_calls=5,
        )
    )
    assert model.systems[0] == EXTRACT_SYSTEM, "the extraction call comes first"
    assert EXTRACT_SYSTEM not in model.systems[1:], "and only once: matching never reads documents"
    assert result.extraction is not None
    assert result.requirements == 2
    assert (result.report.provenance.extraction or "").startswith("llm: fake:claude-sonnet-4-6")
    assert result.usage.calls == model.calls, "extraction calls are counted with the rest"


def test_the_extraction_bound_applies_only_to_reading(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    """A spec already in the format never spends the extraction bound."""
    model = FakeModel(coded(fixture_catalogue))
    run_matching(inputs(tmp_path, fixture_catalogue, model, max_calls=100, extract_max_calls=1))
    assert EXTRACT_SYSTEM not in model.systems
