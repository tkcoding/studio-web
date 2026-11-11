"""T8: the extractor (T8 note §4, D3 to D15).

`Extractor.extract(documents)` reads documents T2 handed over and returns requirements whose words
are the spec's own: the model only quotes, and the code finds the quote, cuts the block it sits in,
and derives everything else. A chunk that fails is counted and named, never skipped quietly; a
document with a failed chunk, or with too many requirement-shaped blocks nobody claimed, is
`incomplete`. Nothing here calls a provider directly: the model is a `ModelClient`, as for the
judge.
"""

import bisect
import hashlib
import json
import math
import time
from collections import Counter
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from itertools import accumulate
from pathlib import Path

from pydantic import ValidationError

from gears_matcher.extract.blocks import (
    CHUNK_CHARS,
    Block,
    Chunk,
    Heading,
    block_at,
    find_blocks,
    headings,
    make_chunks,
    split_chunk,
)
from gears_matcher.extract.derive import (
    hash_id,
    heading_path,
    make_title,
    names_gear,
    spec_id,
)
from gears_matcher.extract.locate import Projection, occurrences, project, quote_problem
from gears_matcher.extract.models import (
    Clarification,
    DocumentOutcome,
    Dropped,
    Extracted,
    Extraction,
    ExtractionReport,
    ExtractItem,
    ExtractReply,
    Span,
    UnclearItem,
)
from gears_matcher.extract.prompt import (
    EXTRACT_PROMPT_VERSION,
    Prompt,
    build_prompt,
    repair_prompt,
    unescape_quote,
)
from gears_matcher.extract.tripwire import (
    UNCLAIMED_LIMIT,
    shaped_blocks,
    strong_blocks,
    unclaimed,
)
from gears_matcher.judge.llm.cache import CacheError, ResponseCache
from gears_matcher.judge.llm.errors import ClientError, ReplyCutOffError
from gears_matcher.judge.llm.judge import SDK_RETRIES
from gears_matcher.judge.llm.schema import ModelClient
from gears_matcher.models import Gear, Issue, Requirement, SpecRef
from gears_matcher.render.markdown import plain
from gears_matcher.spec.markdown import blank_hidden, join_wrapped, must_level
from gears_matcher.spec.models import Document

EXTRACT_BUDGET_S = 240.0  # per chunk: an extraction reply is far longer than a judgement (D1)
REPAIR_MIN_S = 10.0  # a repair call needs at least this much of the chunk's budget left
SUGGESTED_ALLOWANCE = 1.5  # a suggested bound leaves room for repairs, splits and second asks
MAX_BLOCK = 12_000  # characters of a block that may become a requirement (D9)
MAX_PER_DOCUMENT = 400
UNCLEAR_PER_CHUNK = 20
UNCLEAR_PER_RUN = 50
TOPIC_LIMIT = 120
REASON_LIMIT = 300
DROPPED_KEPT = 100  # entries kept in the report; `dropped_total` counts them all
ITEM_SHOWN = 200  # characters of a dropped item kept
UNCLAIMED_SHOWN = 10  # unclaimed blocks quoted on the review sheet
MESSAGE_LIMIT = 300


def _now() -> float:
    """The clock for the per-chunk budget; tests replace it."""
    return time.monotonic()


class ExtractError(Exception):
    """A chunk could not be read; the message says why and never holds a key."""


class BoundHit(ExtractError):  # noqa: N818 -- reads as the event, like `BudgetExceeded`
    """The call bound was reached before the chunk could be asked."""


@dataclass(frozen=True)
class ExtractPlan:
    """What a run would do, sending nothing (D2). The cache folder exists once an Extractor does."""

    documents: int
    chunks: int
    cached: int
    misses: int
    suggested_max_calls: int


@dataclass(frozen=True)
class _Layout:
    """A document laid out once: the text a model may see, and where everything in it is."""

    doc: Document
    blanked: str
    projection: Projection
    blocks: tuple[Block, ...]
    headings: tuple[Heading, ...]
    chunks: tuple[Chunk, ...]
    shaped: tuple[Block, ...]
    line_starts: tuple[int, ...]

    def line_of(self, offset: int) -> int:
        return bisect.bisect_right(self.line_starts, offset)

    def lines(self, chunk: Chunk) -> str:
        return f"lines {self.line_of(chunk.start)}-{self.line_of(max(chunk.start, chunk.end - 1))}"


@dataclass(frozen=True)
class _Draft:
    block: Block  # the first block: where the quote is
    quote: str
    kind: str
    proposed_id: str | None
    end: int  # where the statement ends: the block's end, or the end of the block `end_quote` is in


@dataclass
class _Run:
    """One document being read."""

    layout: _Layout
    drafts: dict[int, _Draft] = field(default_factory=dict)  # by block start
    merged: int = 0
    dropped: int = 0
    failed_roots: set[int] = field(default_factory=set)  # original chunks not fully read
    capped: bool = False
    ends: dict[int, int] | None = None  # block start -> where its statement finally ends

    @property
    def chunks_failed(self) -> int:
        return len(self.failed_roots)


@dataclass(frozen=True)
class _Answer:
    reply: ExtractReply
    text: str  # the raw reply, for the cache
    tokens: tuple[int, int]
    from_cache: bool
    bad: tuple[tuple[str, str], ...]  # (reason, item) the reply held that could not be read


class Extractor:
    """Implements T8's extraction behind a `ModelClient`, a disk cache and a call bound."""

    def __init__(  # noqa: PLR0913 -- every one is a setting a caller chooses
        self,
        client: ModelClient,
        cache_dir: Path,
        *,
        model: str,
        max_calls: int,
        budget_s: float = EXTRACT_BUDGET_S,
        chunk_chars: int = CHUNK_CHARS,
        gears: Sequence[Gear] = (),
        existing_ids: Collection[str] = (),
    ) -> None:
        if max_calls < 1:
            raise ValueError(f"max_calls must be at least 1, got {max_calls!r}")
        if not (math.isfinite(budget_s) and budget_s > 0):
            raise ValueError(f"budget_s must be a positive number of seconds, got {budget_s!r}")
        if chunk_chars < 1:
            raise ValueError(f"chunk_chars must be at least 1, got {chunk_chars!r}")
        self._client = client
        self._cache = ResponseCache(cache_dir / "extract")
        self._model = model
        self._max_calls = max_calls
        self._budget_s = budget_s
        self._chunk_chars = chunk_chars
        self._gears = tuple(gears)
        self._taken = set(existing_ids)
        self._schema = ExtractReply.model_json_schema()
        self._schema_hash = hashlib.sha256(
            json.dumps(self._schema, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self._used = False
        self._calls = self._hits = 0
        self._tokens = [0, 0]
        self._unclear_seen = 0
        self._dropped: list[Dropped] = []
        self._dropped_total = 0
        self._issues: list[Issue] = []
        self._clarifications: list[Clarification] = []

    # --- planning ------------------------------------------------------------------------

    def plan(self, documents: Sequence[Document]) -> ExtractPlan:
        """How many chunks a run would ask about and how many the cache already holds."""
        chunks = cached = 0
        for doc in sorted(documents, key=lambda d: d.path):
            layout = self._layout(doc)
            for chunk in layout.chunks:
                chunks += 1
                key = self._key(build_prompt(layout.blanked[chunk.start : chunk.end]))
                cached += self._cache.path(key).is_file()
        misses = chunks - cached
        return ExtractPlan(
            documents=len(documents),
            chunks=chunks,
            cached=cached,
            misses=misses,
            suggested_max_calls=math.ceil(misses * SUGGESTED_ALLOWANCE),
        )

    # --- extraction ----------------------------------------------------------------------

    def extract(self, documents: Sequence[Document]) -> Extraction:
        """Read the documents. One run per `Extractor`: its counts and issues are the run's."""
        if self._used:
            raise RuntimeError("an Extractor makes one run; make another for the next")
        self._used = True
        extracted: list[Extracted] = []
        outcomes: list[DocumentOutcome] = []
        chunk_total = failed_total = unclaimed_total = 0
        for doc in sorted(documents, key=lambda d: d.path):
            layout = self._layout(doc)
            run = _Run(layout)
            for chunk in layout.chunks:
                self._chunk(run, chunk, depth=0)
            found = self._build(run)
            outcome = self._outcome(run, found)
            extracted += found
            outcomes.append(outcome)
            chunk_total += outcome.chunks
            failed_total += outcome.chunks_failed
            unclaimed_total += outcome.unclaimed_blocks
        extracted = self._unique_ids(extracted)
        report = ExtractionReport(
            model=self._model,
            prompt_version=EXTRACT_PROMPT_VERSION,
            chunks=chunk_total,
            chunks_failed=failed_total,
            cache_hits=self._hits,
            calls=self._calls,
            input_tokens=self._tokens[0],
            output_tokens=self._tokens[1],
            dropped=tuple(self._dropped),
            dropped_total=self._dropped_total,
            unclaimed_blocks=unclaimed_total,
            issues=tuple(self._issues),
        )
        return Extraction(
            extracted=tuple(extracted),
            clarifications=tuple(self._clarifications),
            outcomes=tuple(outcomes),
            report=report,
        )

    def _layout(self, doc: Document) -> _Layout:
        blanked = blank_hidden(doc.text)
        blocks = find_blocks(blanked)
        heads = headings(blanked)
        starts = [0, *accumulate(len(x) for x in blanked.splitlines(keepends=True))][:-1] or [0]
        return _Layout(
            doc=doc,
            blanked=blanked,
            projection=project(blanked),
            blocks=blocks,
            headings=heads,
            chunks=make_chunks(blanked, blocks, self._chunk_chars),
            shaped=shaped_blocks(blanked, blocks, heads),
            line_starts=tuple(starts),
        )

    # --- one chunk -----------------------------------------------------------------------

    def _chunk(self, run: _Run, chunk: Chunk, depth: int, root: int | None = None) -> None:
        root = chunk.start if root is None else root  # the original chunk a half belongs to
        layout = run.layout
        text = layout.blanked[chunk.start : chunk.end]
        shaped = [b for b in layout.shaped if chunk.start <= b.start < chunk.end]
        try:
            answer = self._answer(text, use_cache=True)
            before = len(run.drafts)
            self._apply(run, chunk, answer)
            asked_again = False
            fresh = not answer.from_cache  # a cached answer is final: it was confirmed when saved
            if fresh and len(run.drafts) == before and shaped:  # nothing, in a chunk with some
                answer = self._answer(text, use_cache=False)  # D10: ask once more
                asked_again = True
                self._apply(run, chunk, answer)
            kept = len(run.drafts) - before
            # D13: a reply is kept when it gave something, or was confirmed by a second ask, or
            # was empty in a chunk with nothing requirement-shaped. A first answer of only dropped
            # items is not kept: it is asked again next run instead of replayed for good.
            quiet = not answer.reply.items and not shaped
            if not answer.from_cache and (kept > 0 or asked_again or quiet):
                self._save(text, answer)
        except ReplyCutOffError as exc:  # D15: the same prompt would be cut off again: split it
            parts = split_chunk(chunk, layout.blocks) if depth == 0 else None
            if parts is None:
                self._failed(run, chunk, f"the reply was cut off at its token limit ({exc})", root)
                return
            for part in parts:
                self._chunk(run, part, depth=1, root=root)
        except (ExtractError, ClientError, TimeoutError, CacheError) as exc:
            self._failed(run, chunk, str(exc), root)

    def _failed(self, run: _Run, chunk: Chunk, why: str, root: int) -> None:
        run.failed_roots.add(root)  # a chunk split in two that fails twice is one chunk not read
        where = f"{run.layout.doc.path}, {run.layout.lines(chunk)}"
        self._issues.append(
            Issue(
                severity="error",
                kind="chunk_failed",
                message=f"not read: {plain(why)[:MESSAGE_LIMIT]}",
                where=where,
            )
        )

    # --- asking, with the cache, one repair, and the call bound -------------------------------

    def _key(self, prompt: Prompt) -> str:
        parts = [self._model, EXTRACT_PROMPT_VERSION, self._schema_hash, prompt.system, prompt.user]
        return hashlib.sha256(
            json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()

    def _answer(self, text: str, *, use_cache: bool) -> _Answer:
        prompt = build_prompt(text)
        key = self._key(prompt)
        if use_cache:
            entry = self._cache.get(key)  # a bad entry raises `CacheEntryError`: that chunk fails
            if entry is not None:
                parsed = _parse(entry.reply_text)
                if parsed.problem is not None:
                    name = self._cache.path(key).name
                    raise ExtractError(f"cache entry {name}: {parsed.problem}")
                self._hits += 1
                return _Answer(
                    parsed.reply,
                    entry.reply_text,
                    (entry.input_tokens, entry.output_tokens),
                    True,
                    parsed.bad,
                )
        deadline = _now() + self._budget_s
        tokens = [0, 0]
        raw = self._request(prompt, deadline, tokens)
        parsed = _parse(raw)
        if parsed.problem is not None and deadline - _now() >= REPAIR_MIN_S:
            try:
                again = self._request(repair_prompt(prompt, parsed.problem), deadline, tokens)
            except (ClientError, TimeoutError, BoundHit):
                again = None  # the repair itself failed: the first reply's problem stands
            if again is not None:
                second = _parse(again)
                if second.problem is None:
                    raw, parsed = again, second
        if parsed.problem is not None:
            raise ExtractError(f"unusable reply: {parsed.problem}")
        return _Answer(parsed.reply, raw, (tokens[0], tokens[1]), False, parsed.bad)

    def _request(self, prompt: Prompt, deadline: float, tokens: list[int]) -> str:
        remaining = deadline - _now()
        if remaining <= 0:  # no request is sent, so none is counted
            raise TimeoutError(f"the {self._budget_s:g} s budget for this chunk is used up")
        if self._calls >= self._max_calls:
            raise BoundHit(f"the call bound of {self._max_calls} is reached")
        self._calls += 1
        output = self._client.complete(
            system=prompt.system,
            user=prompt.user,
            schema=self._schema,
            timeout_s=remaining / (SDK_RETRIES + 1),
        )
        self._tokens[0] += output.input_tokens
        self._tokens[1] += output.output_tokens
        tokens[0] += output.input_tokens
        tokens[1] += output.output_tokens
        return output.text

    def _save(self, text: str, answer: _Answer) -> None:
        try:
            self._cache.put(
                self._key(build_prompt(text)),
                model=self._model,
                prompt_version=EXTRACT_PROMPT_VERSION,
                reply_text=answer.text,
                tokens=answer.tokens,
            )
        except CacheError as exc:  # the reply is paid for and valid: keep it, report the write
            self._issues.append(
                Issue(
                    severity="error",
                    kind="cache_write_failed",
                    message=plain(str(exc))[:MESSAGE_LIMIT],
                )
            )

    # --- applying a reply: locate, cut the block, keep or drop ---------------------------------

    def _apply(self, run: _Run, chunk: Chunk, answer: _Answer) -> None:
        path = run.layout.doc.path
        for reason, shown in answer.bad:
            self._drop(run, path, "item", reason, shown)
        for item in answer.reply.items:
            self._item(run, chunk, item)
        for unclear in answer.reply.unclear[:UNCLEAR_PER_CHUNK]:
            self._unclear(run, chunk, unclear)
        for extra in answer.reply.unclear[UNCLEAR_PER_CHUNK:]:
            self._drop(run, path, "clarification", "over the limit per chunk", extra.topic)

    def _drop(self, run: _Run | None, path: str, kind: str, reason: str, item: str) -> None:
        if run is not None and kind != "clarification":
            run.dropped += 1
        self._dropped_total += 1
        if len(self._dropped) < DROPPED_KEPT:
            self._dropped.append(
                Dropped(
                    path=path, kind=kind, reason=reason, item=" ".join(item.split())[:ITEM_SHOWN]
                )
            )

    def _item(self, run: _Run, chunk: Chunk, item: ExtractItem) -> None:
        layout = run.layout
        path = layout.doc.path
        quote = unescape_quote(item.quote)
        problem = quote_problem(quote)
        if problem is not None:
            self._drop(run, path, "quote", problem, item.quote)
            return
        found = occurrences(layout.projection, quote, within=(chunk.start, chunk.end))
        if not found:
            self._drop(run, path, "quote", "not found in the excerpt", item.quote)
            return
        if len(found) > 1:
            self._issues.append(
                Issue(
                    severity="info",
                    kind="ambiguous_quote",
                    message=f"a quote occurs {len(found)} times in the excerpt; the first not "
                    "yet used is taken",
                    where=f"{path}, line {layout.line_of(found[0][0])}",
                )
            )
        chosen = next(
            (
                o
                for o in found
                if (b := block_at(layout.blocks, o[0])) and b.start not in run.drafts
            ),
            found[0],
        )
        block = block_at(layout.blocks, chosen[0])
        if (why := _not_a_statement(block, chosen[1])) is not None:
            self._drop(run, path, "quote", why, quote)
        elif block is None:
            return  # unreachable: `_not_a_statement` said so
        elif block.start in run.drafts:
            run.merged += 1  # D3: one block is one requirement
        elif len(run.drafts) >= MAX_PER_DOCUMENT:
            self._cap(run, quote)
        else:
            end = block.end
            if item.end_quote is not None:
                found_end = self._span_end(run, chunk, block, item.end_quote)
                if found_end is None:
                    return
                end = found_end
            run.drafts[block.start] = _Draft(block, quote, item.kind, item.id, end)

    def _cap(self, run: _Run, quote: str) -> None:
        path = run.layout.doc.path
        if not run.capped:
            run.capped = True
            self._issues.append(
                Issue(
                    severity="error",
                    kind="too_many_requirements",
                    message=f"more than {MAX_PER_DOCUMENT} requirements: the rest are dropped",
                    where=path,
                )
            )
        self._drop(run, path, "quote", f"over {MAX_PER_DOCUMENT} per document", quote)

    def _span_end(self, run: _Run, chunk: Chunk, block: Block, raw: str) -> int | None:
        """Where a statement over several blocks ends (D3, as changed in PR 4b): the end of the
        block that holds `end_quote`, which must follow the start inside this chunk, with no
        heading between and at most `MAX_BLOCK` characters in all. None, and the item is dropped
        and counted, when any of that fails: the statement is then not kept at all, never kept
        short."""
        layout = run.layout
        path = layout.doc.path
        end_quote = unescape_quote(raw)
        problem = quote_problem(end_quote)
        if problem is not None:
            self._drop(run, path, "quote", f"end quote: {problem}", raw)
            return None
        found = occurrences(layout.projection, end_quote, within=(chunk.start, chunk.end))
        after = [o for o in found if o[0] >= block.end]
        if not after and any(block.start <= o[0] < block.end for o in found):
            self._issues.append(  # the statement ends where it starts: one block, and it says so
                Issue(
                    severity="info",
                    kind="end_quote_in_start_block",
                    message="the end quote occurs only inside the start block; kept as one block",
                    where=f"{path}, line {layout.line_of(block.start)}",
                )
            )
            return block.end
        last = block_at(layout.blocks, after[0][0]) if after else None
        if last is None or after[0][1] > last.end:
            why = "end quote not found after the start" if last is None else "end quote crosses"
            self._drop(run, path, "quote", why, raw)
            return None
        between = [b for b in layout.blocks if block.start < b.start <= last.start]
        if any(b.kind == "heading" for b in between):
            self._drop(run, path, "quote", "the statement crosses a heading", raw)
        elif last.end - block.start > MAX_BLOCK:
            self._drop(run, path, "quote", f"the statement is over {MAX_BLOCK} characters", raw)
        else:
            return last.end
        return None

    def _unclear(self, run: _Run, chunk: Chunk, item: UnclearItem) -> None:
        path = run.layout.doc.path
        topic = " ".join(item.topic.split())[:TOPIC_LIMIT]
        reason = " ".join(item.reason.split())[:REASON_LIMIT]
        if not topic or not reason:
            self._drop(run, path, "clarification", "no topic or no reason", item.topic)
            return
        if self._unclear_seen >= UNCLEAR_PER_RUN:
            self._drop(run, path, "clarification", "over the limit per run", item.topic)
            return
        self._unclear_seen += 1
        quote: str | None = None
        if item.quote is not None:
            raw = unescape_quote(item.quote)
            where = (
                occurrences(run.layout.projection, raw, within=(chunk.start, chunk.end))
                if quote_problem(raw) is None
                else []
            )
            if where:
                quote = " ".join(raw.split())[:ITEM_SHOWN]
            else:  # D11: a quote that is not in the document makes it unanchored, and is counted
                self._drop(run, path, "clarification", "quote not found: unanchored", item.quote)
        self._clarifications.append(
            Clarification(topic=topic, reason=reason, quote=quote, path=path)
        )

    # --- from drafts to records ------------------------------------------------------------

    def _build(self, run: _Run) -> list[Extracted]:
        layout = run.layout
        starts = [b.start for b in layout.blocks]
        built: list[Extracted] = []
        ends = self._ends(run)
        for _, draft in sorted(run.drafts.items()):
            block = draft.block
            end = ends[block.start]
            lines: list[str | None] = list(layout.blanked[block.start : end].splitlines())
            text = join_wrapped(lines)
            index = bisect.bisect_left(starts, block.start)
            above = layout.blocks[index - 1] if index > 0 else None
            above_title = (
                layout.blanked[above.start : above.end].lstrip("# ")
                if above is not None and above.kind == "heading"
                else None
            )
            proposed = spec_id(draft.proposed_id, text, above_title, block.kind == "heading")
            requirement = Requirement(
                id=proposed or hash_id(text),
                title=make_title(text, block, layout.headings, layout.blanked),
                text=text,
                kind="fr" if draft.kind == "fr" else "nfr",
                must_level=must_level(text),
                priority=None,
                planned=False,
                source=SpecRef(
                    path=layout.doc.path,
                    line=layout.line_of(block.start),
                    heading=heading_path(layout.headings, block.start),
                    end_line=layout.line_of(max(block.start, end - 1)),
                ),
                origin="extracted",
            )
            built.append(
                Extracted(
                    requirement=requirement,
                    span=Span(path=layout.doc.path, start=block.start, end=end),
                    quote=" ".join(draft.quote.split())[:ITEM_SHOWN],
                    spec_id=proposed,
                    names_gear=names_gear(text, self._gears),
                )
            )
        return built

    def _ends(self, run: _Run) -> dict[int, int]:
        """Where each kept statement finally ends, worked out once: what the requirement is cut
        to, and what counts as claimed, must be the same (Sanjeev, #88)."""
        if run.ends is None:
            ordered = sorted(run.drafts.items())
            run.ends = {
                start: self._clipped(
                    run.layout, draft, ordered[n + 1][0] if n + 1 < len(ordered) else None
                )
                for n, (start, draft) in enumerate(ordered)
            }
        return run.ends

    def _clipped(self, layout: _Layout, draft: _Draft, next_start: int | None) -> int:
        """A statement never runs into the next one: when it would, it ends with the last block
        before it (and the run says so)."""
        if next_start is None or draft.end <= next_start:
            return draft.end
        inside = [
            b.end for b in layout.blocks if draft.block.start <= b.start and b.end <= next_start
        ]
        self._issues.append(
            Issue(
                severity="info",
                kind="span_cut",
                message="a statement over several blocks ran into the next requirement; it ends "
                "before it",
                where=f"{layout.doc.path}, line {layout.line_of(draft.block.start)}",
            )
        )
        return max(inside)

    def _unique_ids(self, extracted: list[Extracted]) -> list[Extracted]:
        """A repeated ID is an error (as T2's D5): both kept, the later ones suffixed `--2`..."""
        seen: Counter[str] = Counter(dict.fromkeys(self._taken, 1))
        unique: list[Extracted] = []
        for item in extracted:
            rid = item.requirement.id
            seen[rid] += 1
            if seen[rid] > 1:
                new = f"{rid}--{seen[rid]}"
                while seen[new]:
                    seen[rid] += 1
                    new = f"{rid}--{seen[rid]}"
                seen[new] += 1
                ref = item.requirement.source
                self._issues.append(
                    Issue(
                        severity="error",
                        kind="duplicate_id",
                        message=f"{plain(rid)} is defined again: kept as {plain(new)}",
                        where=f"{ref.path}:{ref.line}",
                    )
                )
                item = item.model_copy(  # noqa: PLW2901
                    update={"requirement": item.requirement.model_copy(update={"id": new})}
                )
            unique.append(item)
        return unique

    def _outcome(self, run: _Run, found: list[Extracted]) -> DocumentOutcome:
        layout = run.layout
        ends = self._ends(run)
        kept_blocks = [
            b
            for b in layout.blocks
            if any(d.block.start <= b.start < ends[d.block.start] for d in run.drafts.values())
        ]
        shaped = len(layout.shaped)
        left = unclaimed(layout.shaped, kept_blocks)
        loose = len(left)
        examples = tuple(
            " ".join(layout.blanked[b.start : b.end].split())[:ITEM_SHOWN]
            for b in left[:UNCLAIMED_SHOWN]
        )
        strong = strong_blocks(layout.blanked, layout.shaped)
        loose_strong = len(unclaimed(strong, kept_blocks))
        reasons: list[str] = []
        if run.chunks_failed:
            reasons.append(f"{run.chunks_failed} of {len(layout.chunks)} chunks not read")
        if strong and loose_strong / len(strong) > UNCLAIMED_LIMIT:
            reasons.append(
                f"{loose_strong} of {len(strong)} blocks with MUST/SHALL/SHOULD/MAY not claimed"
            )
        if shaped and not found:
            reasons.append(
                f"no requirement extracted, though {shaped} blocks look like requirements"
            )
        return DocumentOutcome(
            path=layout.doc.path,
            kept=len(found),
            dropped=run.dropped,
            merged=run.merged,
            shaped_blocks=shaped,
            unclaimed_blocks=loose,
            unclaimed_examples=examples,
            strong_blocks=len(strong),
            unclaimed_strong=loose_strong,
            chunks=len(layout.chunks),
            chunks_failed=run.chunks_failed,
            incomplete=bool(reasons),
            reason="; ".join(reasons),
            sha256=hashlib.sha256(layout.doc.text.encode("utf-8")).hexdigest(),
        )


def _not_a_statement(block: Block | None, quote_end: int) -> str | None:
    """Why the block a quote starts in cannot be a requirement, or None."""
    if block is None or quote_end > block.end:
        return "not inside one block (it crosses a boundary)"
    if block.kind == "heading":
        return "a heading, not a statement"
    if block.end - block.start > MAX_BLOCK:
        return f"its block is longer than {MAX_BLOCK} characters"
    return None


# --- reading a reply -------------------------------------------------------------------------


@dataclass(frozen=True)
class _Parsed:
    reply: ExtractReply
    bad: tuple[tuple[str, str], ...]
    problem: str | None  # why the reply as a whole is unusable; None when it can be used


def _parse(text: str) -> _Parsed:
    """The reply's items, each checked on its own: a bad item is dropped and counted (D9), only a
    reply that is not a JSON object with an `items` list is unusable as a whole."""
    empty = ExtractReply()
    try:
        document = json.loads(text)
    except ValueError as exc:
        return _Parsed(empty, (), f"the reply is not JSON ({exc})")
    if not isinstance(document, dict) or not isinstance(document.get("items"), list):
        return _Parsed(empty, (), 'the reply is not an object with an "items" list')
    unclear = document.get("unclear", [])
    if not isinstance(unclear, list):
        return _Parsed(empty, (), '"unclear" is not a list')
    bad: list[tuple[str, str]] = []
    items: list[ExtractItem] = []
    topics: list[UnclearItem] = []
    for raw in document["items"]:
        try:
            items.append(ExtractItem.model_validate(raw))
        except ValidationError as exc:
            bad.append((_why(exc), json.dumps(raw, ensure_ascii=False)))
    for raw in unclear:
        try:
            topics.append(UnclearItem.model_validate(raw))
        except ValidationError as exc:
            bad.append((_why(exc), json.dumps(raw, ensure_ascii=False)))
    return _Parsed(ExtractReply(items=tuple(items), unclear=tuple(topics)), tuple(bad), None)


def _why(exc: ValidationError) -> str:
    return " ".join(str(exc.errors()[0]["msg"]).split())[:ITEM_SHOWN]


def empty_extraction(
    product_id: str | None = None,
    gears_md_commit: str | None = None,
    gear_gdl_commit: str | None = None,
) -> Extraction:
    """What `--extract-out` / `--extract-md` write when nothing needed a model: a valid, empty
    extraction, so a tool that reads the file always finds one."""
    return Extraction(
        product_id=product_id,
        gears_md_commit=gears_md_commit,
        gear_gdl_commit=gear_gdl_commit,
        extracted=(),
        clarifications=(),
        outcomes=(),
        report=ExtractionReport(
            model="none: no document needed a model",
            prompt_version=EXTRACT_PROMPT_VERSION,
            chunks=0,
            chunks_failed=0,
            cache_hits=0,
            calls=0,
            input_tokens=0,
            output_tokens=0,
            dropped=(),
            dropped_total=0,
            unclaimed_blocks=0,
        ),
    )
