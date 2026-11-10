"""T5 coverage report: every rule C1-C6, the lean list, totals, bad input, schema (T5 note §7)."""

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gears_matcher.catalogue import Catalogue, ParseReport
from gears_matcher.judge import StubJudge, judge_requirement
from gears_matcher.models import Gear, JudgeProblem, Match, Requirement, SourceRef, SpecRef
from gears_matcher.report import (
    SCHEMA_FILE,
    CoverageCounts,
    CoverageReport,
    ReportInputError,
    RunSettings,
    Totals,
    build_report,
    coverage_of,
    report_schema_json,
    roll_up,
    validated_json,
)
from gears_matcher.spec import Spec, SpecReport, load_spec

ROOT = Path(__file__).parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
RUN = RunSettings(judge="ScriptedJudge", shortlist="hand-built")


def m(gid: str, verdict: str = "none", conf: float = 0.5, problem: str | None = None) -> Match:
    if problem:
        verdict = "unjudgeable"  # a judge problem always means unjudgeable (T4 D1)
    supporting = verdict in ("covered", "partial")
    return Match(
        requirement_id="r1",
        gear_id=f"gears-rust/{gid}",
        verdict=verdict,  # type: ignore[arg-type]
        confidence=0.0 if problem else conf,
        evidence="a quoted line here" if supporting else "",
        covers=f"what {gid} gives" if supporting else "",
        missing=f"left after {gid}" if verdict == "partial" else "",
        rationale=f"{verdict} because" if not problem else "",
        problem=JudgeProblem(kind=problem, detail="x") if problem else None,  # type: ignore[arg-type]
    )


def req(rid: str = "r1", kind: str = "fr", planned: bool = False) -> Requirement:
    return Requirement(
        id=rid,
        title=rid,
        text=f"The system MUST do {rid}.",
        kind=kind,  # type: ignore[arg-type]
        must_level="MUST",
        priority=None,
        planned=planned,
        source=SpecRef(path="PRD.md", line=1),
    )


# --- C1-C6 and their precedence (B6) -----------------------------------------------------------


@pytest.mark.parametrize(
    ("matches", "coverage", "reason"),
    [
        ([], "gap", "no candidate gear"),  # C6
        ([m("a"), m("b")], "gap", "every candidate judged none"),  # C5
        ([m("a", "covered", 0.3), m("b", problem="judge_timeout")], "covered", None),  # C1
        ([m("a", "partial"), m("b", "unjudgeable")], "partial", None),  # C2
        (
            [m("a", "unjudgeable"), m("b", "unjudgeable")],
            "clarification_needed",
            "the judge could not decide for any gear: unjudgeable because",
        ),  # C3
        (
            [m("a", "unjudgeable"), m("b", problem="judge_error")],
            "not_assessed",
            "not decided for 2 of 2 gears: judge could not decide x1, judge_error x1",
        ),  # C4: own can't-tell + problem
        (
            [m("a"), m("b", "unjudgeable")],
            "clarification_needed",
            "the judge could not decide for 1 of 2 gears: unjudgeable because",
        ),  # C3 (T11 D6): none + own can't-tell, nothing failed
        (
            [m("a"), m("b", problem="judge_timeout"), m("c", problem="judge_timeout")],
            "not_assessed",
            "not decided for 2 of 3 gears: judge_timeout x2",
        ),  # C4: none + problems
        (
            [m("a", problem="no_reply"), m("b", problem="no_reply")],
            "not_assessed",
            "not decided for 2 of 2 gears: no_reply x2",
        ),  # every gear a problem: not a clarification (T4 D1)
    ],
)
def test_coverage_rules_and_precedence(
    matches: list[Match], coverage: str, reason: str | None
) -> None:
    got, why = coverage_of(matches)
    assert got == coverage
    if reason is not None:
        assert why == reason


def test_covered_beats_partial_and_confidence_breaks_ties() -> None:
    matches = [m("a", "partial", 0.9), m("b", "covered", 0.4), m("c", "covered", 0.6)]
    assert coverage_of(matches) == ("covered", "covered by gears-rust/c; 2 other gears also help")


def test_multi_gear_partial_lists_every_partial_gear_chosen_first() -> None:
    row = roll_up(req(), [m("a", "partial", 0.4), m("b", "partial", 0.7), m("c")], tau=0.5)
    assert row.coverage == "partial"
    assert [(g.gear_id, g.role) for g in row.gears] == [
        ("gears-rust/b", "chosen"),
        ("gears-rust/a", "alternative"),
        ("gears-rust/c", "other"),
    ]
    assert (row.confidence, row.low_confidence) == (0.7, False)
    assert (row.gear_provides, row.remaining_work) == ("what b gives", "left after b")
    assert row.reason == "partly covered by gears-rust/b; 1 other gear also helps"


def test_a_confident_none_never_outranks_a_gear_that_helps() -> None:  # D12
    row = roll_up(
        req(), [m("a", "none", 0.95), m("b", "partial", 0.3), m("c", "partial", 0.6)], tau=0.5
    )
    assert [(g.gear_id, g.role) for g in row.gears] == [
        ("gears-rust/c", "chosen"),
        ("gears-rust/b", "alternative"),
        ("gears-rust/a", "other"),
    ]


def test_low_confidence_is_flagged_never_relabelled() -> None:
    row = roll_up(req(), [m("a", "covered", 0.42)], tau=0.5)
    assert (row.coverage, row.confidence, row.low_confidence) == ("covered", 0.42, True)
    assert (row.gear_provides, row.remaining_work) == ("what a gives", "")  # covered: no rest named


def test_rows_without_a_chosen_gear_have_no_confidence() -> None:
    row = roll_up(req(planned=True), [m("a"), m("b", problem="no_reply")], tau=0.5)
    assert (row.coverage, row.confidence, row.low_confidence, row.planned) == (
        "not_assessed",
        None,
        False,
        True,
    )


# --- build_report: the lean list, totals, provenance ---------------------------------------------


def gear(gid: str, gdl: bool = True) -> Gear:
    kind = "gear-gdl" if gdl else "gears-md"
    return Gear(
        id=f"gears-rust/{gid}",
        name=gid.title(),
        category=None,
        responsibility="does things",
        sources=(SourceRef(kind=kind, path="x", line=1),),  # type: ignore[arg-type]
    )


CATALOGUE = Catalogue(
    gears_md_commit="md1",
    gear_gdl_commit="gdl1",
    gears=tuple(gear(g, gdl=g != "docs-only") for g in ("a", "b", "c", "docs-only")),
    report=ParseReport(
        md_sections=0,
        md_skipped=(),
        gdl_gears=0,
        gdl_plugins=0,
        gdl_skipped=(),
        joined=0,
        md_only=(),
        gdl_only=(),
        markers_stripped=0,
    ),
)


def spec(*reqs: Requirement) -> Spec:
    return Spec(
        product_id="todo",
        name="Todo",
        repository="org/todo",
        commit="abc",
        requirements=reqs,
        inputs=(),
        report=SpecReport(
            requirements=len(reqs),
            fr=0,
            nfr=0,
            no_must_level=0,
            planned=0,
            read=1,
            handed_to_t8=0,
            skipped=0,
        ),
    )


def pair(rid: str, gid: str, verdict: str = "none", conf: float = 0.5, **kw: Any) -> Match:
    return m(gid, verdict, conf, **kw).model_copy(update={"requirement_id": rid})


def test_lean_list_one_gear_per_need_and_nothing_dropped() -> None:
    s = spec(req("r1"), req("r2"), req("r3", kind="nfr"), req("r4"))
    shortlist = {
        "r1": ["gears-rust/a", "gears-rust/b"],
        "r2": ["gears-rust/b"],
        "r3": ["gears-rust/docs-only"],
        "r4": [],
    }
    matches = [
        pair("r1", "a", "partial", 0.8),  # chosen for r1
        pair("r1", "b", "partial", 0.6),  # alternative for r1
        pair("r2", "b", "covered", 0.3),  # chosen for r2 but below tau
        pair("r3", "docs-only", "partial", 0.9),  # chosen for r3 (NFR)
    ]
    report = build_report(s, CATALOGUE, shortlist, matches, settings=RUN)
    rec = [
        (u.gear_id, u.confidence, u.requirement_ids, u.in_code) for u in report.recommended_gears
    ]
    assert rec == [
        ("gears-rust/docs-only", 0.9, ("r3",), False),
        ("gears-rust/a", 0.8, ("r1",), True),
    ]
    also = [(u.gear_id, u.confidence, u.requirement_ids) for u in report.also_possible]
    assert also == [("gears-rust/b", 0.6, ("r1", "r2"))]  # D5: the maximum, not the mean
    assert report.totals == Totals(
        requirements=4,
        fr=CoverageCounts(covered=1, partial=1, gap=1),
        nfr=CoverageCounts(partial=1),
    )
    assert report.gaps() == ("r4",)
    assert report.clarification_needed() == ()
    assert [r.requirement_id for r in report.requirements] == ["r1", "r2", "r3", "r4"]
    p = report.provenance
    assert (p.product_id, p.spec_commit, p.gears_md_commit, p.gear_gdl_commit, p.tau) == (
        "todo",
        "abc",
        "md1",
        "gdl1",
        0.5,
    )


def test_one_gear_chosen_for_two_requirements_is_listed_once() -> None:  # D3, D5
    s = spec(req("r1"), req("r2"))
    shortlist = {"r1": ["gears-rust/a"], "r2": ["gears-rust/a"]}
    matches = [pair("r1", "a", "covered", 0.4), pair("r2", "a", "partial", 0.8)]
    report = build_report(s, CATALOGUE, shortlist, matches, settings=RUN)
    rec = [(u.gear_id, u.confidence, u.requirement_ids) for u in report.recommended_gears]
    assert rec == [("gears-rust/a", 0.8, ("r1", "r2"))]  # one entry: both needs, the maximum
    assert report.also_possible == ()


def test_recommended_is_empty_when_no_chosen_gear_reaches_tau() -> None:  # D3
    s = spec(req("r1"))
    report = build_report(
        s, CATALOGUE, {"r1": ["gears-rust/a"]}, [pair("r1", "a", "covered", 0.4)], settings=RUN
    )
    assert report.recommended_gears == ()
    assert [(u.gear_id, u.confidence) for u in report.also_possible] == [("gears-rust/a", 0.4)]
    row = report.requirements[0]
    assert (row.coverage, row.low_confidence) == ("covered", True)  # covered, flagged, not dropped


def test_a_gear_with_only_none_is_not_listed() -> None:
    report = build_report(
        spec(req("r1")), CATALOGUE, {"r1": ["gears-rust/a"]}, [pair("r1", "a")], settings=RUN
    )
    assert (report.recommended_gears, report.also_possible) == ((), ())


def test_totals_that_do_not_add_up_are_rejected() -> None:  # D8 in the model itself
    report = build_report(spec(req("r1")), CATALOGUE, {"r1": []}, [], settings=RUN)
    data = report.model_dump()
    data["totals"]["fr"]["gap"] = 0
    with pytest.raises(ValueError, match="do not match the requirements"):
        CoverageReport.model_validate(data)


# --- D11: bad input fails loud ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("shortlist", "matches", "kind"),
    [
        ({}, [], "shortlist_missing_requirement"),
        ({"r1": [], "rX": []}, [], "unknown_requirement"),
        ({"r1": ["gears-rust/a", "gears-rust/a"]}, [], "duplicate_candidate"),
        ({"r1": ["gears-rust/zzz"]}, [], "unknown_gear"),
        ({"r1": ["gears-rust/a"]}, [], "missing_match"),
        ({"r1": []}, [pair("r1", "a")], "unexpected_match"),
        ({"r1": ["gears-rust/a"]}, [pair("r1", "a"), pair("r1", "a")], "duplicate_match"),
    ],
)
def test_bad_input_raises_with_its_kind(
    shortlist: dict[str, list[str]], matches: list[Match], kind: str
) -> None:
    with pytest.raises(ReportInputError) as err:
        build_report(spec(req("r1")), CATALOGUE, shortlist, matches, settings=RUN)
    assert err.value.kind == kind
    assert str(err.value).startswith(f"{kind}: ")


def test_duplicate_requirements_raise_and_long_lists_are_cut() -> None:
    with pytest.raises(ReportInputError, match="duplicate_requirement: r1"):
        build_report(spec(req("r1"), req("r1")), CATALOGUE, {"r1": []}, [], settings=RUN)
    many = {f"x{i}": list[str]() for i in range(7)} | {"r1": list[str]()}
    with pytest.raises(ReportInputError, match=r"x0, x1, x2, x3, x4 \(\+2 more\)$"):
        build_report(spec(req("r1")), CATALOGUE, many, [], settings=RUN)


# --- T11: Gears to confirm and requirements a matcher could not assess ---------------------------


def test_gears_to_confirm_are_listed_as_also_possible_and_never_recommended() -> None:
    s = spec(req("r1"), req("r2"))
    shortlist = {"r1": ["gears-rust/a", "gears-rust/b"], "r2": ["gears-rust/c"]}
    matches = [
        pair("r1", "a", "unjudgeable"),  # suggested, not confirmed
        pair("r1", "b"),  # none
        pair("r2", "c", "unjudgeable", problem="judge_error"),  # judging failed: not shown
    ]
    report = build_report(s, CATALOGUE, shortlist, matches, settings=RUN)
    assert [r.coverage for r in report.requirements] == ["clarification_needed", "not_assessed"]
    assert report.recommended_gears == ()
    assert [u.gear_id for u in report.also_possible] == ["gears-rust/a"]


def test_a_requirement_the_matcher_could_not_assess_is_not_assessed_with_its_reason() -> None:
    s = spec(req("r1"), req("r2"))
    report = build_report(
        s,
        CATALOGUE,
        {"r1": [], "r2": []},
        [],
        settings=RUN,
        failed={"r2": "the whole-catalogue call failed"},
    )
    assert [(r.coverage, r.reason) for r in report.requirements] == [
        ("gap", "no candidate gear"),
        ("not_assessed", "the whole-catalogue call failed"),
    ]


def test_future_parts_list_gears_with_no_code_most_needed_first() -> None:  # T11 D15
    s = spec(req("r1"), req("r2"), req("r3"))
    shortlist = {
        "r1": ["gears-rust/a", "gears-rust/docs-only"],
        "r2": ["gears-rust/b", "gears-rust/docs-only"],
        "r3": ["gears-rust/b", "gears-rust/c"],
    }
    matches = [
        pair("r1", "a", "covered", 0.9),
        pair("r1", "docs-only", "unjudgeable"),  # to confirm, no code
        pair("r2", "b", "unjudgeable"),  # to confirm; no code when `has_code` says so
        pair("r2", "docs-only", "partial", 0.8),
        pair("r3", "b", "partial", 0.6),
        pair("r3", "c"),  # none: never a future part
    ]
    report = build_report(s, CATALOGUE, shortlist, matches, settings=RUN)
    assert [(u.gear_id, u.requirement_ids) for u in report.future_parts] == [
        ("gears-rust/docs-only", ("r1", "r2"))
    ]
    no_b = build_report(
        s, CATALOGUE, shortlist, matches, settings=RUN,
        has_code=lambda g: g.id not in {"gears-rust/b", "gears-rust/docs-only"},
    )  # fmt: skip
    assert [(u.gear_id, u.requirement_ids) for u in no_b.future_parts] == [
        ("gears-rust/b", ("r2", "r3")),
        ("gears-rust/docs-only", ("r1", "r2")),
    ]
    assert not next(u for u in no_b.recommended_gears if u.gear_id == "gears-rust/b").in_code


def test_also_possible_lists_only_gears_with_code() -> None:  # T11 D19
    s = spec(req("r1"), req("r2"))
    shortlist = {"r1": ["gears-rust/a", "gears-rust/docs-only"], "r2": ["gears-rust/b"]}
    matches = [
        pair("r1", "a", "covered", 0.9),
        pair("r1", "docs-only", "partial", 0.8),  # helps, no code
        pair("r2", "b", "unjudgeable"),  # to confirm, with code
    ]
    report = build_report(s, CATALOGUE, shortlist, matches, settings=RUN)
    assert [u.gear_id for u in report.also_possible] == ["gears-rust/b"]
    assert [u.gear_id for u in report.future_parts] == ["gears-rust/docs-only"]


def test_failed_must_name_known_requirements() -> None:
    with pytest.raises(ReportInputError, match="unknown_failed_requirement"):
        build_report(spec(req("r1")), CATALOGUE, {"r1": []}, [], settings=RUN, failed={"r9": "x"})
    with pytest.raises(ReportInputError, match="unknown_future_requirement"):  # #90 review
        build_report(spec(req("r1")), CATALOGUE, {"r1": []}, [], settings=RUN, future={"r9": "x"})


# --- property: any valid matches give a consistent report --------------------------------------

_VERDICTS = st.sampled_from(["covered", "partial", "none", "unjudgeable", "problem"])


@settings(max_examples=150, deadline=None)
@given(
    st.lists(st.lists(st.tuples(_VERDICTS, st.floats(0, 1)), max_size=3), min_size=1, max_size=4)
)
def test_property_report_is_consistent(grid: list[list[tuple[str, float]]]) -> None:
    reqs = [req(f"r{i}", kind="nfr" if i % 2 else "fr") for i in range(len(grid))]
    shortlist: dict[str, list[str]] = {}
    matches: list[Match] = []
    for i, row in enumerate(grid):
        gids = ["a", "b", "c"][: len(row)]
        shortlist[f"r{i}"] = [f"gears-rust/{g}" for g in gids]
        for g, (v, c) in zip(gids, row, strict=True):
            if v == "problem":
                matches.append(pair(f"r{i}", g, "unjudgeable", problem="judge_error"))
            else:
                matches.append(pair(f"r{i}", g, v, c))
    report = build_report(spec(*reqs), CATALOGUE, shortlist, matches, settings=RUN)
    assert [r.requirement_id for r in report.requirements] == [r.id for r in reqs]
    assert report.totals.fr.total() + report.totals.nfr.total() == len(reqs)
    listed = {u.gear_id for u in report.recommended_gears + report.also_possible}
    for line, cells in zip(report.requirements, grid, strict=True):
        if line.coverage == "gap":
            assert all(v == "none" for v, _ in cells)
        for shown in line.gears:
            if shown.verdict in ("covered", "partial"):
                assert shown.gear_id in listed  # nothing that helps is dropped
    json.loads(validated_json(report))


# --- D13: the schema --------------------------------------------------------------------------


def test_committed_schema_equals_the_generated_one() -> None:
    committed = (ROOT / SCHEMA_FILE).read_text(encoding="utf-8")
    assert committed == report_schema_json(), (
        "schema drift: regenerate with `uv run python -m gears_matcher.report > "
        "schemas/coverage-report.schema.json`"
    )


# --- wiring (B7): T2 -> T1 -> T4 stub -> T5, and the committed schema file ----------------------


def test_wiring_todo_app_report_validates_against_the_committed_schema(
    fixture_gears: tuple[Gear, ...],
) -> None:
    s = load_spec(FIXTURES / "spec" / "todo-app" / "PRD.md")
    gears = fixture_gears
    cat = CATALOGUE.model_copy(update={"gears": gears})
    shortlist = {r.id: [g.id for g in gears] for r in s.requirements}
    matches = [x for r in s.requirements for x in judge_requirement(StubJudge(), r, gears)]
    report = build_report(
        s, cat, shortlist, matches, settings=RunSettings(judge="StubJudge", shortlist="all")
    )
    schema = json.loads((ROOT / SCHEMA_FILE).read_text(encoding="utf-8"))
    jsonschema.validate(json.loads(validated_json(report)), schema)
    assert report.totals.requirements == 8
    assert (report.totals.fr.total(), report.totals.nfr.total()) == (5, 3)
