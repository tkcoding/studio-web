"""The library entry point of the service (T9): a spec in, a coverage report out.

The order is fixed, and nothing paid starts before everything before it is ready:

1. **Read the format (T2).** The documents are read as Constructor Fabric spec files. A spec in that
   format goes straight to step 3. Anything else is handed over for step 2, if the caller allowed
   it (`extract_max_calls`); if not, the spec is refused as `not_a_template`.
2. **Extract (T8), only if needed.** A model reads the handed-over documents and their requirements
   are added to the spec's own. This is bounded by `extract_max_calls`.
3. **Match (T11, `verified`).** Only now do the matching models run, under one call budget
   (`max_calls`) shared by every model.

Unlike the `gears-match` command this has no command line, prints nothing and writes no file: the
caller gives it hooks (cancel, progress, usage) and gets a result back. The command line and the
evaluation stay in gears-matcher (see `SOURCE`).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from gears_matcher.catalogue import has_code
from gears_matcher.catalogue.models import Catalogue
from gears_matcher.extract import (
    EXTRACT_PROMPT_VERSION,
    Extraction,
    Extractor,
    merge,
)
from gears_matcher.judge.llm import CacheError, ModelClient, ResponseCache
from gears_matcher.matchers import verified_run as vr
from gears_matcher.matchers.checks import CHECK_PROMPT_HASH, GearChecker
from gears_matcher.matchers.main_job import MAIN_JOB_PROMPT_HASH, MainJobChecker
from gears_matcher.matchers.report_check import REPORT_PROMPT_HASH, ReportChecker
from gears_matcher.matchers.verified_run import RunCancelled
from gears_matcher.matchers.whole_catalogue import PROMPT_VERSION as CATALOGUE_PROMPT
from gears_matcher.matchers.whole_catalogue import CatalogueModel
from gears_matcher.report import DEFAULT_TAU, CoverageReport, RunSettings, build_report
from gears_matcher.spec import LoadedSpec, Spec, SpecError, load_documents

__all__ = [
    "VERIFIED_MODELS",
    "Hooks",
    "InputProblem",
    "MatchResult",
    "RunCancelled",
    "RunInputs",
    "Usage",
    "check_spec",
    "run_matching",
]

# T11 D10: candidates (Sonnet, Opus), then the strict and report checks (gpt-5.4); fixed, measured.
VERIFIED_MODELS = ("claude-sonnet-4-6", "claude-opus-5", "gpt-5.4")
# A model id to (the cache identity of its replies, a client that is ready to send).
ModelFactory = Callable[[str], tuple[str, ModelClient]]


class InputProblem(Exception):  # noqa: N818 -- reads as the thing it is: a problem with the input
    """The input cannot be matched, whatever is tried again: the caller fixes it. `code` is one of
    `not_a_template`, `unreadable_spec`, `unknown_own_gear`, `cache`; `message` is one line and
    never holds document text."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Usage:
    """What a run has cost so far: model calls, replies served from the cache, and tokens."""

    calls: int = 0
    cache_hits: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


def _never() -> bool:
    return False


def _no_hits() -> int:
    return 0


@dataclass(frozen=True)
class Hooks:
    """What the caller watches and controls. All are called from the thread that runs the match."""

    cancelled: Callable[[], bool] = _never  # asked before each call and each requirement
    on_progress: Callable[[int, int], None] | None = None  # (requirements done, total)
    on_usage: Callable[[Usage], None] | None = None  # after each model call


@dataclass(frozen=True)
class RunInputs:
    spec_path: Path  # a spec bundle, a product folder, or one PRD, already on disk
    catalogue: Catalogue
    model_factory: ModelFactory
    cache_dir: Path  # where model replies are kept, so a rerun does not pay twice
    product: str | None = None
    own_gears: frozenset[str] = frozenset()
    max_calls: int = 400  # bounds the matching models, all together (Studio took 126)
    extract_max_calls: int | None = None  # None: free-form reading is off
    tau: float = DEFAULT_TAU


@dataclass(frozen=True)
class MatchResult:
    report: CoverageReport
    requirements: int
    not_assessed: int  # requirements no model assessed (a call failed, or the budget ran out)
    usage: Usage
    extraction: Extraction | None = None  # what T8 read, when it ran
    clarifications: int = field(default=0)


def check_spec(spec_path: Path, product: str | None = None, *, extract: bool) -> LoadedSpec:
    """Step 1: read the documents as CF spec files, before anything is paid for.

    Raises `InputProblem`: `unreadable_spec` when nothing can be read, `not_a_template` when the
    documents are not in the format and `extract` is off. With `extract` on, documents that are not
    in the format are returned as `handed`, for step 2."""
    try:
        loaded = load_documents(spec_path, product)
    except SpecError as exc:
        raise InputProblem("unreadable_spec", _line(str(exc))) from exc
    if loaded.spec.requirements:
        return loaded
    if not loaded.handed:
        raise InputProblem("unreadable_spec", "no requirement was found in the documents")
    if not extract:
        raise InputProblem(
            "not_a_template",
            "the documents are not in the spec format; set options.extract_max_calls to read them",
        )
    return loaded


def run_matching(inputs: RunInputs, hooks: Hooks | None = None) -> MatchResult:
    """Steps 1 to 3. Raises `InputProblem` (fix the input) or `RunCancelled` (the caller stopped);
    any other exception is a bug."""
    hooks = hooks or Hooks()
    loaded = check_spec(
        inputs.spec_path, inputs.product, extract=inputs.extract_max_calls is not None
    )
    cat = inputs.catalogue
    unknown = sorted(inputs.own_gears - {g.id for g in cat.gears})
    if unknown:
        raise InputProblem("unknown_own_gear", f"not in the catalogue: {', '.join(unknown)}")
    meter = _Meter(hooks)
    spec, extraction, label = _extract_if_needed(inputs, loaded, meter)
    meter.mark_matching()
    report, not_assessed = _match(inputs, spec, extraction, label, meter)
    return MatchResult(
        report=report,
        requirements=len(spec.requirements),
        not_assessed=not_assessed,
        usage=meter.usage(),
        extraction=extraction,
        clarifications=len(report.clarifications),
    )


class _Meter:
    """Counts every call of the run (extraction and matching), and tells the caller."""

    def __init__(self, hooks: Hooks) -> None:
        self.hooks = hooks
        self.extracting = vr.CallBudget(0, cancelled=hooks.cancelled, on_call=self._changed)
        self.matching = vr.CallBudget(0, cancelled=hooks.cancelled, on_call=self._changed)
        self.cache_hits: Callable[[], int] = _no_hits

    def mark_matching(self) -> None:
        self._changed(self.matching)

    def _changed(self, _budget: vr.CallBudget) -> None:
        if self.hooks.on_usage is not None:
            self.hooks.on_usage(self.usage())

    def usage(self) -> Usage:
        both = (self.extracting, self.matching)
        return Usage(
            calls=sum(b.used for b in both),
            cache_hits=self.cache_hits(),
            input_tokens=sum(b.input_tokens for b in both),
            output_tokens=sum(b.output_tokens for b in both),
        )


def _extract_if_needed(
    inputs: RunInputs, loaded: LoadedSpec, meter: _Meter
) -> tuple[Spec, Extraction | None, str | None]:
    """Step 2: only when T2 handed documents over, and the caller allowed a model to read them."""
    bound = inputs.extract_max_calls
    if bound is None or not loaded.handed:
        return loaded.spec, None, None
    meter.extracting.limit = bound
    identity, client = inputs.model_factory(VERIFIED_MODELS[0])
    try:
        extractor = Extractor(
            vr.Counted(client, meter.extracting),
            inputs.cache_dir,
            model=identity,
            max_calls=bound,
            gears=inputs.catalogue.gears,
            existing_ids=[r.id for r in loaded.spec.requirements],
        )
    except CacheError as exc:
        raise InputProblem("cache", _line(str(exc))) from exc
    result = extractor.extract(loaded.handed)
    if result.nothing_extracted and not loaded.spec.requirements:
        raise InputProblem("unreadable_spec", "no requirement could be read from the documents")
    result = result.model_copy(
        update={
            "product_id": loaded.spec.product_id,
            "gears_md_commit": inputs.catalogue.gears_md_commit,
            "gear_gdl_commit": inputs.catalogue.gear_gdl_commit,
        }
    )
    return merge(loaded, result), result, f"llm: {identity}, prompt {EXTRACT_PROMPT_VERSION}"


def _match(
    inputs: RunInputs,
    spec: Spec,
    extraction: Extraction | None,
    label: str | None,
    meter: _Meter,
) -> tuple[CoverageReport, int]:
    """Step 3: the `verified` matcher (T11 note §2) on the spec as it now stands."""
    cat = inputs.catalogue
    meter.matching.limit = inputs.max_calls
    made = {
        role: inputs.model_factory(name)
        for role, name in zip(("first", "second", "checks"), VERIFIED_MODELS, strict=True)
    }
    counted = {role: vr.Counted(client, meter.matching) for role, (_, client) in made.items()}
    big = inputs.max_calls  # each part's own bound; the shared budget is what limits the run
    try:
        cache = ResponseCache(inputs.cache_dir)
        models = vr.Models(
            first=CatalogueModel(counted["first"], cache, identity=made["first"][0], max_calls=big),
            second=CatalogueModel(
                counted["second"], cache, identity=made["second"][0], max_calls=big
            ),
            targeted=GearChecker(counted["first"], cache, identity=made["first"][0], max_calls=big),
            strict=GearChecker(counted["checks"], cache, identity=made["checks"][0], max_calls=big),
            report=ReportChecker(
                counted["checks"], cache, identity=made["checks"][0], max_calls=big
            ),
            main_job=MainJobChecker(
                counted["second"], cache, identity=made["second"][0], max_calls=big
            ),
        )
    except CacheError as exc:
        raise InputProblem("cache", _line(str(exc))) from exc
    meter.cache_hits = lambda: sum(m.run.cache_hits for m in vars(models).values())
    cards = [vr.pick_card(g) for g in cat.gears]
    in_code = {g.id: has_code(g) for g in cat.gears}
    result = vr.run_verified(
        spec.requirements, cards, models, own=inputs.own_gears,
        in_code=in_code.__getitem__, check_cards=[vr.check_card(g) for g in cat.gears],
        cancelled=meter.hooks.cancelled, on_progress=meter.hooks.on_progress,
    )  # fmt: skip
    settings = RunSettings(
        judge=(
            f"verified: candidates {VERIFIED_MODELS[0]} + {VERIFIED_MODELS[1]} (prompt "
            f"{CATALOGUE_PROMPT}); checks {VERIFIED_MODELS[0]} / {VERIFIED_MODELS[2]} (prompt "
            f"{CHECK_PROMPT_HASH}); report check {VERIFIED_MODELS[2]} (prompt "
            f"{REPORT_PROMPT_HASH}); main-job check {VERIFIED_MODELS[1]} (prompt "
            f"{MAIN_JOB_PROMPT_HASH})"
        ),
        shortlist="whole catalogue (no shortlist)",
        tau=inputs.tau,
        extraction=label,
    )
    report = build_report(
        spec, cat, result.shortlist, result.matches, settings=settings,
        failed=result.failed, future=result.future, has_code=has_code,
        clarifications=extraction.clarifications if extraction is not None else (),
    )  # fmt: skip
    return report, report.totals.fr.not_assessed + report.totals.nfr.not_assessed


def _line(text: str, limit: int = 300) -> str:
    """One bounded line of an outside tool's error text, for a message to the caller."""
    return " ".join(text.split())[:limit]
