"""T4b response cache: the key, atomic entries, and every way an entry can be bad (D10, D11)."""

import os
import stat
from pathlib import Path

import pytest

from gears_matcher.judge import GearCard
from gears_matcher.judge.llm import (
    CacheDirError,
    CacheEntryError,
    CacheError,
    ResponseCache,
    cache_key,
)
from gears_matcher.judge.llm import cache as cache_module
from gears_matcher.models import Requirement, SpecRef


def requirement(
    title: str = "Store tasks", text: str = "The system MUST store tasks."
) -> Requirement:
    return Requirement(
        id="cpt-x-fr-store",
        title=title,
        text=text,
        kind="fr",
        must_level="MUST",
        priority=None,
        planned=False,
        source=SpecRef(path="PRD.md", line=1),
    )


A = GearCard(gear_id="gears-rust/a", name="A", text="Stores typed resources.")
B = GearCard(gear_id="gears-rust/b", name="B", text="Publishes events.")


def key(
    model: str = "m",
    version: str = "v1",
    req: Requirement | None = None,
    cards: tuple[GearCard, ...] = (A, B),
) -> str:
    return cache_key(model, version, req or requirement(), cards)


def put(cache: ResponseCache, k: str, text: str = '{"judgements": [{}]}') -> None:
    cache.put(k, model="m", prompt_version="v1", reply_text=text, tokens=(7, 3))


def test_key_ignores_the_callers_order() -> None:
    assert key(cards=(A, B)) == key(cards=(B, A))


@pytest.mark.parametrize(
    "other",
    [
        lambda: key(model="m2"),
        lambda: key(version="v2"),
        lambda: key(req=requirement(title="Other")),
        lambda: key(req=requirement(text="The system MUST list tasks.")),
        lambda: key(cards=(A,)),
        lambda: key(
            cards=(A, GearCard(gear_id="gears-rust/b", name="B", text="Publishes events!"))
        ),
        lambda: key(
            cards=(A, GearCard(gear_id="gears-rust/b", name="B2", text="Publishes events."))
        ),
        lambda: key(
            cards=(A, GearCard(gear_id="gears-rust/c", name="B", text="Publishes events."))
        ),
    ],
)
def test_key_changes_with_each_input(other: object) -> None:
    assert callable(other)
    assert other() != key()


def test_key_changes_with_the_reply_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    before = key()
    monkeypatch.setattr(cache_module, "schema_hash", lambda: "another-schema")
    assert key() != before


def test_entry_round_trips(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path / "c")
    assert cache.get(key()) is None
    put(cache, key())
    entry = cache.get(key())
    assert entry is not None
    assert (entry.reply_text, entry.input_tokens, entry.output_tokens) == (
        '{"judgements": [{}]}',
        7,
        3,
    )
    assert (entry.model, entry.prompt_version) == ("m", "v1")
    assert cache.path(key()).parent.name == key()[:2]


def test_half_written_temp_file_is_never_an_entry(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)
    shard = cache.path(key()).parent
    shard.mkdir(parents=True)
    (shard / ".tmp-abc").write_text("{half")
    assert cache.get(key()) is None


def test_corrupt_entry_raises_naming_the_file(tmp_path: Path) -> None:  # D11
    cache = ResponseCache(tmp_path)
    put(cache, key())
    cache.path(key()).write_text("not json")
    with pytest.raises(CacheEntryError, match=key()):
        cache.get(key())


def test_entry_with_the_wrong_shape_raises(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)
    put(cache, key())
    cache.path(key()).write_text('{"model": "m"}')
    with pytest.raises(CacheEntryError, match="invalid"):
        cache.get(key())


def test_unreadable_entry_raises(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)
    cache.path(key()).mkdir(parents=True)  # a directory where the file should be
    with pytest.raises(CacheEntryError, match="cannot be read"):
        cache.get(key())


def test_entry_that_is_not_text_raises(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)
    put(cache, key())
    cache.path(key()).write_bytes(b"\xff\xfe\x00bad")
    with pytest.raises(CacheEntryError, match="cannot be read"):
        cache.get(key())


def test_a_directory_that_cannot_be_made_fails_at_construction(tmp_path: Path) -> None:  # D11
    blocker = tmp_path / "file"
    blocker.write_text("x")
    with pytest.raises(CacheDirError, match="not usable"):
        ResponseCache(blocker / "cache")


@pytest.mark.skipif(os.geteuid() == 0, reason="root can write anywhere")
def test_a_read_only_directory_fails_at_construction(tmp_path: Path) -> None:
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        with pytest.raises(CacheDirError):
            ResponseCache(locked)
    finally:
        locked.chmod(stat.S_IRWXU)


def test_a_write_that_fails_raises_and_leaves_no_temp_file(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)
    shard = cache.path(key()).parent
    shard.mkdir(parents=True)
    cache.path(key()).mkdir()  # rename onto a directory fails
    with pytest.raises(CacheError, match="cannot be written"):
        put(cache, key())
    assert [p.name for p in shard.iterdir() if p.name.startswith(".tmp-")] == []


def test_a_write_error_names_the_entry_file_never_its_path(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)  # (the text reaches a report: no home directory in it)
    cache.path(key()).parent.write_text("in the way")
    with pytest.raises(CacheError) as caught:
        put(cache, key())
    message = str(caught.value)
    assert cache.path(key()).name in message
    assert str(tmp_path) not in message
    assert message.startswith(f"cache entry {cache.path(key()).name} cannot be written: ")


def test_a_shard_that_is_a_file_makes_the_write_fail(tmp_path: Path) -> None:
    cache = ResponseCache(tmp_path)
    cache.path(key()).parent.write_text("in the way")
    with pytest.raises(CacheError, match="cannot be written"):
        put(cache, key())
