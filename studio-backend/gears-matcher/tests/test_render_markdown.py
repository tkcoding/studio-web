"""T6: the Markdown report (T6 note D6, D9): every section, and untrusted text kept harmless."""

import re

from test_report import CATALOGUE, RUN, m, pair, req, spec

from gears_matcher.models import JudgeProblem, Match, Requirement
from gears_matcher.render import CELL_LIMIT, RunInfo, escape, plain, render
from gears_matcher.render import markdown as markdown_module
from gears_matcher.report import CoverageReport, RunSettings, build_report
from gears_matcher.spec.models import InputDoc, Spec

INFO = RunInfo(spec_path="specs/todo/PRD.md", made_on="2026-10-27", tool_version="0.1.0")
UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")
LINK = re.compile(r"(?<!\\)\]\(")  # a link or image: `](` not escaped


def _render(
    s: Spec, shortlist: dict[str, list[str]], matches: list[Match]
) -> tuple[str, CoverageReport]:
    report = build_report(s, CATALOGUE, shortlist, matches, settings=RUN)
    return render(report, s, CATALOGUE, INFO), report


def _row(text: str, title: str) -> str:
    return next(line for line in text.splitlines() if line.startswith(f"| {title}"))


def test_escape_makes_untrusted_text_plain() -> None:  # D9
    raw = "a|b\n<img src=x>[link](http://x) `code` *em* _u_ \\"
    out = escape(raw)
    assert "\n" not in out
    assert UNESCAPED_PIPE.search(out) is None
    assert "<" not in out
    assert ">" not in out
    assert LINK.search(out) is None
    assert out == (
        "a\\|b &lt;img src=x&gt;\\[link\\](http&#58;//x) \\`code\\` \\*em\\* \\_u\\_ \\\\"
    )


def test_escape_drops_control_and_format_characters() -> None:  # CONTRIBUTING A3
    raw = "a\x1b[31mred\x00b\u202ec\u200bd\x7f"  # ESC, NUL, RTL override, zero width, DEL
    assert plain(raw) == "a [31mred b c d"
    assert escape(raw) == "a \\[31mred b c d"


def test_escape_cuts_long_text() -> None:
    assert escape("x" * (CELL_LIMIT + 50)) == "x" * (CELL_LIMIT - 1) + "…"
    assert escape("short") == "short"


def test_header_summary_and_every_section_in_order() -> None:  # D6
    s = spec(req("r1"), req("r2"), req("r3", kind="nfr"))
    shortlist = {"r1": ["gears-rust/a"], "r2": [], "r3": ["gears-rust/b"]}
    matches = [pair("r1", "a", "covered", 0.8), pair("r3", "b", "partial", 0.6)]
    text, _ = _render(s, shortlist, matches)
    headings = [line for line in text.splitlines() if line.startswith("#")]
    assert headings == [
        "# Gears Matcher report: Todo",
        "## Summary",
        "## Gears to use",
        "## Functional requirements",
        "## Non-functional requirements",
        "## Gaps",
        "### No candidate gear (search found none)",
        "## Inputs",
    ]
    assert "| Spec | specs/todo/PRD.md (org/todo at `abc`) |" in text
    assert "| Catalogue | GEARS.md `md1` · gear.gdl `gdl1` · 4 gears |" in text
    judge_row = (
        "| Judge | ScriptedJudge · hand-built · τ = 0.5 (the default, not yet calibrated: T10) |"
    )
    assert judge_row in text
    assert "| Made by | gears-match 0.1.0 on 2026-10-27 |" in text
    assert "| Functional (2) | 1 | 0 | 1 | 0 | 0 |" in text
    assert "| Non-functional (1) | 0 | 1 | 0 | 0 | 0 |" in text
    assert text.endswith("\n")


def test_the_stub_judge_is_named_in_words() -> None:  # D7
    s = spec(req("r1"))
    report = build_report(
        s, CATALOGUE, {"r1": []}, [], settings=RUN.model_copy(update={"judge": "stub"})
    )
    assert "stub judge (word matching, for tests)" in render(report, s, CATALOGUE, INFO)


def test_no_recommended_gear_is_said_in_words() -> None:  # T5 D3
    s = spec(req("r1"))
    text, report = _render(s, {"r1": ["gears-rust/a"]}, [pair("r1", "a", "covered", 0.4)])
    assert report.recommended_gears == ()
    assert "No gear reached τ = 0.5, so none is recommended." in text
    assert "### Also possible" in text
    assert "| A | 0.40 | in code | r1 |" in text
    assert "covered *(low confidence)*" in _row(text, "r1")


def test_requirement_row_holds_gear_evidence_gives_and_left_to_build() -> None:
    s = spec(req("r1", planned=True))
    shortlist = {"r1": ["gears-rust/a", "gears-rust/b"]}
    matches = [pair("r1", "a", "partial", 0.8), pair("r1", "b", "partial", 0.6)]
    text, _ = _render(s, shortlist, matches)
    assert _row(text, "r1") == (
        "| r1 *(planned)* | partial | A | 0.80 | “a quoted line here” | "
        "gives: what a gives · to build: left after a · + 1 other gear help |"
    )


def test_gaps_are_split_by_reason() -> None:  # T5 D2
    s = spec(req("r1"), req("r2"))
    text, _ = _render(s, {"r1": [], "r2": ["gears-rust/a"]}, [pair("r2", "a")])
    gaps = text.split("## Gaps", 1)[1].split("## Inputs", 1)[0]
    assert "### No candidate gear (search found none)\n\n- r1" in gaps
    assert "### Every candidate judged none\n\n- r2" in gaps


def test_clarification_and_not_assessed_are_listed_with_their_reasons() -> None:
    s = spec(req("r1"), req("r2"))
    shortlist = {"r1": ["gears-rust/a"], "r2": ["gears-rust/a"]}
    vague = pair("r1", "a", "unjudgeable", 0.5)
    failed = m("a", problem="judge_timeout").model_copy(update={"requirement_id": "r2"})
    text, _ = _render(s, shortlist, [vague, failed])
    assert "## Clarification needed\n\n- **r1**: the judge could not decide for any gear" in text
    assert "## Not assessed\n\n- **r2**: not decided for 1 of 1 gears: judge\\_timeout x1" in text


def test_a_documented_only_gear_says_so() -> None:  # main note §4
    s = spec(req("r1"))
    text, _ = _render(
        s, {"r1": ["gears-rust/docs-only"]}, [pair("r1", "docs-only", "covered", 0.9)]
    )
    assert "| Docs-Only | 0.90 | no code yet | r1 |" in text


def test_injected_title_and_model_text_cannot_break_the_table() -> None:  # D9
    evil = "Evil | x\n<img src=http://x/p.png> [click](http://x) `rm`"
    r1: Requirement = req("r1").model_copy(update={"title": evil})
    s = spec(r1)
    hostile = pair("r1", "a", "partial", 0.8).model_copy(
        update={"covers": "a | b <script>", "missing": "[x](http://y)"}
    )
    text, _ = _render(s, {"r1": ["gears-rust/a"]}, [hostile])
    row = next(line for line in text.splitlines() if line.startswith("| Evil"))
    assert len(UNESCAPED_PIPE.findall(row)) == 7  # six columns, still six
    assert "<img" not in text
    assert "<script" not in text
    assert LINK.search(text) is None


def test_escape_breaks_bare_links_and_line_starts() -> None:  # D9
    assert escape("see https://x.example/p and WWW.y.example") == (
        "see https&#58;//x.example/p and WWW&#46;y.example"
    )
    assert escape("# Big") == "\\# Big"
    assert escape("- item") == "\\- item"
    assert escape("+ item") == "\\+ item"
    assert escape("12. item") == "12\\. item"
    assert escape("3) item") == "3\\) item"
    for kept in ("x-y", "-x", "3.5 GB", "Example: a:b", "a www"):
        assert escape(kept) == kept


HOSTILE = "# Big | x\n- item <b>[l](http://x) www.y.example `c` \x1b[0m\u202e"
HEADINGS = re.compile(r"(# Gears Matcher report: |## |### )")


def test_hostile_text_in_every_field_stays_plain() -> None:  # D9, CONTRIBUTING A5/A6
    covered = req("r1").model_copy(update={"title": HOSTILE})
    gap = req("r2").model_copy(update={"title": HOSTILE})
    unassessed = req("r3").model_copy(update={"title": HOSTILE})
    s = spec(covered, gap, unassessed).model_copy(
        update={
            "name": HOSTILE,
            "repository": HOSTILE,
            "inputs": (InputDoc(path=HOSTILE, status="skipped", requirements=0, reason=HOSTILE),),
        }
    )
    named = tuple(
        g.model_copy(update={"name": HOSTILE}) if g.id == "gears-rust/a" else g
        for g in CATALOGUE.gears
    )
    catalogue = CATALOGUE.model_copy(update={"gears": named})
    good = pair("r1", "a", "covered", 0.9).model_copy(
        update={"evidence": HOSTILE, "covers": HOSTILE, "missing": HOSTILE}
    )
    broken = pair("r3", "b", problem="judge_error").model_copy(
        update={"problem": JudgeProblem(kind="judge_error", detail=HOSTILE)}
    )
    shortlist = {"r1": ["gears-rust/a"], "r2": [], "r3": ["gears-rust/b"]}
    report = build_report(s, catalogue, shortlist, [good, broken], settings=RUN)
    run = RunInfo(spec_path=HOSTILE, made_on="2026-10-27", tool_version="0.1.0")
    text = render(report, s, catalogue, run)

    assert {r.coverage for r in report.requirements} == {"covered", "gap", "not_assessed"}
    assert "<" not in text
    assert LINK.search(text) is None
    assert "http://" not in text
    assert "www.y" not in text
    assert "\x1b" not in text
    assert "\u202e" not in text
    columns = 0
    for line in text.splitlines():
        if line.startswith("#"):
            assert HEADINGS.match(line), line  # only the report's own headings
        if line.startswith("- "):
            assert not line.startswith(("- #", "- -", "- +")), line
        if line.startswith("|"):
            pipes = len(UNESCAPED_PIPE.findall(line))
            if line.startswith("|---") or not columns:
                columns = pipes if not line.startswith("|---") else columns
            assert pipes == columns, line
        elif not line:
            columns = 0


def test_a_spec_in_git_names_its_repository_and_short_commit() -> None:  # D6 (TK, #52)
    s = spec(req("r1")).model_copy(update={"commit": "0123456789abcdef0123"})
    text, _ = _render(s, {"r1": []}, [])
    assert "| Spec | specs/todo/PRD.md (org/todo at `0123456`) |" in text


def test_tau_note_only_for_the_uncalibrated_default() -> None:  # T10 calibrates τ
    s = spec(req("r1"))
    tuned = RunSettings(judge="ScriptedJudge", shortlist="hand-built", tau=0.7)
    report = build_report(s, CATALOGUE, {"r1": []}, [], settings=tuned)
    assert "| Judge | ScriptedJudge · hand-built · τ = 0.7 |" in render(report, s, CATALOGUE, INFO)


def test_a_gear_serving_many_requirements_shows_a_count_and_the_first_five() -> None:  # TK, #52
    long_title = "x" * 80
    reqs = [
        req(f"r{i}").model_copy(update={"title": f"Requirement {i} {long_title}"}) for i in range(7)
    ]
    s = spec(*reqs)
    shortlist = {r.id: ["gears-rust/a"] for r in reqs}
    matches = [pair(r.id, "a", "covered", 0.9) for r in reqs]
    text, _ = _render(s, shortlist, matches)
    row = next(line for line in text.splitlines() if line.startswith("| A |"))
    cell = row.split(" | ")[-1]
    assert cell.startswith("7 requirements: Requirement 0 ")
    assert cell.endswith(", +2 more |")
    assert cell.count("Requirement ") == 5
    assert "Requirement 0 " + "x" * 35 + "…," in cell  # each title cut at 50 characters
    assert len(UNESCAPED_PIPE.findall(row)) == 5  # four columns, still four
    one = spec(req("r1"))
    single, _ = _render(one, {"r1": ["gears-rust/a"]}, [pair("r1", "a", "covered", 0.9)])
    assert "| A | 0.90 | in code | r1 |" in single


def test_a_lone_title_has_the_whole_cell_and_an_empty_list_shows_a_dash() -> None:  # #54 nits
    title = "y" * 200  # longer than a list item's share (50), shorter than the cell (300)
    lone = spec(req("r1").model_copy(update={"title": title}))
    text, _ = _render(lone, {"r1": ["gears-rust/a"]}, [pair("r1", "a", "covered", 0.9)])
    assert f"| A | 0.90 | in code | {title} |" in text
    assert markdown_module._serves([], {}) == markdown_module.NONE_SHOWN


def test_escape_breaks_email_links_and_maths_and_keeps_joiners() -> None:  # D9 (TK, #52)
    assert escape("mail me@x.example or mailto:a@b.example") == (
        "mail me&#64;x.example or mailto:a&#64;b.example"
    )
    assert escape("costs $5 and $10") == "costs \\$5 and \\$10"
    persian = "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"  # ZWNJ inside a Persian word
    family = "\U0001f468\u200d\U0001f469\u200d\U0001f467"  # an emoji joined with ZWJ
    assert plain(persian) == persian
    assert plain(family) == family
    assert plain("a\u202eb\u200bc") == "a b c"  # a bidi override and a zero-width space still go


def test_gears_whose_names_read_the_same_show_their_ids() -> None:  # T11: "Event(s) Broker"
    first = CATALOGUE.gears[0].model_copy(update={"name": "Events Broker"})
    twin = first.model_copy(update={"id": "gears-rust/a-twin", "name": "Event Broker"})
    cat = CATALOGUE.model_copy(update={"gears": (first, *CATALOGUE.gears[1:], twin)})
    s = spec(req("r1"))
    report = build_report(
        s, cat, {"r1": ["gears-rust/a"]}, [pair("r1", "a", "covered", 0.9)], settings=RUN
    )
    text = render(report, s, cat, INFO)
    assert "| Events Broker (a) | 0.90 | in code | r1 |" in text
    assert "| r1 | covered | Events Broker (a) |" in text
    names = markdown_module.display_names(cat)
    assert names["gears-rust/a-twin"] == "Event Broker (a-twin)"
    assert names["gears-rust/b"] == CATALOGUE.gears[1].name  # a unique name stays as it is
