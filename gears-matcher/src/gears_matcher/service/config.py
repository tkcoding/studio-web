"""The service's config file: its keys and connection settings in one place (ADR-0071 §8).

`GEARS_MATCHER_CONFIG` names a TOML file (in a deployment: one Secret, mounted read-only):

    shared_secret = "..."            # the bearer token the backend sends

    [llm]                            # the Constructor LLM connector, the matcher's own key
    access_key = "..."
    stand = "..."
    cmodel_id = "..."
    public_connector_id = "..."
    model = "claude-sonnet-4-6"      # optional

    [gears_rust]                     # where the Gear catalogue is cloned from
    url = "https://github.com/constructorfabric/gears-rust.git"
    token = "..."                    # optional: a private gears-rust

    [database]                       # optional: the `PG*` environment otherwise
    url = "postgresql://user:password@host:5432/gears_matcher"

Each value becomes the environment variable the rest of the service already reads, and only when the
environment does not set it, so a variable always wins over the file (a local run, a test). An
unknown section or key is refused: a typo would otherwise be a key that is silently not used. No
value is ever printed.
"""

import os
import tomllib
from collections.abc import MutableMapping
from pathlib import Path

# (section, key) -> environment variable; section "" is the top level.
NAMES: dict[tuple[str, str], str] = {
    ("", "shared_secret"): "GEARS_MATCHER_SECRET",
    ("llm", "access_key"): "LLM_CONNECTORS_ACCESS_KEY",
    ("llm", "stand"): "CONSTRUCTOR_STAND",
    ("llm", "cmodel_id"): "CONSTRUCTOR_CMODEL_ID",
    ("llm", "public_connector_id"): "CONSTRUCTOR_PUBLIC_CONNECTOR_ID",
    ("llm", "model"): "CONSTRUCTOR_MODEL",
    ("gears_rust", "url"): "GEARS_RUST_URL",
    ("gears_rust", "token"): "GEARS_RUST_TOKEN",
    ("database", "url"): "GEARS_MATCHER_DATABASE_URL",
}
_SECTIONS = {section for section, _ in NAMES if section}


class ConfigError(Exception):
    """The config file cannot be used; the message names the file and the key, never a value."""


def load_config(path: Path, env: MutableMapping[str, str] | None = None) -> None:
    """Put the file's values into `env` (the process environment by default) where unset."""
    target = os.environ if env is None else env
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"{path}: no such config file") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path}: not valid TOML ({exc})") from exc
    for name, value in _flatten(path, data):
        if not target.get(name, "").strip():
            target[name] = value


def _flatten(path: Path, data: dict[str, object]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for key, value in data.items():
        if key in _SECTIONS:
            if not isinstance(value, dict):
                raise ConfigError(f"{path}: [{key}] must be a section")
            out.extend(
                (_name(path, key, k), _text(path, f"{key}.{k}", v)) for k, v in value.items()
            )
        else:
            out.append((_name(path, "", key), _text(path, key, value)))
    return out


def _name(path: Path, section: str, key: str) -> str:
    name = NAMES.get((section, key))
    if name is None:
        where = f"{section}.{key}" if section else key
        raise ConfigError(f"{path}: unknown key {where}")
    return name


def _text(path: Path, where: str, value: object) -> str:
    if not isinstance(value, str):
        raise ConfigError(f"{path}: {where} must be a string")
    return value.strip()
