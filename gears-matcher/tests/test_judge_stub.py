"""StubJudge (T4 note D7) and the T2 -> T1 -> T4 wiring (B7)."""

import os
from pathlib import Path

from gears_matcher.judge import GearCard, StubJudge, evidence_problem, gear_card, judge_requirement
from gears_matcher.judge.stub import content_words
from gears_matcher.models import Gear, Requirement, SpecRef
from gears_matcher.retrieval import gear_text
from gears_matcher.spec import load_spec

FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(os.environ.get("GEARS_RUST_REPO", Path(__file__).parents[2] / "gears-rust"))


def req(text: str, title: str = "Tasks") -> Requirement:
    return Requirement(
        id="cpt-x-fr-1",
        title=title,
        text=text,
        kind="fr",
        must_level="MUST",
        priority=None,
        planned=False,
        source=SpecRef(path="PRD.md", line=1),
    )


def card(gid: str, *lines: str) -> GearCard:
    return GearCard(gear_id=gid, name=lines[0], text="\n".join(lines))


SCHEDULER = card(
    "gears-rust/scheduler",
    "Scheduler",
    "Run recurring jobs on a cron schedule",
    "Retry failed jobs with backoff",
)


def one(text: str, c: GearCard = SCHEDULER, title: str = "Jobs") -> tuple[str, float, str, str]:
    (r,) = StubJudge().judge(req(text, title), [c])
    return r.verdict, r.confidence, r.evidence, r.rationale


def test_content_words_fold_case_accents_and_drop_function_words() -> None:
    assert content_words("The SYSTEM MUST run Récurring jobs, a_b x") == {
        "system",
        "run",
        "recurring",
        "jobs",
    }


def test_covered_when_half_the_words_are_in_the_card() -> None:
    verdict, conf, evidence, rationale = one("run recurring cron jobs", title="Jobs")
    assert (verdict, conf, evidence) == ("covered", 1.0, "Run recurring jobs on a cron schedule")
    assert rationale == "1.00 of the requirement's 4 content words are in the card"


def test_partial_between_a_quarter_and_a_half() -> None:
    verdict, conf, evidence, _ = one("retry payment invoices nightly", title="Retry")
    assert (verdict, conf, evidence) == ("partial", 0.25, "Retry failed jobs with backoff")


def test_none_below_a_quarter() -> None:
    verdict, conf, evidence, _ = one("export invoices as pdf files nightly", title="Billing")
    assert (verdict, conf, evidence) == ("none", 0.0, "")


def test_too_few_words_is_unjudgeable_for_every_card() -> None:
    other = card("gears-rust/other", "Other", "does other things here")
    replies = StubJudge().judge(req("The system MUST do it.", title="It"), [SCHEDULER, other])
    assert [(r.verdict, r.confidence) for r in replies] == [("unjudgeable", 0.0)] * 2
    assert replies[0].rationale == "too short to judge: 1 content words (fewer than 3)"


def test_overlap_only_in_the_name_or_a_short_line_gives_none() -> None:
    # The words match, but no line can be quoted: the name and two-word lines fail R1.
    c = card("gears-rust/cron-jobs", "Cron Jobs", "cron jobs", "Keeps state")
    assert one("cron jobs schedule", c, title="Cron")[0] == "none"


def test_ties_go_to_the_first_line() -> None:
    c = card("gears-rust/x", "X", "alpha beta gamma here", "alpha beta delta here")
    assert one("alpha beta words", c, title="Alpha")[2] == "alpha beta gamma here"


def test_same_output_on_every_run_and_for_any_card_order() -> None:
    other = card("gears-rust/other", "Other", "export invoices as pdf files")
    r = req("run recurring cron jobs and export invoices")
    first = StubJudge().judge(r, [SCHEDULER, other])
    again = StubJudge().judge(r, [other, SCHEDULER])
    assert sorted(first, key=lambda x: x.gear_id) == sorted(again, key=lambda x: x.gear_id)


# --- wiring: T2's spec, T1's catalogue, the seam, the stub -------------------------------------


def _assert_all_evidence_verified(gears: tuple[Gear, ...], reqs: tuple[Requirement, ...]) -> None:
    cards = {g.id: gear_card(g) for g in gears}
    verdicts = set()
    for r in reqs:
        matches = judge_requirement(StubJudge(), r, gears)
        assert [m.gear_id for m in matches] == sorted(g.id for g in gears)
        for m in matches:
            assert m.problem is None  # the stub never trips the seam's rules
            verdicts.add(m.verdict)
            if m.verdict in ("covered", "partial"):
                c = cards[m.gear_id]
                assert evidence_problem(m.evidence, c.text, c.name) is None
    assert "none" in verdicts
    assert verdicts & {"covered", "partial"}  # real data reaches the evidence check


def test_card_holds_the_text_t3_searches(fixture_gears: tuple[Gear, ...]) -> None:  # T4 note D3
    assert any(g.description and g.description != g.responsibility for g in fixture_gears)
    for g in fixture_gears:
        searched = [line.strip() for line in gear_text(g).split("\n")]
        assert gear_card(g).text == "\n".join(line for line in searched if line)


def test_wiring_todo_app_prd_through_fixture_catalogue(fixture_gears: tuple[Gear, ...]) -> None:
    spec = load_spec(FIXTURES / "spec" / "todo-app" / "PRD.md")
    gears = fixture_gears
    assert len(spec.requirements) == 8
    assert len(gears) > 5
    _assert_all_evidence_verified(gears, spec.requirements)


def test_r8_stub_says_what_is_covered_and_what_is_missing() -> None:
    (partial,) = StubJudge().judge(req("retry payment invoices nightly", "Retry"), [SCHEDULER])
    assert (partial.verdict, partial.covers, partial.missing) == (
        "partial",
        "Retry failed jobs with backoff",
        "not in the card: invoices, nightly, payment",
    )
    (covered,) = StubJudge().judge(req("run recurring cron jobs", "Jobs"), [SCHEDULER])
    assert (covered.verdict, covered.covers, covered.missing) == (
        "covered",
        "Run recurring jobs on a cron schedule",
        "",
    )
