"""What a run needs from the matcher: a seam, so the service is tested without paid models.

`Runner` is the seam. `RealRunner` is the production one: it writes a request's documents to a
spec bundle on disk (T2 reads a folder with a `manifest.json`), calls `gears_matcher.run`, and maps
what comes back to what the service reports. Tests use a fake runner with the same interface.
"""

import json
import logging
import tempfile
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Literal, Protocol

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.judge.llm import CacheError, ResponseCache
from gears_matcher.report import SCHEMA_VERSION
from gears_matcher.run import (
    VERIFIED_MODELS,
    Hooks,
    InputProblem,
    ModelFactory,
    RunCancelled,
    RunInputs,
    Usage,
    check_spec,
    run_matching,
)
from gears_matcher.service.errors import ProblemError, unprocessable
from gears_matcher.service.request import RunRequest

log = logging.getLogger("gears_matcher.service")


class Cancelled(Exception):  # noqa: N818 -- reads as the event, like KeyboardInterrupt
    """The run stopped because the caller asked it to."""


class RunFailed(Exception):  # noqa: N818 -- reads as the outcome
    """The run ended without a report. `kind` is `input` (fix the request) or `internal`."""

    def __init__(self, kind: Literal["input", "internal"], message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


@dataclass(frozen=True)
class Outcome:
    report_json: str
    requirements: int
    not_assessed: int


class Meter(Protocol):
    """What the manager gives a running run: ask `cancelled`, tell progress and usage."""

    def cancelled(self) -> bool: ...

    def progress(self, done: int, total: int) -> None: ...

    def usage(self, calls: int, cache_hits: int, input_tokens: int, output_tokens: int) -> None: ...


class Runner(Protocol):
    def preflight(self, request: RunRequest) -> None:
        """Raise `ProblemError` (422) if the request cannot run, before anything is stored."""

    def run(self, request: RunRequest, meter: Meter) -> Outcome:
        """Raise `Cancelled`, `RunFailed`, or any other exception (a bug) instead of returning."""

    def info(self) -> dict[str, Any]:
        """What `GET /v1/info` says about the matcher, apart from the limits."""

    def ready(self) -> None:
        """Raise if the runner cannot do its work (for `GET /readyz`)."""


def service_version() -> str:
    try:
        return version("studio-gears-matcher")
    except PackageNotFoundError:  # run from a source tree that is not installed
        return "0.0.0"


def write_spec(request: RunRequest, root: Path) -> None:
    """The request's documents as T2's bundle: `manifest.json` and each file at its own path."""
    files = []
    for doc in request.documents:
        target = root / doc.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(doc.content, encoding="utf-8")
        files.append({"path": doc.path, "sha256": doc.sha256})
    manifest = {"products": [{"id": request.product, "name": request.product, "files": files}]}
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


class RealRunner:
    """Runs the verified matcher. Catalogues are built once, at start: one from the pinned commits,
    and one with the gears bundle when the service has one (`options.use_gears_bundle`)."""

    def __init__(
        self,
        catalogue: Catalogue,
        model_factory: ModelFactory,
        cache_dir: Path,
        work_dir: Path,
        bundle_catalogue: Catalogue | None = None,
    ) -> None:
        self.catalogues = {False: catalogue, True: bundle_catalogue}
        self.model_factory = model_factory
        self.cache_dir = cache_dir
        self.work_dir = work_dir
        work_dir.mkdir(parents=True, exist_ok=True)

    def _catalogue(self, request: RunRequest) -> Catalogue:
        chosen = self.catalogues[request.use_gears_bundle]
        if chosen is None:
            raise unprocessable("bundle_unavailable", "this service has no gears bundle")
        return chosen

    def preflight(self, request: RunRequest) -> None:
        catalogue = self._catalogue(request)
        unknown = sorted(set(request.own_gears) - {g.id for g in catalogue.gears})
        if unknown:
            raise unprocessable("unknown_own_gear", f"not in the catalogue: {', '.join(unknown)}")
        with tempfile.TemporaryDirectory(dir=self.work_dir) as tmp:
            write_spec(request, Path(tmp))
            try:
                check_spec(
                    Path(tmp), request.product, extract=request.extract_max_calls is not None
                )
            except InputProblem as problem:
                raise refused(problem) from problem

    def run(self, request: RunRequest, meter: Meter) -> Outcome:
        catalogue = self._catalogue(request)

        def on_usage(u: Usage) -> None:
            meter.usage(u.calls, u.cache_hits, u.input_tokens, u.output_tokens)

        hooks = Hooks(cancelled=meter.cancelled, on_progress=meter.progress, on_usage=on_usage)
        with tempfile.TemporaryDirectory(dir=self.work_dir) as tmp:
            write_spec(request, Path(tmp))
            inputs = RunInputs(
                spec_path=Path(tmp),
                catalogue=catalogue,
                model_factory=self.model_factory,
                cache_dir=self.cache_dir,
                product=request.product,
                own_gears=frozenset(request.own_gears),
                max_calls=request.max_calls,
                extract_max_calls=request.extract_max_calls,
            )
            try:
                result = run_matching(inputs, hooks)
            except RunCancelled as exc:
                raise Cancelled from exc
            except InputProblem as problem:
                if problem.code == "cache":  # the service's own setup, not the caller's request
                    log.error("the reply cache is not usable: %s", problem.message)
                    raise RunFailed(
                        "internal", "the reply cache is not usable; see the service log"
                    ) from problem
                raise RunFailed("input", f"{problem.code}: {problem.message}") from problem
        on_usage(result.usage)
        return Outcome(result.report.model_dump_json(), result.requirements, result.not_assessed)

    def ready(self) -> None:
        """The reply cache can be written; a wrong mount is found here, not by the first run."""
        try:
            ResponseCache(self.cache_dir)
        except CacheError as exc:
            raise RuntimeError(f"the reply cache is not usable: {exc}") from exc

    def info(self) -> dict[str, Any]:
        catalogue = self.catalogues[False]
        assert catalogue is not None  # noqa: S101 -- set in __init__
        return {
            "service_version": service_version(),
            "matcher_version": service_version(),
            "report_schema_versions": [SCHEMA_VERSION],
            "catalogue": {
                "source": "gears-rust",
                "gears_md_commit": catalogue.gears_md_commit,
                "gear_gdl_commit": catalogue.gear_gdl_commit,
            },
            "models": list(VERIFIED_MODELS),
        }


def refused(problem: InputProblem) -> ProblemError:
    """A refused input as the contract's 422, with the same stable code."""
    return unprocessable(problem.code, problem.message)


__all__ = [
    "Cancelled",
    "Meter",
    "ModelFactory",
    "Outcome",
    "RealRunner",
    "RunFailed",
    "Runner",
    "service_version",
    "write_spec",
]
