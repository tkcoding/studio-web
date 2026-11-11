"""`gears-service`: serve the matcher over HTTP. Everything is read from the environment.

Required: `GEARS_MATCHER_SECRET` (the shared secret callers send as a bearer token) and
`GEARS_RUST_REPO` (a `gears-rust` checkout the catalogue is read from, at the pinned commits).
The LLM connector's own settings (`LLM_CONNECTORS_ACCESS_KEY` and the rest) are read by the model
clients; for a local run `GEARS_MATCHER_ENV_FILE` may name a file that holds them.

Optional: `GEARS_MATCHER_DATA` (the run store, the reply cache and scratch space; default
`/var/lib/gears-matcher`), `GEARS_MATCHER_HOST`, `GEARS_MATCHER_PORT`, `GEARS_MATCHER_WORKERS`,
`GEARS_MATCHER_MAX_CONCURRENT_RUNS` (unset: no cap), `GEARS_MATCHER_MAX_CALLS` (the per-run call
bound a request may lower but not raise, and the default when it sets none; 200) and
`GEARS_MATCHER_MAX_EXTRACT_CALLS` (100), `GEARS_MD_REF`, `GEARS_GDL_REF`, `GEARS_BUNDLE`.
"""

import logging
import os
import sys
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import uvicorn

from gears_matcher.catalogue import PINNED_GDL_COMMIT, PINNED_MD_COMMIT, build_from_repo
from gears_matcher.judge.llm import ModelClient
from gears_matcher.judge.llm.run import (
    DEFAULT_PROVIDER,
    RunError,
    load_client,
    load_env_file,
    provider_module,
)
from gears_matcher.run import VERIFIED_MODELS, ModelFactory
from gears_matcher.service.app import create_app
from gears_matcher.service.manager import RunManager
from gears_matcher.service.request import Limits
from gears_matcher.service.runner import RealRunner
from gears_matcher.service.store import RunStore

log = logging.getLogger("gears_matcher.service")
EXIT_CANNOT_START = 2


class SettingsError(Exception):
    """The environment cannot start the service; the message says which variable and why."""


@dataclass(frozen=True)
class Settings:
    secret: str
    gears_rust: Path
    data: Path
    host: str
    port: int
    workers: int
    limits: Limits
    md_ref: str
    gdl_ref: str
    bundle: Path | None

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Settings":
        secret = env.get("GEARS_MATCHER_SECRET", "")
        if not secret:
            raise SettingsError("GEARS_MATCHER_SECRET is required")
        repo = env.get("GEARS_RUST_REPO", "")
        if not repo or not Path(repo).is_dir():
            raise SettingsError("GEARS_RUST_REPO must name a gears-rust checkout")
        cap = env.get("GEARS_MATCHER_MAX_CONCURRENT_RUNS")
        bundle = env.get("GEARS_BUNDLE")
        return cls(
            secret=secret,
            gears_rust=Path(repo),
            data=Path(env.get("GEARS_MATCHER_DATA", "/var/lib/gears-matcher")),
            host=env.get("GEARS_MATCHER_HOST", "0.0.0.0"),  # noqa: S104 -- a container's own port
            port=_number(env, "GEARS_MATCHER_PORT", 8080),
            workers=_number(env, "GEARS_MATCHER_WORKERS", 4),
            limits=Limits(
                max_calls=_number(env, "GEARS_MATCHER_MAX_CALLS", Limits.max_calls),
                max_extract_calls=_number(
                    env, "GEARS_MATCHER_MAX_EXTRACT_CALLS", Limits.max_extract_calls
                ),
                max_concurrent_runs=int(cap) if cap else None,
            ),
            md_ref=env.get("GEARS_MD_REF", PINNED_MD_COMMIT),
            gdl_ref=env.get("GEARS_GDL_REF", PINNED_GDL_COMMIT),
            bundle=Path(bundle) if bundle else None,
        )


def _number(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SettingsError(f"{name} must be a whole number") from exc
    if value < 1:
        raise SettingsError(f"{name} must be at least 1")
    return value


def model_factory() -> ModelFactory:
    """Clients are built once per model and shared; a missing key fails here, at start."""
    module = provider_module(DEFAULT_PROVIDER)
    made: dict[str, tuple[str, ModelClient]] = {}
    lock = threading.Lock()

    def factory(name: str) -> tuple[str, ModelClient]:
        with lock:
            if name not in made:
                made[name] = (module.label(name), load_client(module, DEFAULT_PROVIDER, name))
            return made[name]

    for name in VERIFIED_MODELS:
        factory(name)
    return factory


def build(settings: Settings) -> tuple[RunManager, RealRunner]:
    catalogue = build_from_repo(settings.gears_rust, settings.md_ref, settings.gdl_ref)
    bundle = (
        build_from_repo(settings.gears_rust, settings.md_ref, settings.gdl_ref, settings.bundle)
        if settings.bundle
        else None
    )
    runner = RealRunner(
        catalogue,
        model_factory(),
        cache_dir=settings.data / "cache",
        work_dir=settings.data / "work",
        bundle_catalogue=bundle,
    )
    store = RunStore(settings.data / "runs.sqlite")
    return RunManager(store, runner, settings.limits, settings.workers), runner


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    try:
        env_file = os.environ.get("GEARS_MATCHER_ENV_FILE")
        if env_file:
            load_env_file(Path(env_file))
        settings = Settings.from_env(os.environ)
        manager, runner = build(settings)
    except (SettingsError, RunError, OSError, ValueError) as exc:
        print(f"gears-service: cannot start: {exc}", file=sys.stderr)
        return EXIT_CANNOT_START
    app = create_app(manager, settings.secret, runner.info(), settings.limits)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
