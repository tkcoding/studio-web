"""T11: the one-Gear check (T11 note §2). A fake model: no network, no key."""

import json
import os
import socket
from pathlib import Path

import pytest

from gears_matcher.judge.llm import ModelOutput, ResponseCache
from gears_matcher.judge.llm.run import ENV_NAMES
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import CheckError, GearChecker, check_message
from gears_matcher.models import Requirement, SpecRef

R = Requirement(
    id="r1", title="Need", text="The system MUST do it.", kind="fr", must_level="MUST",
    priority=None, planned=False, source=SpecRef(path="PRD.md", line=1),
)  # fmt: skip
CARDS = [GearCard(gear_id="gears-rust/a", name="A", text="A does it")]


class FakeModel:
    def __init__(self, reply: str | None = None) -> None:
        self.calls = 0
        self.reply = reply

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        self.calls += 1
        if self.reply is not None:
            return ModelOutput(text=self.reply, input_tokens=5, output_tokens=1)
        checks = [
            {
                "gear_id": g,
                "contribution": "outcome",
                "reason": "x",
                "implementation": "implemented",
            }
            for g in ("gears-rust/a", "gears-rust/not-asked")
        ]
        text = json.dumps({"main_outcome": "it", "conditions": [], "checks": checks})
        return ModelOutput(text=text, input_tokens=100, output_tokens=10)


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*ENV_NAMES, "CI"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(os, "environ", os.environ.copy())

    def no_network(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", no_network)


def checker(tmp_path: Path, model: FakeModel, max_calls: int = 5) -> GearChecker:
    return GearChecker(model, ResponseCache(tmp_path / "c"), identity="x/m", max_calls=max_calls)


def test_the_message_shows_the_requirement_the_gears_and_the_context() -> None:
    text = check_message(R, CARDS, ["gears-rust/b"])
    assert text.startswith(
        "REQUIREMENT\nTitle: Need\nThe system MUST do it.\n\nCHECK\n[gears-rust/a]"
    )
    assert text.endswith("ALSO PICKED (context only): gears-rust/b")
    assert check_message(R, CARDS, []).endswith("ALSO PICKED (context only): none")


def test_only_the_gears_asked_about_are_kept_and_a_rerun_uses_the_cache(tmp_path: Path) -> None:
    model = FakeModel()
    assert checker(tmp_path, model).check(R, CARDS, []) == {"gears-rust/a": "outcome"}
    again = checker(tmp_path, model)
    assert again.is_cached(R, CARDS, [])
    assert again.check(R, CARDS, []) == {"gears-rust/a": "outcome"}
    assert (model.calls, again.run.cache_hits) == (1, 1)


def test_an_unusable_reply_is_repaired_once_then_an_error(tmp_path: Path) -> None:
    model = FakeModel(reply="not json")
    with pytest.raises(CheckError, match="unusable after one repair"):
        checker(tmp_path, model).check(R, CARDS, [])
    assert model.calls == 2


def test_the_call_bound_is_checked_before_each_request(tmp_path: Path) -> None:
    with pytest.raises(CheckError, match="call bound of 0"):
        checker(tmp_path, FakeModel(), max_calls=0).check(R, CARDS, [])


def test_it_never_runs_in_ci(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CI", "true")
    with pytest.raises(CheckError, match="never runs in CI"):
        checker(tmp_path, FakeModel())
