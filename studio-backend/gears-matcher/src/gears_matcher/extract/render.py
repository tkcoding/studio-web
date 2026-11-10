"""T8: the review sheet, a Markdown file the spec's author reads to say what was understood
(T8 note §4.8, §6). Every text from the spec or the model is escaped like the report's (T6 D9)."""

from gears_matcher.extract.models import Extraction
from gears_matcher.render.markdown import escape

TEXT_LIMIT = 1500  # characters of a requirement's text shown (the JSON keeps all of it)
EXAMPLES_SHOWN = 10


def render_review(extraction: Extraction, *, made_on: str, tool_version: str) -> str:
    report = extraction.report
    out = [
        "# Extraction review",
        "",
        "| | |",
        "|---|---|",
        f"| Model | {escape(report.model)}, extraction prompt {escape(report.prompt_version)} "
        "(not yet evaluated) |",
        f"| Made by | gears-match extract {escape(tool_version)} on {escape(made_on)} |",
        f"| Read | {report.chunks} chunks, {report.chunks_failed} not read; {report.calls} model "
        f"calls, {report.cache_hits} answered from the cache |",
        "",
        "An AI model chose these passages; the words are the spec's own, found in the document "
        "and never written by the model. Please say, per requirement, whether it was understood, "
        "and which of the passages left out were requirements.",
        "",
    ]
    if extraction.incomplete:
        out += ["> **Extraction incomplete**: " + _incomplete(extraction), ""]
    out += _documents(extraction)
    out += _requirements(extraction)
    out += _unclear(extraction)
    out += _left_out(extraction)
    out += _dropped(extraction)
    return "\n".join(out).rstrip() + "\n"


def _incomplete(extraction: Extraction) -> str:
    rows = [o for o in extraction.outcomes if o.incomplete]
    return "; ".join(f"{escape(o.path)}: {escape(o.reason)}" for o in rows)


def _documents(extraction: Extraction) -> list[str]:
    out = [
        "## Documents",
        "",
        "| Document | Requirements | Dropped | Merged | MUST/SHALL blocks not claimed "
        "| Other requirement-like blocks not claimed | Chunks not read | Complete |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for o in extraction.outcomes:
        strong = f"{o.unclaimed_strong} of {o.strong_blocks}"
        shaped = f"{o.unclaimed_blocks} of {o.shaped_blocks}"
        done = "no: " + escape(o.reason) if o.incomplete else "yes"
        out.append(
            f"| {escape(o.path)} | {o.kept} | {o.dropped} | {o.merged} | {strong} | {shaped} | "
            f"{o.chunks_failed} of {o.chunks} | {done} |"
        )
    return [*out, ""]


def _requirements(extraction: Extraction) -> list[str]:
    out = ["## Requirements found", ""]
    if not extraction.extracted:
        return [*out, "None.", ""]
    for item in extraction.extracted:
        req, ref = item.requirement, item.requirement.source
        lines = f"{ref.line}" if ref.end_line in (None, ref.line) else f"{ref.line}-{ref.end_line}"
        gears = (
            f" · names {', '.join(escape(g) for g in item.names_gear)}" if item.names_gear else ""
        )
        level = req.must_level or "no MUST/SHALL keyword"
        out += [
            f"### {escape(req.id)}: {escape(req.title)}",
            "",
            f"{escape(req.kind.upper())} (the model's reading) · {escape(level)} · "
            f"{escape(ref.path)}, line {lines}{gears}",
            "",
            escape(req.text, TEXT_LIMIT),
            "",
        ]
    return out


def _unclear(extraction: Extraction) -> list[str]:
    out = ["## To ask the author", ""]
    if not extraction.clarifications:
        return [*out, "Nothing.", ""]
    for c in extraction.clarifications:
        where = f"quoting: {escape(c.quote)}" if c.quote else "nothing in the text says"
        out.append(f"- **{escape(c.topic)}** ({escape(c.path)}; {where}): {escape(c.reason)}")
    return [*out, ""]


def _left_out(extraction: Extraction) -> list[str]:
    out = ["## Passages that look like requirements and were not taken", ""]
    shown = [(o.path, e) for o in extraction.outcomes for e in o.unclaimed_examples]
    if not shown:
        return [*out, "None.", ""]
    for path, text in shown[: EXAMPLES_SHOWN * max(1, len(extraction.outcomes))]:
        out.append(f"- {escape(path)}: {escape(text)}")
    return [*out, ""]


def _dropped(extraction: Extraction) -> list[str]:
    report = extraction.report
    out = ["## Dropped model items", ""]
    if not report.dropped_total:
        return [*out, "None.", ""]
    out.append(f"{report.dropped_total} dropped; the first {len(report.dropped)} are listed.")
    out.append("")
    out += [
        f"- {escape(d.path)} ({escape(d.kind)}): {escape(d.reason)}: {escape(d.item)}"
        for d in report.dropped
    ]
    return [*out, f"Errors: {len(report.errors)}" if report.errors else "", ""]
