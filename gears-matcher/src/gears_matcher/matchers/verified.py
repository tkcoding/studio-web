"""T11: the `verified` matcher's decision for one requirement (T11 note §2, steps 1-4).

Given two models' whole-catalogue picks (Sonnet first, Opus second), decide which Gears go on the
build list:

1. a product's own Gears are never candidates for its own requirements (#64);
2. targeted check (Sonnet): a plumbing Gear picked together with other Gears, and a product-like
   Gear only the second model picked, must perform the outcome; a plumbing Gear that fails is
   removed, a product-like Gear is added only when it passes;
3. broad-Gear check (Sonnet): a broad Gear still kept must perform the outcome;
4. a Gear still kept, picked by both models and with code (`in_code`), goes to the strict check
   (gpt-5.4); only "outcome" puts it on the build list.

Every candidate either model picked stays visible: the build list, or "also possible" (step 3 of the
build turns those into Gears to confirm). A check that cannot be answered makes the requirement not
assessed; nothing is guessed.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import REMOVES, CheckError, Contribution
from gears_matcher.models import Requirement

__all__ = ["BROAD", "PLUMBING", "PRODUCT_LIKE", "Decision", "decide"]

PLUMBING: frozenset[str] = frozenset(
    "gears-rust/" + g
    for g in (
        "authn-resolver",
        "authz-resolver",
        "tenant-resolver",
        "nodes-registry",
        "api-gateway",
        "cluster",
    )
)
BROAD: frozenset[str] = frozenset(
    "gears-rust/" + g
    for g in (
        "simple-resource-registry",
        "credstore",
        "event-broker",
        "file-parser",
        "account-management",
        "types-registry",
        "chat-engine",
        "settings-service",  # T11 D20: storing a setting is not doing the feature it configures
        "simple-user-settings",
    )
)
PRODUCT_LIKE: frozenset[str] = frozenset({"gears-rust/mini-chat", "gears-rust/studio-backend"})

# requirement, Gear cards to check, the other Gears proposed (context) -> contribution per Gear
Check = Callable[[Requirement, Sequence[GearCard], Sequence[str]], Mapping[str, Contribution]]


@dataclass
class Decision:
    """One requirement's outcome: every candidate, the build list, and why Gears left the build
    path."""

    candidates: list[str]
    build: list[str]
    removed: dict[str, str] = field(default_factory=dict)  # gear id -> which check, what it said
    failed: str | None = None  # a check could not be answered: the requirement is not assessed
    with_others: bool = False  # the first model picked two Gears or more (plumbing check applies)


def decide(  # noqa: PLR0913 -- the decision's inputs, all keyword-only
    requirement: Requirement,
    *,
    first: Sequence[str],
    second: Sequence[str],
    own: frozenset[str],
    in_code: Callable[[str], bool],
    cards: Mapping[str, GearCard],
    targeted: Check,
    strict: Check,
) -> Decision:
    """The `verified` decision for one requirement (module docstring, steps 1-4)."""
    s = [g for g in dict.fromkeys(first) if g not in own]
    o = [g for g in dict.fromkeys(second) if g not in own]
    candidates = list(dict.fromkeys([*s, *o]))
    decision = Decision(candidates=candidates, build=[])
    decision.with_others = len(s) >= 2  # noqa: PLR2004 -- as measured; the own Gears do not count
    try:
        keep = _targeted_step(requirement, s, o, cards, targeted, decision)
        matched = [g for g in keep if g in o and in_code(g)]
        if matched:
            others = [g for g in candidates if g not in matched]
            said = strict(requirement, [cards[g] for g in matched], others)
            for g in matched:
                if said.get(g) == "outcome":
                    decision.build.append(g)
                else:
                    decision.removed[g] = f"strict check: {said.get(g, 'no answer')}"
    except CheckError as exc:
        decision.build = []
        decision.failed = f"a Gear check could not be answered: {str(exc)[:200]}"
    return decision


def _targeted_step(  # noqa: PLR0913, PLR0917 -- one call site; the decision being built
    requirement: Requirement,
    s: list[str],
    o: list[str],
    cards: Mapping[str, GearCard],
    targeted: Check,
    decision: Decision,
) -> list[str]:
    """Steps 2-3: the plumbing and product-like check, then the broad-Gear check (Sonnet)."""
    risky = [g for g in s if g in PLUMBING] if decision.with_others else []
    product = [g for g in sorted(PRODUCT_LIKE) if g not in s and g in o]
    keep = list(s)
    if risky or product:
        said = targeted(
            requirement, [cards[g] for g in risky + product], [g for g in s if g not in risky]
        )
        for g in risky:
            if said.get(g) in REMOVES:
                keep.remove(g)
                decision.removed[g] = f"plumbing check: {said[g]}"
        keep += [g for g in product if said.get(g) == "outcome"]
    broad = [g for g in keep if g in BROAD]
    if broad:
        said = targeted(requirement, [cards[g] for g in broad], [g for g in keep if g not in broad])
        for g in broad:
            if said.get(g) in REMOVES:
                keep.remove(g)
                decision.removed[g] = f"broad-Gear check: {said[g]}"
    return keep
