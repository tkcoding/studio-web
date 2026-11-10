"""T11: the report check (T11 note §2, step 5). A fake model: no network, no key."""

import json
import os
import socket
from pathlib import Path

import pytest

from gears_matcher.judge.llm import ModelOutput, ResponseCache
from gears_matcher.judge.llm.run import ENV_NAMES
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import CheckError
from gears_matcher.matchers.report_check import ReportChecker, report_message
from gears_matcher.models import Requirement, SpecRef

R = Requirement(
    id="r1", title="Need", text="The system MUST do it.", kind="fr", must_level="MUST",
    priority=None, planned=False, source=SpecRef(path="PRD.md", line=1),
)  # fmt: skip
CARDS = [GearCard(gear_id="gears-rust/a", name="A", text="A does the thing")]
GOOD = json.dumps({
    "clarity": "clear", "clarity_reason": "", "main_outcome": "m", "conditions": [],
    "gears": [
        {"gear_id": g, "verdict": "covered", "none_kind": "", "gives": "x", "left": "",
         "quote": "q", "reason": "r"} for g in ("gears-rust/a", "gears-rust/not-asked")
    ],
})  # fmt: skip


class FakeModel:
    def __init__(self, reply: str) -> None:
        self.reply, self.calls = reply, 0

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        self.calls += 1
        return ModelOutput(text=self.reply, input_tokens=1, output_tokens=1)


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*ENV_NAMES, "CI"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(os, "environ", os.environ.copy())

    def no_network(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", no_network)


def checker(tmp_path: Path, model: FakeModel, max_calls: int = 5) -> ReportChecker:
    return ReportChecker(model, ResponseCache(tmp_path / "c"), identity="g", max_calls=max_calls)


def test_the_message_lists_every_candidate() -> None:
    assert report_message(R, CARDS).endswith(
        "[gears-rust/a]\nA does the thing\n\nALSO PICKED (context only): none"
    )


def test_only_asked_gears_are_kept_and_a_rerun_uses_the_cache(tmp_path: Path) -> None:
    model = FakeModel(GOOD)
    reply = checker(tmp_path, model).check(R, CARDS)
    assert [g.gear_id for g in reply.gears] == ["gears-rust/a"]
    again = checker(tmp_path, model)
    assert again.is_cached(R, CARDS)
    again.check(R, CARDS)
    assert model.calls == 1


def test_an_unusable_reply_is_repaired_once_then_an_error(tmp_path: Path) -> None:
    model = FakeModel("not json")
    with pytest.raises(CheckError, match="unusable after one repair"):
        checker(tmp_path, model).check(R, CARDS)
    assert model.calls == 2


def test_the_call_bound_and_ci(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(CheckError, match="call bound of 0"):
        checker(tmp_path, FakeModel(GOOD), max_calls=0).check(R, CARDS)
    monkeypatch.setenv("CI", "true")
    with pytest.raises(CheckError, match="never runs in CI"):
        checker(tmp_path, FakeModel(GOOD))
