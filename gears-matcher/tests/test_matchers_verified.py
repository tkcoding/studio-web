"""T11: the `verified` decision for one requirement (T11 note §2). Scripted checks, no model."""

from collections.abc import Mapping, Sequence

import pytest

from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import CHECK_PROMPT_HASH, CheckError, Contribution
from gears_matcher.matchers.verified import Decision, decide
from gears_matcher.models import Requirement, SpecRef

R = Requirement(
    id="r1", title="Need", text="The system MUST do it.", kind="fr", must_level="MUST",
    priority=None, planned=False, source=SpecRef(path="PRD.md", line=1),
)  # fmt: skip
G = "gears-rust/"


def cards(*names: str) -> dict[str, GearCard]:
    return {G + n: GearCard(gear_id=G + n, name=n, text=f"{n} does things") for n in names}


ALL = cards(
    "credstore", "authz-resolver", "usage-collector", "llm-gateway", "mini-chat", "studio-backend",
    "paper-gear", "settings-service",
)  # fmt: skip


class Script:
    """Answers each check from a table; records what it was asked."""

    def __init__(self, table: Mapping[str, Contribution], fail: bool = False) -> None:
        self.table, self.fail = table, fail
        self.asked: list[tuple[list[str], list[str]]] = []

    def __call__(
        self, _req: Requirement, checked: Sequence[GearCard], also: Sequence[str]
    ) -> dict[str, Contribution]:
        self.asked.append(([c.gear_id for c in checked], list(also)))
        if self.fail:
            raise CheckError("the reply stayed unusable after one repair")
        return {c.gear_id: self.table[c.gear_id] for c in checked if c.gear_id in self.table}


def run(
    first: list[str], second: list[str], targeted: Script, strict: Script, own: tuple[str, ...] = ()
) -> Decision:
    return decide(
        R,
        first=[G + g for g in first],
        second=[G + g for g in second],
        own=frozenset(G + g for g in own),
        in_code=lambda g: g != G + "paper-gear",
        cards=ALL,
        targeted=targeted,
        strict=strict,
    )


def test_the_check_prompt_is_the_measured_one() -> None:
    assert CHECK_PROMPT_HASH == "28da910e060e6177"


def test_both_models_and_the_strict_check_make_the_build_list() -> None:
    strict = Script({G + "usage-collector": "outcome", G + "llm-gateway": "input_only"})
    d = run(
        ["usage-collector", "llm-gateway"], ["usage-collector", "llm-gateway"], Script({}), strict
    )
    assert d.build == [G + "usage-collector"]
    assert d.removed == {G + "llm-gateway": "strict check: input_only"}
    assert d.candidates == [G + "usage-collector", G + "llm-gateway"]


def test_a_gear_only_one_model_picked_never_reaches_the_build_list() -> None:
    strict = Script({})
    d = run(["usage-collector"], ["llm-gateway"], Script({}), strict)
    assert (d.build, strict.asked) == ([], [])
    assert d.candidates == [G + "usage-collector", G + "llm-gateway"]


def test_plumbing_with_others_and_broad_gears_get_the_targeted_check() -> None:
    targeted = Script({G + "authz-resolver": "condition_only", G + "credstore": "outcome"})
    strict = Script({G + "credstore": "outcome", G + "usage-collector": "outcome"})
    picks = ["authz-resolver", "credstore", "usage-collector"]
    d = run(picks, picks, targeted, strict)
    assert d.removed == {G + "authz-resolver": "plumbing check: condition_only"}
    assert d.build == [G + "credstore", G + "usage-collector"]
    assert targeted.asked == [
        ([G + "authz-resolver"], [G + "credstore", G + "usage-collector"]),
        ([G + "credstore"], [G + "usage-collector"]),
    ]


def test_a_lone_plumbing_gear_is_not_checked_by_the_targeted_check() -> None:
    targeted = Script({})
    d = run(
        ["authz-resolver"], ["authz-resolver"], targeted, Script({G + "authz-resolver": "outcome"})
    )
    assert (targeted.asked, d.build) == ([], [G + "authz-resolver"])


def test_a_product_like_gear_only_the_second_model_picked_is_added_only_when_it_passes() -> None:
    both = Script({G + "usage-collector": "outcome", G + "mini-chat": "outcome"})
    second = ["usage-collector", "mini-chat"]
    passes = run(["usage-collector"], second, Script({G + "mini-chat": "outcome"}), both)
    assert passes.build == [G + "usage-collector", G + "mini-chat"]
    only = Script({G + "usage-collector": "outcome"})
    fails = run(["usage-collector"], second, Script({G + "mini-chat": "input_only"}), only)
    assert fails.build == [G + "usage-collector"]


def test_the_products_own_gear_is_never_a_candidate() -> None:
    picks = ["studio-backend", "usage-collector"]
    strict = Script({G + "usage-collector": "outcome"})
    d = run(picks, picks, Script({}), strict, own=("studio-backend",))
    assert G + "studio-backend" not in d.candidates
    assert d.build == [G + "usage-collector"]


def test_a_lone_plumbing_gear_left_after_the_own_gear_is_not_checked() -> None:  # #90 review
    targeted = Script({})
    picks = ["studio-backend", "authz-resolver"]
    d = run(
        picks, picks, targeted, Script({G + "authz-resolver": "outcome"}), own=("studio-backend",)
    )
    assert (targeted.asked, d.build) == ([], [G + "authz-resolver"])


def test_a_settings_gear_that_only_stores_the_value_is_removed() -> None:  # T11 D20
    targeted = Script({G + "settings-service": "input_only"})
    d = run(["settings-service"], ["settings-service"], targeted, Script({}))
    assert targeted.asked == [([G + "settings-service"], [])]
    assert d.removed == {G + "settings-service": "broad-Gear check: input_only"}
    assert d.build == []


def test_a_settings_gear_that_does_the_outcome_stays_on_the_build_list() -> None:  # #93 review
    targeted = Script({G + "settings-service": "outcome"})  # "users MUST save their preferences"
    strict = Script({G + "settings-service": "outcome"})
    d = run(["settings-service"], ["settings-service"], targeted, strict)
    assert targeted.asked == [([G + "settings-service"], [])]
    assert (d.removed, d.build) == ({}, [G + "settings-service"])


def test_a_gear_without_code_never_reaches_the_build_list() -> None:
    strict = Script({})
    d = run(["paper-gear"], ["paper-gear"], Script({}), strict)
    assert (d.build, strict.asked, d.candidates) == ([], [], [G + "paper-gear"])


def test_a_check_that_cannot_be_answered_makes_the_requirement_not_assessed() -> None:
    d = run(["usage-collector"], ["usage-collector"], Script({}), Script({}, fail=True))
    assert d.build == []
    assert d.failed is not None
    assert "could not be answered" in d.failed


@pytest.mark.parametrize("answer", ["cannot_tell", None])
def test_the_strict_check_keeps_only_outcome(answer: Contribution | None) -> None:
    table = {G + "usage-collector": answer} if answer else {}
    d = run(["usage-collector"], ["usage-collector"], Script({}), Script(table))
    assert d.build == []
    assert d.removed == {G + "usage-collector": f"strict check: {answer or 'no answer'}"}
