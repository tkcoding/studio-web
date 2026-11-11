"""T2: reading CF requirements from one Markdown document (design note §4, D2, D6, D10)."""

import textwrap
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gears_matcher.spec.markdown import (
    SkippedSection,
    blank_hidden,
    join_wrapped,
    must_level,
    parse_markdown,
    requirement_kind,
    skipped_sections,
    visible_lines,
)


def _parse(markdown: str) -> dict[str, str]:
    """ID -> text for every requirement found."""
    return {r.id: r.text for r in parse_markdown(textwrap.dedent(markdown), "PRD.md").requirements}


@pytest.mark.parametrize(
    ("req_id", "kind"),
    [
        ("cpt-studio-fr-connections", "fr"),
        ("cpt-insightspec-aicost-fr-total", "fr"),
        ("cpt-ir-nfr-latency", "nfr"),
        ("cpt-studio-fr-nfr-to-profile", "fr"),  # the first segment decides
        ("cpt-studio-actor-member", None),
        ("cpt-studio-frontend-thing", None),  # `frontend` is not `fr`
    ],
)
def test_kind_is_the_first_fr_or_nfr_segment(req_id: str, kind: str | None) -> None:
    assert requirement_kind(req_id) == kind


@pytest.mark.parametrize(
    "id_line",
    [
        "- [x] `p1` - **ID**: `cpt-a-fr-one`",
        "- [ ] `p2` - **ID**: `cpt-a-fr-one`",
        "- **ID**: `cpt-a-fr-one`",
        "**ID**: `cpt-a-fr-one`",
        "- [x] `p1` - **ID**: `cpt-a-fr-one` (approved)",
        "- [x] `p1` \u2013 **ID**: `cpt-a-fr-one`",  # en dash
        "- [x] `p1` \u2014 **ID**: `cpt-a-fr-one`",  # em dash
    ],
)
def test_id_line_variants(id_line: str) -> None:
    found = parse_markdown(f"#### One\n\n{id_line}\n\nThe system **MUST** work.\n", "PRD.md")
    assert [r.id for r in found.requirements] == ["cpt-a-fr-one"]
    assert found.requirements[0].text == "The system **MUST** work."


def test_record_fields() -> None:
    markdown = """\
        # PRD — Demo

        ## 5. Functional Requirements

        ### 5.1 Core

        #### Create Task

        - [x] `p1` - **ID**: `cpt-demo-fr-create`

        Planned. The system **SHALL** let a user
        create a task.
        """
    (req,) = parse_markdown(textwrap.dedent(markdown), "docs/PRD.md").requirements
    assert req.title == "Create Task"
    assert req.text == "Planned. The system **SHALL** let a user create a task."
    assert (req.kind, req.must_level, req.priority, req.planned) == ("fr", "SHALL", "p1", True)
    assert (req.source.path, req.source.line) == ("docs/PRD.md", 9)
    assert req.source.heading == "5. Functional Requirements > 5.1 Core > Create Task"


@pytest.mark.parametrize(
    "marker",
    [
        "**Rationale**: because",
        "- **Rationale**: because",
        "**Actors**: `cpt-a-actor-user`",
        "- **Actor**: `cpt-a-actor-user`",
        "**Threshold**: 200 ms",
        "**Verification Method**: load test",
        "**Architecture Allocation**: backend",
    ],
)
def test_statement_ends_at_a_marker_line(marker: str) -> None:
    found = _parse(f"""\
        #### One

        - **ID**: `cpt-a-fr-one`

        The system MUST work.

        {marker}

        This line is after the marker.
        """)
    assert found == {"cpt-a-fr-one": "The system MUST work."}


def test_statement_ends_at_the_next_id_line_of_any_kind() -> None:
    found = _parse("""\
        #### One

        - **ID**: `cpt-a-fr-one`

        First.
        **ID**: `cpt-a-actor-user`
        Actor text, not a requirement.
        - **ID**: `cpt-a-nfr-two`
        Second.
        """)
    assert found == {"cpt-a-fr-one": "First.", "cpt-a-nfr-two": "Second."}


def test_a_deeper_heading_is_part_of_the_statement_a_same_level_one_ends_it() -> None:
    found = _parse("""\
        ### 6.4 Recovery

        - **ID**: `cpt-a-nfr-recovery`

        #### After a crash

        The client MUST recover.

        ### 6.5 Next

        Not part of it.
        """)
    assert found == {"cpt-a-nfr-recovery": "After a crash\n\nThe client MUST recover."}


def test_an_id_above_every_heading_is_ended_by_any_heading() -> None:
    (req,) = parse_markdown(
        "- **ID**: `cpt-a-fr-top`\n\nTop.\n\n###### Tiny\n\nAfter.\n", "x.md"
    ).requirements
    assert (req.title, req.text, req.source.heading) == ("cpt-a-fr-top", "Top.", None)


@pytest.mark.parametrize("status", ["**Status**: Not implemented in P1.", "- **Status**: Future."])
def test_status_lines_are_readiness_and_dropped(status: str) -> None:
    found = _parse(f"""\
        #### One

        - **ID**: `cpt-a-fr-one`

        {status}

        The system MUST work.
        """)
    assert found == {"cpt-a-fr-one": "The system MUST work."}


@pytest.mark.parametrize(
    "heading",
    [
        "## 14. Traceability",
        "## 10. Dependencies",
        "## Traceability",
        "### 3.4 dependency",
        "## 4. Dependencies (devDependencies, public)",
    ],
)
def test_sections_that_name_the_answer_are_never_read(heading: str) -> None:
    found = parse_markdown(
        textwrap.dedent(f"""\
        ## 5. Requirements

        #### One

        - **ID**: `cpt-a-fr-one`

        The system MUST work.

        {heading}

        | `cpt-a-fr-one` | `credstore` |

        #### Deeper, still inside

        Names `file-storage`.

        ## 15. After

        #### Two

        - **ID**: `cpt-a-fr-two`

        Visible again.
        """),
        "PRD.md",
    )
    assert {r.id: r.text for r in found.requirements} == {
        "cpt-a-fr-one": "The system MUST work.",
        "cpt-a-fr-two": "Visible again.",
    }
    (issue,) = found.issues
    assert (issue.severity, issue.kind, issue.where) == ("info", "section_not_read", "PRD.md:9")


@pytest.mark.parametrize(
    ("heading", "title"),
    [
        ("#### Dependency Resolution", "Dependency Resolution"),  # TK's review of #27, case 1
        ("### 5.1 Traceability of changes", "5.1 Traceability of changes"),  # case 2
        ("## 3. Feature Dependencies", "3. Feature Dependencies"),
        ("### Dependency graph", "Dependency graph"),
    ],
)
def test_a_title_that_only_contains_the_word_is_read(heading: str, title: str) -> None:
    found = parse_markdown(
        f"{heading}\n\n- **ID**: `cpt-a-fr-dependency-resolution`\n\nThe system MUST resolve.\n",
        "PRD.md",
    )
    assert [(r.id, r.title, r.text) for r in found.requirements] == [
        ("cpt-a-fr-dependency-resolution", title, "The system MUST resolve.")
    ]
    assert found.issues == ()


def test_a_requirement_inside_a_skipped_section_is_an_error_never_a_silent_drop() -> None:
    found = parse_markdown(
        textwrap.dedent("""\
        ## 10. Dependencies

        - **ID**: `cpt-a-fr-hidden`

        #### Deeper, still inside

        - **ID**: `cpt-a-nfr-hidden-too`

        **ID**: `cpt-a-actor-user`

        ## 11. After

        - **ID**: `cpt-a-fr-after`

        Read.
        """),
        "PRD.md",
    )
    assert [r.id for r in found.requirements] == ["cpt-a-fr-after"]
    info, error = found.issues
    assert info.kind == "section_not_read"
    assert (error.severity, error.kind) == ("error", "requirement_in_skipped_section")
    assert error.message == (
        "2 requirement ID(s) inside `10. Dependencies` (PRD.md:1), which is never read, "
        "so not extracted: cpt-a-fr-hidden, cpt-a-nfr-hidden-too"
    )


def test_a_skipped_section_at_the_end_of_the_file_is_still_checked() -> None:
    found = parse_markdown("## 14. Traceability\n\n- **ID**: `cpt-a-fr-last`\n", "PRD.md")
    assert found.requirements == ()
    assert [i.kind for i in found.issues] == ["section_not_read", "requirement_in_skipped_section"]


def test_an_id_line_in_fenced_code_or_a_comment_is_not_a_requirement() -> None:
    found = _parse("""\
        #### Examples

        ```markdown
        - **ID**: `cpt-a-fr-in-backticks`
        ```

        ~~~
        - **ID**: `cpt-a-fr-in-tildes`
        ```
        - **ID**: `cpt-a-fr-still-in-tildes`
        ~~~

        <!-- - **ID**: `cpt-a-fr-in-comment` -->

        <!--
        - **ID**: `cpt-a-fr-in-long-comment`
        -->

        - **ID**: `cpt-a-fr-real`

        Real.
        """)
    assert found == {"cpt-a-fr-real": "Real."}


def test_code_and_comments_inside_a_statement_are_not_its_text() -> None:
    found = _parse("""\
        #### One

        - **ID**: `cpt-a-fr-one`

        The system MUST <!-- hidden note --> work
        and keep working. <!-- starts
        still hidden --> Visible tail.

        ```json
        {"example": true}
        ```

        Second paragraph.
        """)
    assert found == {
        "cpt-a-fr-one": "The system MUST  work and keep working. Visible tail.\n\nSecond paragraph."
    }


def test_a_heading_inside_fenced_code_does_not_end_a_statement() -> None:
    found = _parse("""\
        #### One

        - **ID**: `cpt-a-fr-one`

        Before.

        ```
        # not a heading
        ```

        After.
        """)
    assert found == {"cpt-a-fr-one": "Before.\n\nAfter."}


def test_an_empty_statement_is_an_error_but_kept() -> None:
    found = parse_markdown("#### One\n\n- **ID**: `cpt-a-fr-one`\n\n#### Two\n", "PRD.md")
    assert [(r.id, r.text) for r in found.requirements] == [("cpt-a-fr-one", "")]
    (issue,) = found.issues
    assert (issue.severity, issue.kind, issue.where) == ("error", "empty_text", "PRD.md:3")


@pytest.mark.parametrize(
    ("text", "level"),
    [
        ("The system **MUST** work.", "MUST"),
        ("The system MUST work.", "MUST"),
        ("The system **MUST NOT** leak.", "MUST NOT"),
        ("The system **MUST** not leak.", "MUST"),  # only capital NOT counts
        ("The system **MUST** **NOT** leak.", "MUST NOT"),  # bold words apart
        ("It SHALL  NOT fail.", "SHALL NOT"),
        ("It SHALL fail.", "SHALL"),
        ("It **SHOULD NOT** wait.", "SHOULD NOT"),
        ("It SHOULD wait, and MUST log.", "SHOULD"),  # the first keyword
        ("It MAY cache.", "MAY"),
        ("It must work.", None),  # lower case is prose
        ("Exports CSV files.", None),
        ("MUSTARD is not a keyword.", None),
    ],
)
def test_must_level(text: str, level: str | None) -> None:
    assert must_level(text) == level


def test_join_wrapped_keeps_lists_tables_and_quotes_on_their_own_lines() -> None:
    lines: list[str | None] = [
        "The system MUST:",
        "- do one",
        "  thing well",
        "1. then two",
        "",
        "| a | b |",
        "|---|---|",
        "> quoted",
        "  wrap",
        None,
        "last",
    ]
    assert join_wrapped(lines) == (
        "The system MUST:\n- do one thing well\n1. then two\n\n| a | b |\n|---|---|\n"
        "> quoted wrap\n\nlast"
    )


_WORD = st.text(alphabet="abcdefghijklmnopqrstuvwxyz", min_size=1, max_size=8)
_SLUG = st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=10)
_KEYWORD = st.sampled_from(["MUST", "MUST NOT", "SHALL", "SHOULD NOT", "MAY", None])


@st.composite
def _requirements(draw: st.DrawFn) -> list[tuple[str, str, str | None]]:
    """(ID, statement, keyword) for 1..8 requirements with distinct IDs."""
    slugs = draw(st.lists(_SLUG, min_size=1, max_size=8, unique=True))
    found = []
    for slug in slugs:
        kind = draw(st.sampled_from(["fr", "nfr"]))
        words = draw(st.lists(_WORD, min_size=1, max_size=40))
        keyword = draw(_KEYWORD)
        if keyword is not None:
            words.insert(draw(st.integers(0, len(words))), keyword)
        found.append((f"cpt-gen-{kind}-{slug}", " ".join(words), keyword))
    return found


@settings(max_examples=150, deadline=None)
@given(
    reqs=_requirements(),
    width=st.integers(min_value=20, max_value=120),
    level=st.integers(min_value=2, max_value=6),
    boxed=st.booleans(),
)
def test_generated_prds_round_trip(
    reqs: list[tuple[str, str, str | None]], width: int, level: int, boxed: bool
) -> None:
    """Every planted ID is found once, in order, with its statement and keyword intact."""
    parts = ["# PRD — Generated", ""]
    for number, (req_id, statement, _) in enumerate(reqs):
        box = "- [x] `p1` - " if boxed else ""
        parts += [f"{'#' * level} Requirement {number}", "", f"{box}**ID**: `{req_id}`", ""]
        parts += [*textwrap.wrap(statement, width), "", "**Rationale**: generated.", ""]
    found = parse_markdown("\n".join(parts), "gen.md").requirements
    assert [r.id for r in found] == [r[0] for r in reqs]
    assert [r.text for r in found] == [r[1] for r in reqs]
    assert [r.must_level for r in found] == [r[2] for r in reqs]
    assert [r.kind for r in found] == [r[0].split("-")[2] for r in reqs]


def test_a_sub_heading_with_no_content_before_the_next_id_is_not_kept() -> None:
    found = _parse("""\
        ### 5.1 Group

        - **ID**: `cpt-a-fr-group`

        Group text.

        #### Next requirement

        - **ID**: `cpt-a-fr-next`

        Next text.
        """)
    assert found == {"cpt-a-fr-group": "Group text.", "cpt-a-fr-next": "Next text."}


# --- the shared skip-region function and blank_hidden (T8 note §4.2) ----------------------------

SECTIONED = (
    "# T\n"  # 1
    "## 1. Scope\n"  # 2
    "text\n"  # 3
    "## 14. Traceability\n"  # 4
    "| a | b |\n"  # 5
    "### Sub\n"  # 6
    "x\n"  # 7
    "## 15. Next\n"  # 8
    "y\n"  # 9
    "## Dependencies (planned)\n"  # 10
    "last\n"  # 11
)


def test_skipped_sections_run_to_the_next_heading_at_the_same_or_a_higher_level() -> None:
    assert skipped_sections(SECTIONED) == (
        SkippedSection(start_line=4, end_line=7, level=2, title="14. Traceability"),
        SkippedSection(start_line=10, end_line=11, level=2, title="Dependencies (planned)"),
    )


def test_a_deeper_leak_heading_is_part_of_the_open_section_not_a_second_one() -> None:
    text = "## Traceability\n### Dependencies\nx\n## After\n"
    assert skipped_sections(text) == (SkippedSection(1, 3, 2, "Traceability"),)


def test_a_title_that_only_contains_the_word_is_not_a_skipped_section() -> None:
    assert skipped_sections("## Dependency resolution\nx\n## Traceability of changes\n") == ()


def test_a_heading_in_fenced_code_or_a_comment_starts_no_skipped_section() -> None:
    text = "```\n## Traceability\n```\n<!--\n## Dependencies\n-->\nplain\n"
    assert skipped_sections(text) == ()


def test_blank_hidden_keeps_every_offset() -> None:
    text = "# T\r\nkeep <!-- gone --> keep\r\n```\ncode\n```\n## Traceability\nsecret\n## End\nend"
    blanked = blank_hidden(text)
    assert len(blanked) == len(text)
    assert blanked.splitlines(keepends=True) == [
        "# T\r\n",
        "keep " + " " * len("<!-- gone -->") + " keep\r\n",
        "   \n",  # the fence
        "    \n",  # the code
        "   \n",  # the fence
        " " * len("## Traceability") + "\n",
        " " * len("secret") + "\n",
        "## End\n",
        "end",
    ]
    for i, (a, b) in enumerate(zip(text, blanked, strict=True)):
        assert b in (a, " "), f"offset {i} changed from {a!r} to {b!r}"


def test_blank_hidden_leaves_a_document_with_nothing_hidden_alone() -> None:
    text = "# Title\n\nUsers MUST log in.\n\n- one\n- two"
    assert blank_hidden(text) == text


@pytest.mark.parametrize("ending", ["\n", "\r\n", "\u2028"])
def test_blank_hidden_keeps_odd_line_endings(ending: str) -> None:
    text = f"a{ending}<!-- c -->{ending}b{ending}"
    assert blank_hidden(text) == f"a{ending}{' ' * len('<!-- c -->')}{ending}b{ending}"


_LINES = st.sampled_from(
    [
        "plain text",
        "## Traceability",
        "## Dependencies",
        "## Other",
        "### Deeper",
        "# Top",
        "```",
        "~~~",
        "<!-- open",
        "close -->",
        "a <!-- x --> b",
        "",
        "- **ID**: `cpt-x-fr-one`",
        "tab\there",
        "caf\u00e9 \u2014 na\u00efve",
    ]
)


@given(st.lists(_LINES, max_size=25), st.sampled_from(["\n", "\r\n"]), st.booleans())
@settings(max_examples=150, deadline=None)
def test_blank_hidden_property(lines: list[str], ending: str, trailing: bool) -> None:
    text = ending.join(lines) + (ending if trailing else "")
    blanked = blank_hidden(text)
    assert len(blanked) == len(text)
    assert [c in ("\n", "\r") for c in blanked] == [c in ("\n", "\r") for c in text]
    assert all(b in (a, " ") for a, b in zip(text, blanked, strict=True))
    # what is blanked is exactly what a reader does not read
    hidden = {n for n, line in visible_lines(text) if line is None}
    in_section = {n for s in skipped_sections(text) for n in range(s.start_line, s.end_line + 1)}
    for number, line in enumerate(blanked.splitlines(), start=1):
        if number in hidden or number in in_section:
            assert not line.strip()


_FIXTURE_MD = sorted(
    p for p in (Path(__file__).parent / "fixtures" / "spec").rglob("*.md") if p.name != "README.md"
)


@pytest.mark.parametrize("path", _FIXTURE_MD, ids=lambda p: p.parent.name + "/" + p.name)
def test_t2_and_the_shared_function_agree_on_every_real_document(path: Path) -> None:
    """A6: two readers of one document, one decision. T2's reader never reads a blanked line, and
    reads the same requirements from the blanked text; it reports exactly one `section_not_read`
    per shared section."""
    text = path.read_text(encoding="utf-8")
    sections = skipped_sections(text)
    parsed = parse_markdown(text, path.name)
    blanked = blank_hidden(text).splitlines()
    assert [i.kind for i in parsed.issues].count("section_not_read") == len(sections)
    for section in sections:
        assert all(
            not blanked[n - 1].strip() for n in range(section.start_line, section.end_line + 1)
        )
    for req in parsed.requirements:
        assert blanked[req.source.line - 1].strip(), f"{req.id}: its ID line is blanked"
    again = parse_markdown(blank_hidden(text), path.name)
    assert [(r.id, r.source.line) for r in again.requirements] == [
        (r.id, r.source.line) for r in parsed.requirements
    ]
