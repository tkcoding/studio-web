"""What a real-judge run needs before it sends anything, shared by `gears-match --judge llm` and
`scripts/run_judge.py` (T6 note D8): the provider table, the settings read from `.env`, the client,
and the plan (how many requirements the cache already has, a suggested call bound).

Nothing here sends a request. Both commands print the plan first, so a person sees what a run would
cost before it costs anything.
"""

import importlib
import math
import os
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType

from gears_matcher.catalogue import Catalogue
from gears_matcher.judge import gear_card
from gears_matcher.judge.llm.cache import cache_key, entry_path
from gears_matcher.judge.llm.prompt import PROMPT_VERSION
from gears_matcher.judge.llm.schema import ModelClient
from gears_matcher.models import Frozen, Requirement
from gears_matcher.retrieval import retrieve

__all__ = [
    "DEFAULT_PROVIDER",
    "ENV_NAMES",
    "PROVIDERS",
    "Plan",
    "RunError",
    "default_model",
    "load_client",
    "load_env_file",
    "make_plan",
    "provider_module",
    "shortlists_for",
]

# provider -> (module, class). A module is imported when a run needs it, never at import time (D15).
PROVIDERS = {
    "constructor": ("gears_matcher.judge.llm.constructor_client", "ConstructorClient"),
    "anthropic": ("gears_matcher.judge.llm.anthropic_client", "AnthropicClient"),
}
DEFAULT_PROVIDER = "constructor"  # Constructor's LLM Connectors; the model is `claude-sonnet-4-6`
# The only names read from `.env`, and only when the environment does not already have them.
ENV_NAMES = (
    "ANTHROPIC_API_KEY",
    "LLM_CONNECTORS_ACCESS_KEY",
    "CONSTRUCTOR_STAND",
    "CONSTRUCTOR_CMODEL_ID",
    "CONSTRUCTOR_PUBLIC_CONNECTOR_ID",
    "CONSTRUCTOR_MODEL",
)
REPAIR_ALLOWANCE = 1.2  # a suggested bound leaves room for the one repair call per requirement


class RunError(Exception):
    """The run cannot start or finish; the message says what to change."""


class Plan(Frozen):
    requirements: int
    judged: int  # requirements with candidates, the ones a model is asked about
    cached: int
    misses: int
    suggested_max_calls: int


def shortlists_for(
    requirements: Sequence[Requirement], catalogue: Catalogue, k: int
) -> list[tuple[Requirement, str, tuple[str, ...]]]:
    """Each requirement with T3's shortlist status and its candidate gear ids."""
    shortlists = retrieve(requirements, catalogue, k=k)
    return [(r, shortlists[r.id].status, shortlists[r.id].gear_ids) for r in requirements]


def make_plan(
    requirements: Sequence[Requirement], catalogue: Catalogue, *, k: int, model: str, cache: Path
) -> Plan:
    """What a run would do, sending nothing and creating nothing: how many requirements the cache
    already has (a cache folder that does not exist yet has none)."""
    gears = {g.id: g for g in catalogue.gears}
    judged = cached = 0
    for req, _status, gear_ids in shortlists_for(requirements, catalogue, k):
        if not gear_ids:
            continue
        judged += 1
        cards = tuple(gear_card(gears[gid]) for gid in gear_ids)
        if entry_path(cache, cache_key(model, PROMPT_VERSION, req, cards)).is_file():
            cached += 1
    misses = judged - cached
    return Plan(
        requirements=len(requirements),
        judged=judged,
        cached=cached,
        misses=misses,
        suggested_max_calls=math.ceil(misses * REPAIR_ALLOWANCE),
    )


def load_env_file(path: Path) -> None:
    """Put the names in `ENV_NAMES` from a `.env` file into the environment, if not already set.

    Only those names are read, so the file cannot change anything else, and a variable already in
    the environment wins. `.env` is git-ignored; `.env.example` is the placeholder to copy. No
    value is ever printed.
    """
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.partition("=")
        name, value = name.strip(), value.strip().strip("\"'")
        if sep and name in ENV_NAMES and value and not os.environ.get(name, "").strip():
            os.environ[name] = value


def provider_module(provider: str) -> ModuleType:
    """The provider's module, for its `label` and its client class (imported, nothing is sent)."""
    try:
        return importlib.import_module(PROVIDERS[provider][0])
    except ImportError as exc:
        raise RunError(
            f"the {provider} client is not part of this build ({exc}); nothing was sent"
        ) from exc


def default_model(provider: str, module: ModuleType) -> str:
    """The provider's own default; for Constructor, `CONSTRUCTOR_MODEL` may choose another."""
    chosen = os.environ.get("CONSTRUCTOR_MODEL", "").strip() if provider == "constructor" else ""
    return chosen or str(module.DEFAULT_MODEL)


def load_client(module: ModuleType, provider: str, model: str) -> ModelClient:
    """Build the provider client: this is where a missing key or setting is reported."""
    try:
        client: ModelClient = getattr(module, PROVIDERS[provider][1])(model=model)
    except module.ClientError as exc:  # names the variable that is missing, never a value
        raise RunError(str(exc)) from exc
    return client
