"""Read CF requirements from one Markdown document (T2 design note §4).

A requirement starts at an ID line — `- [x] \\`p1\\` - **ID**: \\`cpt-…-fr-…\\`` (box and priority
optional) — and its statement runs to the next heading, the next ID line, or the first
`**Rationale**` / `**Actors**` / `**Threshold**` / `**Verification Method**` /
`**Architecture Allocation**` line. A heading deeper than the one the ID line sits under is part of
the statement (its title becomes a paragraph). FR vs NFR is the **first** `fr` / `nfr` segment of
the ID. Readiness — the `[x]` box and `**Status**:` lines — is dropped, as in T1.

Never read: sections whose heading *is* Traceability or Dependencies (they map requirements to the
gears that implement them — the answer), fenced code, and `<!-- … -->` comments (D10). A
requirement ID line inside such a section is an **error**, never a silent drop.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Literal

from gears_matcher.models import MustLevel, Requirement, SpecRef
from gears_matcher.spec.models import Issue

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")
_ID_LINE = re.compile(
    r"^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?(?:`(p\d+)`\s*[-\u2013\u2014:]?\s*)?"
    r"\*\*ID\*\*:\s*`(cpt-[A-Za-z0-9_.-]+)`"
)
_END = re.compile(
    r"^\s*(?:[-*+]\s+)?\*\*(?:Rationale|Actors?|Threshold|Verification Method|"
    r"Architecture Allocation)\*\*\s*:",
    re.IGNORECASE,
)
_STATUS = re.compile(r"^\s*(?:[-*+]\s+)?\*\*Status\*\*\s*:", re.IGNORECASE)
# A heading that *is* an answer-naming section: "Traceability" or "Dependencies", optionally
# numbered ("14. Traceability") or with a note in brackets. Not any title that contains the word:
# a requirement may be called "Dependency resolution" (TK's review of #27).
_LEAK = re.compile(
    r"^(?:\d+(?:\.\d+)*\.?\s+)?(?:traceability|dependenc(?:y|ies))\s*(?:\([^)]*\))?$",
    re.IGNORECASE,
)
_BLOCK_START = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s|\||>)")  # list item, table row, quote
_MUST = re.compile(r"\b(?:MUST|SHALL|SHOULD)(?:\s+NOT)?\b|\bMAY\b")
_PLANNED = re.compile(r"^\**Planned\.")
_MUST_LEVELS: dict[str, MustLevel] = {
    "MUST": "MUST",
    "MUST NOT": "MUST NOT",
    "SHALL": "SHALL",
    "SHALL NOT": "SHALL NOT",
    "SHOULD": "SHOULD",
    "SHOULD NOT": "SHOULD NOT",
    "MAY": "MAY",
}

_FIRST_SECTION_LEVEL = 2  # the `#` title is the document's, not part of a heading path
_NO_HEADING = 6  # an ID line above every heading: any heading ends its statement


@dataclass(frozen=True)
class MdParse:
    requirements: tuple[Requirement, ...]
    issues: tuple[Issue, ...]


def requirement_kind(req_id: str) -> Literal["fr", "nfr"] | None:
    """`fr` or `nfr` from the first such segment of the ID; None for other IDs (actors, ...)."""
    for segment in req_id.split("-"):
        if segment == "fr":
            return "fr"
        if segment == "nfr":
            return "nfr"
    return None


def heading_of(line: str) -> tuple[int, str] | None:
    """(level, title) when `line` is a Markdown heading, else None."""
    match = _HEADING.match(line)
    return None if match is None else (len(match.group(1)), match.group(2))


def must_level(text: str) -> MustLevel | None:
    """The first MUST / SHALL / SHOULD (optionally NOT) / MAY in `text`, bold or not."""
    match = _MUST.search(text.replace("*", ""))
    return None if match is None else _MUST_LEVELS[" ".join(match.group().split())]


def join_wrapped(lines: list[str | None]) -> str:
    """Blank-line separated paragraphs; hard-wrapped lines joined with one space.

    A list item, table row or quote starts a new line rather than joining the one above.
    `None` (a hidden line: fenced code or a comment) separates paragraphs like a blank line.
    """
    paragraphs: list[str] = []
    current: list[str] = []
    for line in [*lines, None]:
        if line is None or not line.strip():
            if current:
                paragraphs.append("\n".join(current))
                current = []
        elif current and not _BLOCK_START.match(line):
            current[-1] += " " + line.strip()
        else:
            current.append(line.strip())
    return "\n\n".join(paragraphs)


def _scan(text: str) -> Iterator[tuple[int, str, list[tuple[int, int]], bool]]:
    """(1-based line number, the line, its hidden character ranges, whether all of it is hidden).

    Hidden is fenced code and `<!-- … -->` comments (D10). One scan serves `visible_lines` (the
    text without them) and `blank_hidden` (the same text with them as spaces), so the two readers
    of a document can never disagree about what is hidden.
    """
    fence: str | None = None
    in_comment = False
    for number, line in enumerate(text.splitlines(), start=1):
        opener = _FENCE.match(line)
        if fence is not None or (opener is not None and not in_comment):
            if fence is None and opener is not None:
                fence = opener.group(1)
            elif opener is not None and opener.group(1) == fence:
                fence = None
            yield number, line, [(0, len(line))], True
            continue
        spans, in_comment = _comment_spans(line, in_comment)
        yield number, line, spans, bool(spans) and not _without(line, spans).strip()


def visible_lines(text: str) -> Iterator[tuple[int, str | None]]:
    """(1-based line number, line) with comments removed; None for a hidden line (D10)."""
    for number, line, spans, whole in _scan(text):
        yield number, None if whole else _without(line, spans)


def _comment_spans(line: str, in_comment: bool) -> tuple[list[tuple[int, int]], bool]:
    """The character ranges of `line` inside `<!-- … -->`, and whether a comment is still open.

    A range is always recorded for a line that starts inside an open comment, even an empty one,
    so "this line had comment in it" is `bool(spans)`.
    """
    spans: list[tuple[int, int]] = []
    pos = 0
    start = 0
    while True:
        if in_comment:
            end = line.find("-->", pos)
            if end < 0:
                spans.append((start, len(line)))
                return spans, True
            spans.append((start, end + 3))
            pos, in_comment = end + 3, False
        else:
            found = line.find("<!--", pos)
            if found < 0:
                return spans, False
            start, pos, in_comment = found, found + 4, True


def _without(line: str, spans: list[tuple[int, int]]) -> str:
    """`line` with the given character ranges cut out."""
    kept: list[str] = []
    pos = 0
    for start, end in spans:
        kept.append(line[pos:start])
        pos = end
    kept.append(line[pos:])
    return "".join(kept)


@dataclass(frozen=True)
class SkippedSection:
    """A never-read section (D4): a heading that *is* Traceability or Dependencies, with every
    deeper heading inside it, up to the line before the next heading at the same or a higher
    level."""

    start_line: int  # the heading's line
    end_line: int  # its last line, inclusive
    level: int
    title: str


def skipped_sections(text: str) -> tuple[SkippedSection, ...]:
    """The sections of `text` that name what implements the requirements, in document order.

    The one place that decides it: T2's reader asks it, and T8 blanks these lines before a model
    sees the document. A heading inside fenced code or a comment is not a heading.
    """
    sections: list[SkippedSection] = []
    current: tuple[int, int, str] | None = None  # start line, level, title
    last = 0
    for number, line in visible_lines(text):
        last = number
        heading = None if line is None else _HEADING.match(line)
        if heading is None:
            continue
        level, title = len(heading.group(1)), heading.group(2)
        if current is not None and level > current[1]:
            continue  # deeper than the open section: part of it
        if current is not None:
            sections.append(SkippedSection(current[0], number - 1, current[1], current[2]))
            current = None
        if _LEAK.match(title):
            current = (number, level, title)
    if current is not None:
        sections.append(SkippedSection(current[0], last, current[1], current[2]))
    return tuple(sections)


def blank_hidden(text: str) -> str:
    """`text` with everything a reader never reads replaced by spaces: fenced code, comments and
    the skipped sections. Same length, line endings kept, so a character offset in the result is
    the same offset in `text` (T8 note §4.2: the model sees the result, the code locates in `text`).
    """
    skipped = skipped_sections(text)
    out: list[str] = []
    for (number, line, spans, whole), raw in zip(
        _scan(text), text.splitlines(keepends=True), strict=True
    ):
        ending = raw[len(line) :]
        if whole or any(s.start_line <= number <= s.end_line for s in skipped):
            out.append(" " * len(line) + ending)
            continue
        chars = list(line)
        for start, end in spans:
            chars[start:end] = " " * (end - start)
        out.append("".join(chars) + ending)
    return "".join(out)


@dataclass
class _Block:
    """A requirement being read: its ID line, and the statement lines collected so far."""

    req_id: str
    kind: Literal["fr", "nfr"]
    priority: str | None
    line: int
    level: int  # of the heading the ID line sits under; a deeper heading is part of the statement
    title: str
    heading: str | None
    body: list[str | None] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)  # sub-heading titles, kept if content follows
    open: bool = True

    def add(self, line: str | None) -> None:
        if line is not None and line.strip():
            for title in self.pending:
                self.body.extend([None, title, None])
            self.pending.clear()
        self.body.append(line)


@dataclass
class _Reader:
    path: str
    sections: dict[int, SkippedSection]  # by start line, from `skipped_sections`
    headings: list[tuple[int, str]] = field(default_factory=list)
    skip_level: int | None = None  # inside a never-read section at this heading level
    skip_end: int = 0  # that section's last line
    skip_where: str = ""  # that section's heading, for the error below
    skipped_ids: list[str] = field(default_factory=list)  # requirement IDs inside it
    block: _Block | None = None
    requirements: list[Requirement] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    def feed(self, number: int, line: str | None) -> None:
        if self.skip_level is not None and number > self.skip_end:
            self._end_skip()  # the line after a never-read section is the heading that ends it
        heading = None if line is None else _HEADING.match(line)
        if heading is not None:
            self._heading(number, len(heading.group(1)), heading.group(2))
        elif self.skip_level is not None:
            id_line = None if line is None else _ID_LINE.match(line)
            if id_line is not None and requirement_kind(id_line.group(2)) is not None:
                self.skipped_ids.append(id_line.group(2))
            return
        elif line is not None and (id_line := _ID_LINE.match(line)) is not None:
            self._start(number, id_line.group(2), id_line.group(1))
        elif self.block is not None and self.block.open:
            if line is not None and _END.match(line):
                self.block.open = False
            else:
                self.block.add(None if line is not None and _STATUS.match(line) else line)

    def finish(self) -> MdParse:
        self._close()
        self._end_skip()
        return MdParse(tuple(self.requirements), tuple(self.issues))

    def _heading(self, number: int, level: int, title: str) -> None:
        if self.skip_level is not None:
            return  # a deeper heading inside a never-read section
        if self.block is not None and level > self.block.level and number not in self.sections:
            if self.block.open:
                self.block.pending.append(title)
        else:
            self._close()
        while self.headings and self.headings[-1][0] >= level:
            self.headings.pop()
        self.headings.append((level, title))
        section = self.sections.get(number)
        if section is not None:
            self.skip_level = level
            self.skip_end = section.end_line
            self.skip_where = f"`{title}` ({self.path}:{number})"
            self.issues.append(
                Issue(
                    severity="info",
                    kind="section_not_read",
                    message=f"`{title}` names what implements the requirements — not read",
                    where=f"{self.path}:{number}",
                )
            )

    def _end_skip(self) -> None:
        """Leave a never-read section; requirement IDs found inside it are an error (fail loud)."""
        if self.skip_level is not None and self.skipped_ids:
            ids = ", ".join(self.skipped_ids)
            self.issues.append(
                Issue(
                    severity="error",
                    kind="requirement_in_skipped_section",
                    message=f"{len(self.skipped_ids)} requirement ID(s) inside {self.skip_where}, "
                    f"which is never read, so not extracted: {ids}",
                    where=self.skip_where,
                )
            )
        self.skip_level = None
        self.skipped_ids = []

    def _start(self, number: int, req_id: str, priority: str | None) -> None:
        self._close()
        kind = requirement_kind(req_id)
        if kind is None:
            return
        path = [t for level, t in self.headings if level >= _FIRST_SECTION_LEVEL]
        level, title = self.headings[-1] if self.headings else (_NO_HEADING, req_id)
        self.block = _Block(req_id, kind, priority, number, level, title, " > ".join(path) or None)

    def _close(self) -> None:
        block, self.block = self.block, None
        if block is None:
            return
        text = join_wrapped(block.body)
        where = f"{self.path}:{block.line}"
        if not text:
            self.issues.append(
                Issue(
                    severity="error",
                    kind="empty_text",
                    message=f"{block.req_id} has no statement",
                    where=where,
                )
            )
        self.requirements.append(
            Requirement(
                id=block.req_id,
                title=block.title,
                text=text,
                kind=block.kind,
                must_level=must_level(text),
                priority=block.priority,
                planned=_PLANNED.match(text) is not None,
                source=SpecRef(path=self.path, line=block.line, heading=block.heading),
            )
        )


def parse_markdown(text: str, path: str) -> MdParse:
    """Every CF requirement defined in `text`, in document order, plus the issues found."""
    reader = _Reader(path, {s.start_line: s for s in skipped_sections(text)})
    for number, line in visible_lines(text):
        reader.feed(number, line)
    return reader.finish()
