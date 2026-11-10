"""T11 D22: the main-job check. A fake model: no network, no key."""

import json
import os
import socket
from pathlib import Path

import pytest

from gears_matcher.judge.llm import CacheError, ModelOutput, ResponseCache
from gears_matcher.judge.llm.errors import ProviderError
from gears_matcher.judge.llm.run import ENV_NAMES
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import CheckError
from gears_matcher.matchers.main_job import (
    MAIN_JOB_PROMPT_HASH,
    MainJobChecker,
    main_job_message,
)
from gears_matcher.models import Requirement, SpecRef

R = Requirement(
    id="r1", title="Need", text="The system MUST do it.", kind="fr", must_level="MUST",
    priority=None, planned=False, source=SpecRef(path="PRD.md", line=1),
)  # fmt: skip
CARD = GearCard(gear_id="gears-rust/a", name="A", text="A stores records")
GOOD = json.dumps({"distinctive": "d", "verdict": "supporting", "reason": "only stores"})


class FakeModel:
    def __init__(self, *replies: str) -> None:
        self.calls, self.replies = 0, list(replies) or [GOOD]

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        self.calls += 1
        text = self.replies[min(self.calls, len(self.replies)) - 1]
        return ModelOutput(text=text, input_tokens=10, output_tokens=2)


class Fails:
    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        raise ProviderError("Request timed out.")


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*ENV_NAMES, "CI"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(os, "environ", os.environ.copy())

    def no_network(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", no_network)


def checker(tmp_path: Path, model: FakeModel | Fails, max_calls: int = 5) -> MainJobChecker:
    return MainJobChecker(model, ResponseCache(tmp_path / "c"), identity="x/m", max_calls=max_calls)


def test_the_prompt_is_the_measured_one() -> None:
    assert MAIN_JOB_PROMPT_HASH == "76a19c329fd52ac0"


def test_the_message_shows_the_requirement_the_gear_and_the_report_checks_split() -> None:
    assert main_job_message(R, CARD, "stores it", "the rest") == (
        "REQUIREMENT\nTitle: Need\nThe system MUST do it.\n\nGEAR [gears-rust/a]\n"
        "A stores records\n\nPART IT PERFORMS (earlier check): stores it\n"
        "WORK LEFT (earlier check): the rest"
    )


def test_the_reply_is_kept_and_a_rerun_uses_the_cache(tmp_path: Path) -> None:
    model = FakeModel()
    said = checker(tmp_path, model).check(R, CARD, "g", "l")
    assert (said.verdict, said.reason) == ("supporting", "only stores")
    again = checker(tmp_path, model)
    assert again.check(R, CARD, "g", "l").verdict == "supporting"
    assert (model.calls, again.run.cache_hits) == (1, 1)


def test_an_unusable_reply_is_repaired_once(tmp_path: Path) -> None:
    model = FakeModel("not json", GOOD)
    assert checker(tmp_path, model).check(R, CARD, "g", "l").verdict == "supporting"
    bad = FakeModel("not json")
    with pytest.raises(CheckError, match="unusable after one repair"):
        checker(tmp_path, bad).check(R, CARD, "g", "other")
    assert (model.calls, bad.calls) == (2, 2)


def test_a_bad_cache_entry_is_an_error(tmp_path: Path) -> None:
    run = checker(tmp_path, FakeModel())
    run.check(R, CARD, "g", "l")
    (entry,) = (tmp_path / "c").glob("*/*.json")
    data = json.loads(entry.read_text())
    entry.write_text(json.dumps({**data, "reply_text": "not json"}))
    with pytest.raises(CheckError, match="is not a valid check"):
        checker(tmp_path, FakeModel()).check(R, CARD, "g", "l")


def test_a_failed_cache_write_is_recorded_not_raised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_write(*_args: object, **_kwargs: object) -> None:
        raise CacheError("disk full")

    run = checker(tmp_path, FakeModel())
    monkeypatch.setattr(ResponseCache, "put", no_write)
    assert run.check(R, CARD, "g", "l").verdict == "supporting"
    assert run.run.cache_write_errors == ["disk full"]


def test_a_failed_call_is_a_check_error(tmp_path: Path) -> None:
    with pytest.raises(CheckError, match="the model call failed"):
        checker(tmp_path, Fails()).check(R, CARD, "g", "l")


def test_the_call_bound_is_checked_before_each_request(tmp_path: Path) -> None:
    with pytest.raises(CheckError, match="call bound of 0"):
        checker(tmp_path, FakeModel(), max_calls=0).check(R, CARD, "g", "l")
    with pytest.raises(ValueError, match="must not be negative"):
        checker(tmp_path, FakeModel(), max_calls=-1)


def test_it_never_runs_in_ci(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CI", "true")
    with pytest.raises(CheckError, match="never runs in CI"):
        checker(tmp_path, FakeModel())
