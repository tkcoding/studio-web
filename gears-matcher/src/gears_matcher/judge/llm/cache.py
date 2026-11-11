"""T4b: the on-disk response cache (T4b note D10, D11).

One JSON file per call. The key covers everything that decides the reply: model, prompt version,
reply schema, requirement text and the candidates' text. An entry holds the raw reply and its token
usage, never the API key or anything from the environment. A bad entry raises; it is never silently
treated as a miss (rule 1).
"""

import contextlib
import hashlib
import json
import os
import tempfile
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from gears_matcher.judge.llm.schema import ModelReply
from gears_matcher.judge.models import GearCard
from gears_matcher.models import Frozen, Requirement


class CacheError(Exception):
    """The cache cannot be used."""


class CacheDirError(CacheError):
    """The cache directory cannot be created or written; raised at construction, not mid-run."""


class CacheEntryError(CacheError):
    """An entry is unreadable or invalid. Delete the named file (or the directory) to refetch."""


class CacheEntry(Frozen):
    model: str
    prompt_version: str
    created: str
    reply_text: str  # the raw reply that was accepted
    input_tokens: int  # summed over every request that produced it, repair included
    output_tokens: int


def schema_hash() -> str:
    """Hash of the reply schema: a changed schema misses the cache instead of failing validation."""
    schema = json.dumps(ModelReply.model_json_schema(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(schema.encode()).hexdigest()


def cache_key(
    model: str, prompt_version: str, requirement: Requirement, cards: Sequence[GearCard]
) -> str:
    """SHA-256 over (model, prompt version, schema, requirement text, candidate text).

    The cards are sorted by `gear_id` here, so the key never depends on the caller's order.
    """
    requirement_hash = _digest([requirement.title, requirement.text])
    gear_hash = _digest(
        [[c.gear_id, c.name, c.text] for c in sorted(cards, key=lambda c: c.gear_id)]
    )
    return _digest([model, prompt_version, schema_hash(), requirement_hash, gear_hash])


def _digest(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def entry_path(directory: Path, key: str) -> Path:
    """Where the entry for `key` lives. Creates nothing: a plan can ask whether an entry exists
    without making the folder."""
    return directory / key[:2] / f"{key}.json"


def _why(exc: Exception) -> str:
    """The reason without a path: an `OSError`'s text names the file, and a report may show only
    the entry's file name (a full path carries the home directory)."""
    return exc.strerror if isinstance(exc, OSError) and exc.strerror else type(exc).__name__


class ResponseCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        try:
            directory.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryFile(dir=directory):
                pass  # proves the directory is writable now, not at the first miss
        except OSError as exc:
            raise CacheDirError(f"cache directory {directory} is not usable: {exc}") from exc

    def path(self, key: str) -> Path:
        return entry_path(self.directory, key)

    def get(self, key: str) -> CacheEntry | None:
        """The entry for `key`, or None when there is none. A bad entry raises."""
        path = self.path(key)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except (OSError, UnicodeDecodeError) as exc:
            raise CacheEntryError(f"cache entry {path.name} cannot be read: {_why(exc)}") from exc
        try:
            return CacheEntry.model_validate_json(raw)
        except ValidationError as exc:
            raise CacheEntryError(
                f"cache entry {path.name} is invalid: {exc.errors()[0]['msg']}"
            ) from exc

    def put(
        self, key: str, *, model: str, prompt_version: str, reply_text: str, tokens: tuple[int, int]
    ) -> None:
        """Write an entry atomically: readers see the whole entry or none (temp file, rename)."""
        entry = CacheEntry(
            model=model,
            prompt_version=prompt_version,
            created=datetime.now(UTC).isoformat(timespec="seconds"),
            reply_text=reply_text,
            input_tokens=tokens[0],
            output_tokens=tokens[1],
        )
        path = self.path(key)
        temp = path.parent / f".tmp-{uuid.uuid4().hex}"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp.write_text(entry.model_dump_json(), encoding="utf-8")
            os.replace(temp, path)
        except OSError as exc:
            with contextlib.suppress(OSError):  # the cleanup must not hide the real failure
                temp.unlink(missing_ok=True)
            raise CacheError(f"cache entry {path.name} cannot be written: {_why(exc)}") from exc
