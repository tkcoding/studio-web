"""T6: the Markdown report a spec owner reads (T6 note D6, D9, D10).

`render` is a pure function of the report, the spec and the catalogue: no clock, no I/O. The date
is passed in, so the same inputs give the same text. Every text that comes from the spec, the
catalogue or the judge is escaped (`escape`): it can neither break a table nor inject a link, an
image or HTML.
"""

import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.report import DEFAULT_TAU
from gears_matcher.report.models import (
    Coverage,
    CoverageCounts,
    CoverageReport,
    GearMatch,
    GearUse,
    RequirementCoverage,
)
from gears_matcher.spec.models import InputDoc, Spec

CELL_LIMIT = 300  # characters per table cell; the JSON keeps the full text
FOR_SHOWN = 5  # requirement titles listed per gear in the gear tables; the JSON keeps every one
TITLE_LIMIT = 50  # characters per title in that list
NO_CANDIDATE = "no candidate gear"  # T5's reason for an empty shortlist (T5 D2)
NONE_SHOWN = chr(0x2013)  # an en dash: the cell has no value

_LABEL: dict[Coverage, str] = {
    "covered": "covered",
    "partial": "partial",
    "gap": "gap",
    "clarification_needed": "clarification needed",
    "not_assessed": "not assessed",
}
_ORDER: tuple[Coverage, ...] = ("covered", "partial", "gap", "clarification_needed", "not_assessed")
# Markdown characters that start a link, an image, emphasis, code, maths or a table cell. `<`,
# `>` and `@` become entities, so no raw HTML reaches a renderer and an address cannot become a
# `mailto:` link (D9).
_ESCAPED = {
    "\\": "\\\\",
    "|": "\\|",
    "`": "\\`",
    "*": "\\*",
    "_": "\\_",
    "[": "\\[",
    "]": "\\]",
    "$": "\\$",
    "<": "&lt;",
    ">": "&gt;",
    "@": "&#64;",
}
# Format characters that writing needs: the zero-width non-joiner and joiner (Persian, Indic
# scripts, emoji sequences). Every other control or format character, including bidirectional
# overrides, is removed.
_KEPT_FORMAT = frozenset({"\u200c", "\u200d"})
# What GitHub turns into a link without brackets: a scheme's `://`, or `www.` at a word start.
_AUTOLINK = re.compile(r"://|\bwww\.", re.IGNORECASE)
# What starts a heading or a list when it begins a line: `#`, `-` or `+` (escaped in front), and
# `12.` or `12)` (escaped after the number, the only escape Markdown reads there).
_MARKER = re.compile(r"#|[-+](\s|$)")
_NUMBERED = re.compile(r"^(\d+)([.)])(?=\s|$)")


def plain(text: str) -> str:
    """Untrusted text as one line for people: control and format characters (an escape sequence,
    a bidirectional override) become spaces, except the joiners writing needs (`_KEPT_FORMAT`),
    and whitespace runs one space (CONTRIBUTING A3)."""
    shown = "".join(
        " " if unicodedata.category(ch).startswith("C") and ch not in _KEPT_FORMAT else ch
        for ch in text
    )
    return " ".join(shown.split())


def escape(text: str, limit: int = CELL_LIMIT) -> str:
    """Untrusted text as one safe Markdown line, cut at `limit` characters (D9).

    Besides the characters in `_ESCAPED`: a bare address (`https://…`, `www.…`) is broken so a
    renderer cannot make it a link, and a leading `#`, `-`, `+` or `1.` is escaped so the text
    cannot start a heading or a list where it begins a line.
    """
    line = plain(text)
    if len(line) > limit:
        line = line[: limit - 1] + "…"
    out = "".join(_ESCAPED.get(ch, ch) for ch in line)
    out = _AUTOLINK.sub(lambda m: m.group(0).replace(":", "&#58;").replace(".", "&#46;"), out)
    out = _NUMBERED.sub(r"\1\\\2", out, count=1)
    return "\\" + out if _MARKER.match(out) else out


def judge_label(judge: str) -> str:
    """The judge in words, so nobody mistakes the stub's verdicts for answers (D7)."""
    return "stub judge (word matching, for tests)" if judge == "stub" else judge


@dataclass(frozen=True)
class RunInfo:
    """What the header says about this run that the report does not hold."""

    spec_path: str  # as the user gave it
    made_on: str  # the date, YYYY-MM-DD (D10: passed in, so tests fix it)
    tool_version: str


def render(report: CoverageReport, spec: Spec, catalogue: Catalogue, run: RunInfo) -> str:
    """The whole report: header, summary, gears to use, requirements, gaps, the rest, inputs."""
    titles = {r.id: r.title for r in spec.requirements}
    names = display_names(catalogue)
    rows = report.requirements
    parts = [
        _header(report, spec, catalogue, run),
        _incomplete(report),
        _summary(report),
        _gears(report, titles, names),
        _requirements("Functional requirements", _of(rows, "fr"), titles, names),
        _requirements("Non-functional requirements", _of(rows, "nfr"), titles, names),
        _gaps(rows, titles),
        _listed("Clarification needed", "clarification_needed", rows, titles),
        _listed("Not assessed", "not_assessed", rows, titles),
        _clarifications(report),
        _inputs(report),
    ]
    return "\n\n".join(part for part in parts if part) + "\n"


def display_names(catalogue: Catalogue) -> dict[str, str]:
    """Each Gear's name, with its id in brackets when another Gear's name reads the same ("Events
    Broker" and "Event Broker" at the pinned commit), so a reader can tell them apart."""
    count = Counter(_name_key(g.name) for g in catalogue.gears)
    return {
        g.id: f"{g.name} ({g.id.split('/', 1)[-1]})" if count[_name_key(g.name)] > 1 else g.name
        for g in catalogue.gears
    }


def _name_key(name: str) -> tuple[str, ...]:
    """A name as it reads: case, punctuation and a plural "s" ignored."""
    words = re.findall(r"[a-z0-9]+", name.casefold())
    return tuple(w[:-1] if len(w) > _SHORT_WORD and w.endswith("s") else w for w in words)


_SHORT_WORD = 3  # "bus", "gas": too short to be a plural


def _of(rows: Sequence[RequirementCoverage], kind: str) -> list[RequirementCoverage]:
    return [r for r in rows if r.kind == kind]


def _header(report: CoverageReport, spec: Spec, catalogue: Catalogue, run: RunInfo) -> str:
    p = report.provenance
    where = (
        f"{escape(p.spec_repository)} at `{p.spec_commit[:7]}`"
        if p.spec_repository and p.spec_commit
        else "not in git"
    )
    md = (p.gears_md_commit or "unknown")[:7]
    gdl = _gdl_label(p.gear_gdl_commit)
    return "\n".join(
        [
            f"# Gears Matcher report: {escape(spec.name)}",
            "",
            "| | |",
            "|---|---|",
            f"| Spec | {escape(run.spec_path)} ({where}) |",
            f"| Catalogue | GEARS.md `{md}` · gear.gdl `{gdl}` · {len(catalogue.gears)} gears |",
            f"| Judge | {escape(judge_label(p.judge))} · {escape(p.shortlist)} · τ = {p.tau:g}"
            f"{_TAU_NOTE if p.tau == DEFAULT_TAU else ''} |",
            *_extraction_row(p.extraction),
            f"| Made by | gears-match {escape(run.tool_version)} on {escape(run.made_on)} |",
        ]
    )


def _gdl_label(commit: str | None) -> str:
    """The gear.gdl commit, and the bundle's digest when a bundle replaced some descriptions."""
    base, plus, bundle = (commit or "unknown").partition("+bundle-")
    return f"{base[:7]}` + bundle `{bundle[:7]}" if plus else base[:7]


def _summary(report: CoverageReport) -> str:
    head = "| | " + " | ".join(_LABEL[c] for c in _ORDER) + " |"
    lines = ["## Summary", "", head, "|---" * (len(_ORDER) + 1) + "|"]
    for label, counts in (("Functional", report.totals.fr), ("Non-functional", report.totals.nfr)):
        lines.append(f"| {label} ({counts.total()}) | {_counts(counts)} |")
    return "\n".join(lines)


def _counts(counts: CoverageCounts) -> str:
    return " | ".join(str(getattr(counts, c)) for c in _ORDER)


def _gears(report: CoverageReport, titles: dict[str, str], names: dict[str, str]) -> str:
    lines = ["## Gears to use", ""]
    if report.recommended_gears:
        lines += _gear_table(report.recommended_gears, titles, names)
    else:
        lines.append(
            f"No gear reached τ = {report.provenance.tau:g}, so none is recommended. "
            "The gears that help are listed below, under *Also possible*."
        )
    if report.also_possible:
        lines += ["", "### Also possible", ""]
        lines += _gear_table(report.also_possible, titles, names)
    if report.future_parts:
        lines += ["", "### Future parts in demand", ""]
        lines += ["Gears that fit but have no code yet, the most needed first.", ""]
        lines += ["| Gear | Needed by | For |", "|---|---|---|"]
        for u in report.future_parts:
            n = len(u.requirement_ids)
            needed = f"{n} requirement{'s' if n != 1 else ''}"
            name = escape(names.get(u.gear_id, u.name))
            lines.append(f"| {name} | {needed} | {_serves(u.requirement_ids, titles)} |")
    return "\n".join(lines)


_TAU_NOTE = " (the default, not yet calibrated: T10)"


def _serves(ids: Sequence[str], titles: dict[str, str]) -> str:
    """The requirements a gear serves, for a table cell: a count when there are several, the first
    `FOR_SHOWN` titles and how many more, never a list cut off mid-title (TK, #52)."""
    if not ids:
        return NONE_SHOWN
    one = len(ids) == 1  # a lone title has the whole cell, not the share of a list
    names = [escape(titles.get(r, r), CELL_LIMIT if one else TITLE_LIMIT) for r in ids[:FOR_SHOWN]]
    more = len(ids) - FOR_SHOWN
    listed = ", ".join(names) + (f", +{more} more" if more > 0 else "")
    return listed if one else f"{len(ids)} requirements: {listed}"


def _gear_table(
    uses: Sequence[GearUse], titles: dict[str, str], names: dict[str, str]
) -> list[str]:
    lines = ["| Gear | Confidence | Status | For |", "|---|---|---|---|"]
    for u in uses:
        status = "in code" if u.in_code else "no code yet"
        serves = _serves(u.requirement_ids, titles)
        name = escape(names.get(u.gear_id, u.name))
        lines.append(f"| {name} | {u.confidence:.2f} | {status} | {serves} |")
    return lines


def _requirements(
    heading: str, rows: list[RequirementCoverage], titles: dict[str, str], names: dict[str, str]
) -> str:
    if not rows:
        return ""
    lines = [
        f"## {heading}",
        "",
        "| Requirement | Coverage | Gear | Conf. | Evidence | Gives / still to build |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        chosen = next((g for g in r.gears if g.role == "chosen"), None)
        title = escape(titles.get(r.requirement_id, r.requirement_id))
        if r.planned:
            title += " *(planned)*"
        if r.extracted:
            title += " *(extracted)*"
        label = _LABEL[r.coverage] + (" *(low confidence)*" if r.low_confidence else "")
        gear = escape(names.get(chosen.gear_id, chosen.gear_id)) if chosen else NONE_SHOWN
        conf = f"{r.confidence:.2f}" if r.confidence is not None else NONE_SHOWN
        evidence = f"“{escape(chosen.evidence)}”" if chosen and chosen.evidence else NONE_SHOWN
        lines.append(f"| {title} | {label} | {gear} | {conf} | {evidence} | {_detail(r, chosen)} |")
    return "\n".join(lines)


def _detail(r: RequirementCoverage, chosen: GearMatch | None) -> str:
    if chosen is None:
        return escape(r.reason)
    parts = []
    if r.gear_provides:
        parts.append(f"gives: {escape(r.gear_provides)}")
    if r.remaining_work:
        parts.append(f"to build: {escape(r.remaining_work)}")
    helping = sum(g.role == "alternative" for g in r.gears)
    if helping:
        parts.append(f"+ {helping} other gear{'s' if helping != 1 else ''} help")
    return " · ".join(parts) or NONE_SHOWN


def _gaps(rows: Sequence[RequirementCoverage], titles: dict[str, str]) -> str:
    gaps = [r for r in rows if r.coverage == "gap"]
    if not gaps:
        return ""
    none_found = [r for r in gaps if r.reason == NO_CANDIDATE]
    judged_none = [r for r in gaps if r.reason != NO_CANDIDATE]
    lines = ["## Gaps", ""]
    for heading, group in (
        ("No candidate gear (search found none)", none_found),
        ("Every candidate judged none", judged_none),
    ):
        if group:
            lines += [f"### {heading}", ""]
            lines += [f"- {escape(titles.get(r.requirement_id, r.requirement_id))}" for r in group]
            lines.append("")
    return "\n".join(lines).rstrip()


def _listed(
    heading: str, coverage: Coverage, rows: Sequence[RequirementCoverage], titles: dict[str, str]
) -> str:
    picked = [r for r in rows if r.coverage == coverage]
    if not picked:
        return ""
    lines = [f"## {heading}", ""]
    for r in picked:
        title = escape(titles.get(r.requirement_id, r.requirement_id))
        lines.append(f"- **{title}**: {escape(r.reason)}")
    return "\n".join(lines)


def _extraction_row(extraction: str | None) -> list[str]:
    if extraction is None:
        return []
    return [
        f"| Extraction | {escape(extraction)}: requirements marked *(extracted)* were chosen by an "
        "AI model from free-form text; their words are the spec's own |"
    ]


def _incomplete(report: CoverageReport) -> str:
    """The banner: a partial list must never look complete (T8 note D15)."""
    rows = [d for d in report.inputs if d.extraction is not None and d.extraction.incomplete]
    if not rows:
        return ""
    why = "; ".join(
        f"{escape(d.path)}: {escape(d.extraction.reason if d.extraction else '')}" for d in rows
    )
    return f"> **Extraction incomplete**: some requirements may be missing. {why}"


def _clarifications(report: CoverageReport) -> str:
    """The spec-level topics to ask the author about (#65)."""
    if not report.clarifications:
        return ""
    lines = ["## To ask the author", ""]
    for c in report.clarifications:
        where = f"quoting: {escape(c.quote)}" if c.quote else "nothing in the text says"
        lines.append(f"- **{escape(c.topic)}** ({escape(c.path)}; {where}): {escape(c.reason)}")
    return "\n".join(lines)


def _inputs(report: CoverageReport) -> str:
    extracted = any(doc.extraction is not None for doc in report.inputs)
    head = "| Document | Status | Requirements | Reason |" + (" Extraction |" if extracted else "")
    lines = ["## Inputs", "", head, "|---" * (5 if extracted else 4) + "|"]
    for doc in report.inputs:
        reason = escape(doc.reason) if doc.reason else NONE_SHOWN
        row = f"| {escape(doc.path)} | {doc.status} | {doc.requirements} | {reason} |"
        if extracted:
            row += f" {_extraction_cell(doc)} |"
        lines.append(row)
    return "\n".join(lines)


def _extraction_cell(doc: InputDoc) -> str:
    e = doc.extraction
    if e is None:
        return NONE_SHOWN
    parts = [f"kept {e.kept}", f"dropped {e.dropped}", f"merged {e.merged}"]
    parts.append(f"{e.unclaimed_strong} of {e.strong_blocks} MUST/SHALL blocks not claimed")
    parts.append(f"{e.chunks_failed} of {e.chunks} chunks not read")
    cell = ", ".join(parts)
    return escape(cell + ("; incomplete: " + e.reason if e.incomplete else ""), CELL_LIMIT * 2)
