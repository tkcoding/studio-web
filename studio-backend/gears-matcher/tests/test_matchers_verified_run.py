"""T11: a whole `verified` run and its report (T11 note §2, D3-D8). A routing fake model."""

import json
import os
import re
import socket
from collections.abc import Callable
from pathlib import Path

import pytest

from gears_matcher.judge.llm import ModelOutput, ResponseCache
from gears_matcher.judge.llm.errors import ProviderError
from gears_matcher.judge.llm.run import ENV_NAMES
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers import checks, main_job, report_check, whole_catalogue
from gears_matcher.matchers import verified_run as vr
from gears_matcher.matchers.checks import GearChecker
from gears_matcher.matchers.main_job import MainJobChecker
from gears_matcher.matchers.report_check import REPORT_PROMPT_HASH, GearReport, ReportChecker
from gears_matcher.matchers.verified_run import (
    BudgetSpentError,
    CallBudget,
    Counted,
    Models,
    check_card,
    pick_card,
    run_verified,
)
from gears_matcher.matchers.whole_catalogue import CatalogueModel
from gears_matcher.models import Gear, Requirement, SourceRef, SpecRef

G = "gears-rust/"
CARDS = [
    GearCard(gear_id=G + n, name=n, text=f"{n} does the requested thing for products")
    for n in ("alpha", "beta", "paper", "gamma")
]
SEEN: list[tuple[str, str]] = []  # (system, user) of every call, for the card tests
REQ = re.compile(r"<requirement>\nid: (\S+)")
CHECKED = re.compile(r"\[(gears-rust/[^\]]+)\]")


def req(rid: str) -> Requirement:
    return Requirement(
        id=rid, title=f"Need {rid}", text="The system MUST do it.", kind="fr", must_level="MUST",
        priority=None, planned=False, source=SpecRef(path="PRD.md", line=1),
    )  # fmt: skip


# what each "model" says, per requirement id
PICKS = {
    "both": ["alpha"],  # both models pick alpha; checks pass -> build list
    "one": ["beta"],  # only the first model picks beta -> to confirm
    "paper": ["paper"],  # a Gear with no code -> future part
    "unclear": ["alpha"],
    "nothing": ["gamma"],  # report check says none -> gap
}
SECOND = {
    "both": ["alpha"],
    "one": [],
    "paper": ["paper"],
    "unclear": ["alpha"],
    "nothing": ["gamma"],
}


class Router:
    def __init__(self, role: str, *, unclear: bool = True, main: str = "core") -> None:
        self.role, self.unclear, self.calls, self.main = role, unclear, 0, main

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        self.calls += 1
        SEEN.append((system, user))
        if system == whole_catalogue.SYSTEM:
            table = PICKS if self.role == "first" else SECOND
            answers = [
                {
                    "requirement_id": r,
                    "gears": [{"gear_id": G + g, "verdict": "covered"} for g in table[r]],
                }
                for r in REQ.findall(user)
            ]
            return ModelOutput(
                text=json.dumps({"answers": answers}), input_tokens=1, output_tokens=1
            )
        if system == main_job.SYSTEM:
            text = json.dumps({"distinctive": "d", "verdict": self.main, "reason": "only stores"})
            return ModelOutput(text=text, input_tokens=1, output_tokens=1)
        gears = CHECKED.findall(user)
        if system == checks.SYSTEM:
            items = [
                {
                    "gear_id": g,
                    "contribution": "outcome",
                    "reason": "r",
                    "implementation": "implemented",
                }
                for g in gears
            ]
            text = json.dumps({"main_outcome": "m", "conditions": [], "checks": items})
            return ModelOutput(text=text, input_tokens=1, output_tokens=1)
        assert system == report_check.SYSTEM
        unclear = self.unclear and "Need unclear" in user
        items = []
        for g in gears:
            name = g.removeprefix(G)
            verdict = "none" if name == "gamma" else "partial"
            quote = "" if verdict == "none" else f"{name} does the requested thing"
            items.append({"gear_id": g, "verdict": verdict, "none_kind": "", "gives": "it",
                          "left": "the rest", "quote": quote, "reason": "why"})  # fmt: skip
        text = json.dumps({"clarity": "unclear" if unclear else "clear", "clarity_reason": "vague",
                           "main_outcome": "m", "conditions": [], "gears": items})  # fmt: skip
        return ModelOutput(text=text, input_tokens=1, output_tokens=1)


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*ENV_NAMES, "CI"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(os, "environ", os.environ.copy())

    def no_network(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", no_network)


def models(tmp_path: Path, limit: int = 100, main: str = "core") -> tuple[Models, CallBudget]:
    budget = CallBudget(limit)
    cache = ResponseCache(tmp_path / "c")
    first, second, checker = (
        Counted(Router(r, main=main), budget) for r in ("first", "second", "checks")
    )
    return (
        Models(
            first=CatalogueModel(first, cache, identity="s", max_calls=limit),
            second=CatalogueModel(second, cache, identity="o", max_calls=limit),
            targeted=GearChecker(first, cache, identity="s", max_calls=limit),
            strict=GearChecker(checker, cache, identity="g", max_calls=limit),
            report=ReportChecker(checker, cache, identity="g", max_calls=limit),
            main_job=MainJobChecker(second, cache, identity="o", max_calls=limit),
        ),
        budget,
    )


IN_CODE: Callable[[str], bool] = lambda g: g != G + "paper"  # noqa: E731


def test_the_report_check_prompt_is_the_measured_one() -> None:
    assert REPORT_PROMPT_HASH == "8563f06bf0934a8d"


def test_each_case_lands_where_the_design_says(tmp_path: Path) -> None:
    reqs = [req(r) for r in PICKS]
    m, _ = models(tmp_path)
    res = run_verified(reqs, CARDS, m, own=frozenset(), in_code=IN_CODE)
    by = {(x.requirement_id, x.gear_id): x for x in res.matches}
    assert by[("both", G + "alpha")].verdict == "partial"  # build list, with evidence
    assert by[("both", G + "alpha")].missing == "the rest"
    assert by[("one", G + "beta")].verdict == "unjudgeable"  # to confirm
    assert "picked by one model only" in by[("one", G + "beta")].rationale
    assert by[("paper", G + "paper")].rationale.startswith("future part")
    assert res.future == {"paper": f"future part: only Gears with no code yet fit ({G}paper)"}
    assert by[("unclear", G + "alpha")].verdict == "unjudgeable"
    assert by[("nothing", G + "gamma")].verdict == "none"
    assert by[("nothing", G + "gamma")].rationale == "report check: none: why"
    assert res.failed == {}


def test_a_none_says_why_the_report_check_gave_it() -> None:  # #90 review
    card = CARDS[0]
    said = GearReport(gear_id=card.gear_id, verdict="partial", none_kind="", gives="g", left="l",
                      quote="words that are nowhere on the card", reason="r")  # fmt: skip
    assert vr._why_none(None, card) == "report check: none (the Gear was left out of its reply)"
    assert vr._why_none(said, card) == (
        "report check: none (its partial quote is not in the Gear's card)"
    )


def test_check_card_adds_the_gears_stated_limits() -> None:  # T11 D16
    src = (SourceRef(kind="gears-md", path="docs/GEARS.md", line=1),)
    plain = Gear(
        id=G + "s", name="S", category=None, responsibility="Stores settings.", sources=src
    )
    assert check_card(plain).text == "S\nStores settings."
    limited = plain.model_copy(update={"limits": "- Per-user preferences."})
    assert check_card(limited).text == (
        "S\nStores settings.\nDoes NOT do (stated in this Gear's own PRD):\n- Per-user preferences."
    )
    both = limited.model_copy(update={"does": "- Cascading settings."})  # T11 D17
    assert check_card(both).text == (
        "S\nStores settings.\nDoes (stated in this Gear's own PRD):\n- Cascading settings.\n"
        "Does NOT do (stated in this Gear's own PRD):\n- Per-user preferences."
    )


def test_pick_card_adds_the_stated_does_to_every_card() -> None:  # T11 D18, D21
    src = (SourceRef(kind="gears-md", path="docs/GEARS.md", line=1),)
    thin = Gear(id=G + "m", name="M", category=None, responsibility="AI chat.", sources=src)
    assert pick_card(thin).text == "M\nAI chat."
    stated = thin.model_copy(update={"does": "- Web search.", "limits": "- No URL fetch."})
    assert pick_card(stated).text == (
        "M\nAI chat.\nDoes (stated in this Gear's own PRD):\n- Web search."
    )  # never the limits
    rich = stated.model_copy(update={"capabilities": ("create chats",)})
    assert pick_card(rich).text == (
        "M\nAI chat.\ncreate chats\nDoes (stated in this Gear's own PRD):\n- Web search."
    )  # a longer card too (D21; D18 added it to thin cards only)
    plain = rich.model_copy(update={"does": None})
    assert pick_card(plain).text == "M\nAI chat.\ncreate chats"


def test_the_checks_see_the_check_cards_and_the_picks_the_plain_cards(tmp_path: Path) -> None:
    SEEN.clear()
    limited = [c.model_copy(update={"text": c.text + "\nDoes NOT do: LIMITS"}) for c in CARDS]
    m, _ = models(tmp_path)
    run_verified([req("both")], CARDS, m, own=frozenset(), in_code=IN_CODE, check_cards=limited)
    picks = [u for s, u in SEEN if s == whole_catalogue.SYSTEM]
    checked = [u for s, u in SEEN if s in {checks.SYSTEM, report_check.SYSTEM}]
    assert picks
    assert checked
    assert not any("LIMITS" in u for u in picks)
    assert all("LIMITS" in u for u in checked)


def test_a_spent_budget_leaves_requirements_not_assessed(tmp_path: Path) -> None:
    m, budget = models(tmp_path, limit=2)  # the two whole-catalogue calls only
    res = run_verified([req("both")], CARDS, m, own=frozenset(), in_code=IN_CODE)
    assert budget.used == 2
    assert "could not be answered" in res.failed["both"]


def test_the_budget_error_is_both_kinds_of_error() -> None:
    assert issubclass(BudgetSpentError, whole_catalogue.CatalogueModelError)
    assert issubclass(BudgetSpentError, checks.CheckError)


def test_the_pick_models_never_see_the_products_own_gear(tmp_path: Path) -> None:
    SEEN.clear()
    m, _ = models(tmp_path)
    run_verified([req("both")], CARDS, m, own=frozenset({G + "alpha"}), in_code=IN_CODE)
    picks = [u for s, u in SEEN if s == whole_catalogue.SYSTEM]
    assert picks
    assert not any(f"{G}alpha" in u for u in picks)
    assert all(f"{G}beta" in u for u in picks)


class TimesOut:
    """A model whose calls for one role time out, as the gateway did on 2026-11-03."""

    def __init__(self, inner: Router, system: str) -> None:
        self.inner, self.system = inner, system

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        if system == self.system and "Need both" in user:
            raise ProviderError("Request timed out., after 3 attempts")
        return self.inner.complete(system=system, user=user, schema=schema, timeout_s=timeout_s)


@pytest.mark.parametrize(
    "system",
    [whole_catalogue.SYSTEM, checks.SYSTEM, report_check.SYSTEM, main_job.SYSTEM],
    ids=["picks", "checks", "report-check", "main-job"],
)
def test_a_provider_timeout_leaves_the_requirement_not_assessed(
    tmp_path: Path, system: str
) -> None:
    cache = ResponseCache(tmp_path / "c")
    first, second, checker = (TimesOut(Router(r), system) for r in ("first", "second", "checks"))
    m = Models(
        first=CatalogueModel(first, cache, identity="s", max_calls=100),
        second=CatalogueModel(second, cache, identity="o", max_calls=100),
        targeted=GearChecker(first, cache, identity="s", max_calls=100),
        strict=GearChecker(checker, cache, identity="g", max_calls=100),
        report=ReportChecker(checker, cache, identity="g", max_calls=100),
        main_job=MainJobChecker(second, cache, identity="o", max_calls=100),
    )
    reqs = [req("both")] if system == whole_catalogue.SYSTEM else [req("both"), req("one")]
    res = run_verified(reqs, CARDS, m, own=frozenset(), in_code=IN_CODE)
    assert "Request timed out" in res.failed["both"]
    assert all(x.requirement_id != "both" for x in res.matches)
    if system != whole_catalogue.SYSTEM:  # the run goes on with the next requirement
        assert "one" not in res.failed
        assert any(x.requirement_id == "one" for x in res.matches)


class StoresOnly(Router):
    """Both models pick settings-service; the broad-Gear check says it only stores the input."""

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        if system == whole_catalogue.SYSTEM:
            gears = [{"gear_id": SETTINGS.gear_id, "verdict": "covered"}]
            answers = [{"requirement_id": r, "gears": gears} for r in REQ.findall(user)]
            return ModelOutput(
                text=json.dumps({"answers": answers}), input_tokens=1, output_tokens=1
            )
        if system == checks.SYSTEM:
            items = [{"gear_id": g, "contribution": "input_only", "reason": "r",
                      "implementation": "implemented"} for g in CHECKED.findall(user)]  # fmt: skip
            text = json.dumps({"main_outcome": "m", "conditions": [], "checks": items})
            return ModelOutput(text=text, input_tokens=1, output_tokens=1)
        return super().complete(system=system, user=user, schema=schema, timeout_s=timeout_s)


SETTINGS = GearCard(
    gear_id=G + "settings-service", name="settings-service",
    text="settings-service does the requested thing for products",
)  # fmt: skip


def test_a_gear_a_check_removed_is_still_shown_to_confirm(tmp_path: Path) -> None:  # #93 review
    cache = ResponseCache(tmp_path / "c")
    first, second, checker = (StoresOnly(r) for r in ("first", "second", "checks"))
    m = Models(
        first=CatalogueModel(first, cache, identity="s", max_calls=100),
        second=CatalogueModel(second, cache, identity="o", max_calls=100),
        targeted=GearChecker(first, cache, identity="s", max_calls=100),
        strict=GearChecker(checker, cache, identity="g", max_calls=100),
        report=ReportChecker(checker, cache, identity="g", max_calls=100),
        main_job=MainJobChecker(second, cache, identity="o", max_calls=100),
    )
    res = run_verified([req("both")], [SETTINGS], m, own=frozenset(), in_code=IN_CODE)
    (x,) = res.matches
    assert x.verdict == "unjudgeable"  # a Gear to confirm: "also possible", not the build list
    assert x.rationale.startswith("not confirmed (broad-Gear check: input_only)")


def test_a_supporting_gear_leaves_the_build_list_and_is_shown_to_confirm(
    tmp_path: Path,
) -> None:  # T11 D22
    SEEN.clear()
    m, _ = models(tmp_path, main="supporting")
    reqs = [req(r) for r in PICKS]
    res = run_verified(reqs, CARDS, m, own=frozenset(), in_code=IN_CODE)
    by = {(x.requirement_id, x.gear_id): x for x in res.matches}
    x = by[("both", G + "alpha")]
    assert (x.verdict, x.confidence) == ("unjudgeable", vr.CONFIRM_CONFIDENCE)  # "also possible"
    assert x.rationale.startswith(
        "not confirmed (main-job check: supporting step: only stores (main job: d))"
    )
    assert res.decisions["both"].build == []
    asked = [u for s, u in SEEN if s == main_job.SYSTEM]
    assert len(asked) == 1  # only the partial build-list Gear; never "one", "unclear" or "paper"
    assert "Need both" in asked[0]
    assert "PART IT PERFORMS (earlier check): it\nWORK LEFT (earlier check): the rest" in asked[0]


def test_a_core_gear_stays_on_the_build_list(tmp_path: Path) -> None:  # T11 D22
    m, _ = models(tmp_path, main="core")
    res = run_verified([req("both")], CARDS, m, own=frozenset(), in_code=IN_CODE)
    (x,) = res.matches
    assert (x.verdict, x.confidence) == ("partial", vr.BUILD_CONFIDENCE)
    assert res.decisions["both"].build == [G + "alpha"]
