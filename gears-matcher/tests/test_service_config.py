"""The config file holds the service's keys; the environment wins over it; nothing is printed."""

import os
import subprocess
from pathlib import Path

import pytest

from gears_matcher.service.config import ConfigError, load_config
from gears_matcher.service.prepare import git_env, prepare_checkout, prepare_database
from gears_matcher.service.store import RunStore

FULL = """
shared_secret = "s3cret"

[llm]
access_key = "the-key"
stand = "stand.example"
cmodel_id = "cm"
public_connector_id = "pc"

[gears_rust]
url = "https://example.invalid/gears-rust.git"
token = "tok"

[database]
url = "postgresql://u:p@db/gears_matcher"
"""


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_every_value_becomes_its_variable(tmp_path: Path) -> None:
    env: dict[str, str] = {}
    load_config(write(tmp_path, FULL), env)
    assert env == {
        "GEARS_MATCHER_SECRET": "s3cret",
        "LLM_CONNECTORS_ACCESS_KEY": "the-key",
        "CONSTRUCTOR_STAND": "stand.example",
        "CONSTRUCTOR_CMODEL_ID": "cm",
        "CONSTRUCTOR_PUBLIC_CONNECTOR_ID": "pc",
        "GEARS_RUST_URL": "https://example.invalid/gears-rust.git",
        "GEARS_RUST_TOKEN": "tok",
        "GEARS_MATCHER_DATABASE_URL": "postgresql://u:p@db/gears_matcher",
    }


def test_the_environment_wins_over_the_file(tmp_path: Path) -> None:
    env = {"LLM_CONNECTORS_ACCESS_KEY": "from-env", "CONSTRUCTOR_STAND": "  "}
    load_config(write(tmp_path, FULL), env)
    assert env["LLM_CONNECTORS_ACCESS_KEY"] == "from-env"
    assert env["CONSTRUCTOR_STAND"] == "stand.example", "a blank variable is not a value"


@pytest.mark.parametrize(
    ("text", "said"),
    [
        ('[llm]\naccess_kye = "x"\n', "unknown key llm.access_kye"),
        ('sharedsecret = "x"\n', "unknown key sharedsecret"),
        ("[llm]\nstand = 3\n", "llm.stand must be a string"),
        ('llm = "x"\n', "[llm] must be a section"),
        ("shared_secret = \n", "not valid TOML"),
    ],
)
def test_a_wrong_file_is_refused_and_names_the_key_not_the_value(
    tmp_path: Path, text: str, said: str
) -> None:
    with pytest.raises(ConfigError, match=said.replace("[", r"\[").replace("]", r"\]")) as caught:
        load_config(write(tmp_path, text), {})
    assert '"x"' not in str(caught.value)


def test_a_missing_file_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="no such config file"):
        load_config(tmp_path / "absent.toml", {})


def test_the_clone_token_goes_to_git_in_its_environment_only() -> None:
    env = git_env({"GEARS_RUST_TOKEN": "tok", "PATH": "/bin"})
    assert env["GIT_CONFIG_KEY_0"] == "http.extraheader"
    assert env["GIT_CONFIG_VALUE_0"].startswith("AUTHORIZATION: basic ")
    assert "tok" not in env["GIT_CONFIG_VALUE_0"], "base64, as git sends it"
    assert "GIT_CONFIG_COUNT" not in git_env({"PATH": "/bin"}), "no token, no header"


def test_prepare_creates_the_database_once_and_the_store_makes_its_table(
    pg_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psycopg  # noqa: PLC0415
    from psycopg import conninfo, sql  # noqa: PLC0415

    name = "gm_prepare_probe"
    for key, value in conninfo.conninfo_to_dict(pg_url).items():
        if value is not None and key in {"host", "port", "user", "password", "dbname"}:
            monkeypatch.setenv({"dbname": "PGDATABASE"}.get(key, f"PG{key.upper()}"), str(value))
    env = {"GEARS_MATCHER_DATABASE": name}
    try:
        assert prepare_database(env) == f"database {name} created"
        assert prepare_database(env) == f"database {name} exists"
        store = RunStore(conninfo.make_conninfo(pg_url, dbname=name))
        store.ping()
        store.close()
    finally:
        with psycopg.connect(pg_url, autocommit=True) as db:
            drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)")
            db.execute(drop.format(sql.Identifier(name)))


def test_an_unsafe_database_name_is_refused() -> None:
    with pytest.raises(ValueError, match="unsafe database name"):
        prepare_database({"GEARS_MATCHER_DATABASE": 'x"; DROP'})


def _git(cwd: Path, *args: str) -> str:
    done = subprocess.run(  # noqa: S603
        ["git", "-C", str(cwd), *args],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, **_AUTHOR},
    )
    return done.stdout.strip()


_AUTHOR = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.invalid",
}


def _commit(src: Path, text: str) -> str:
    (src / "docs").mkdir(exist_ok=True)
    (src / "docs" / "GEARS.md").write_text(text, encoding="utf-8")
    _git(src, "add", "-A")
    _git(src, "commit", "--quiet", "-m", text)
    return _git(src, "rev-parse", "HEAD")


def test_checkout_of_a_branch_is_shallow_and_follows_its_tip(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    _git(src, "init", "--quiet", "--initial-branch", "corpus")
    _commit(src, "one")
    first = _commit(src, "two")
    env = {
        **os.environ,
        "GEARS_RUST_URL": src.as_uri(),
        "GEARS_RUST_BRANCH": "corpus",
        "GEARS_RUST_REPO": str(tmp_path / "clone"),
    }
    clone = tmp_path / "clone"

    assert prepare_checkout(env) == f"gears-rust ready corpus at {first[:9]}"
    assert _git(clone, "rev-parse", "HEAD") == first
    assert _git(clone, "rev-parse", "--is-shallow-repository") == "true"
    assert not (clone / "docs").exists(), "the service reads git objects, not a working tree"

    second = _commit(src, "three")
    assert prepare_checkout(env) == f"gears-rust ready corpus at {second[:9]}"
    assert _git(clone, "show", "HEAD:docs/GEARS.md") == "three"


def test_checkout_without_a_branch_fetches_the_named_commits(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    _git(src, "init", "--quiet", "--initial-branch", "main")
    md = _commit(src, "md")
    gdl = _commit(src, "gdl")
    env = {
        **os.environ,
        "GEARS_RUST_URL": src.as_uri(),
        "GEARS_RUST_REPO": str(tmp_path / "clone"),
        "GEARS_MD_REF": md,
        "GEARS_GDL_REF": gdl,
    }
    assert prepare_checkout(env) == f"gears-rust ready at {md[:9]}, {gdl[:9]}"
    assert prepare_checkout(env) == f"gears-rust ready at {md[:9]}, {gdl[:9]}", (
        "a fetch the second time"
    )
