"""`gears-service-prepare`: what has to exist before the service starts (the init containers).

    gears-service-prepare database   create the service's database if it is missing
    gears-service-prepare checkout   clone gears-rust, or fetch it if the clone is already there

`database` connects as a role that may create databases (the `PG*` environment: in the chart, the
backend's bootstrap role) and creates `GEARS_MATCHER_DATABASE` owned by
`GEARS_MATCHER_DATABASE_OWNER`, the runtime role, which cannot create one itself. The table is
made by the service at start.

`checkout` reads `GEARS_RUST_URL` and, for a private repository, `GEARS_RUST_TOKEN`, into
`GEARS_RUST_REPO`, and then fetches the commits the catalogue is read at (`GEARS_MD_REF` and
`GEARS_GDL_REF`, the pinned ones by default) by name: they need not be on any branch a clone
brings. The URL and the token may come from the config file (`GEARS_MATCHER_CONFIG`). The token is
passed to git in its environment, never on a command line or in the checkout's own config.
"""

import base64
import logging
import os
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

from gears_matcher.catalogue import PINNED_GDL_COMMIT, PINNED_MD_COMMIT
from gears_matcher.service.config import ConfigError, load_config
from gears_matcher.service.store import create_database

log = logging.getLogger("gears_matcher.service.prepare")
DEFAULT_GEARS_RUST = "https://github.com/constructorfabric/gears-rust.git"


def prepare_database(env: Mapping[str, str]) -> str:
    name = env.get("GEARS_MATCHER_DATABASE", "gears_matcher")
    owner = env.get("GEARS_MATCHER_DATABASE_OWNER") or None
    created = create_database("", name, owner)
    return f"database {name} {'created' if created else 'exists'}"


def git_env(env: Mapping[str, str]) -> dict[str, str]:
    """The environment git runs with: the token as an extra header, set through GIT_CONFIG_*."""
    out = dict(env)
    token = env.get("GEARS_RUST_TOKEN", "").strip()
    if token:
        auth = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        out |= {
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraheader",
            "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {auth}",
        }
    out["GIT_TERMINAL_PROMPT"] = "0"
    return out


def prepare_checkout(env: Mapping[str, str]) -> str:
    repo = Path(env.get("GEARS_RUST_REPO", "/var/lib/gears-matcher/gears-rust"))
    url = env.get("GEARS_RUST_URL", "").strip() or DEFAULT_GEARS_RUST
    run_env = git_env(env)
    if (repo / ".git").is_dir():
        command = ["git", "-C", str(repo), "fetch", "--quiet", "--tags", "origin"]
    else:
        repo.parent.mkdir(parents=True, exist_ok=True)
        command = ["git", "clone", "--quiet", url, str(repo)]
    subprocess.run(command, env=run_env, check=True)  # noqa: S603 -- fixed git command
    refs = [
        env.get("GEARS_MD_REF") or PINNED_MD_COMMIT,
        env.get("GEARS_GDL_REF") or PINNED_GDL_COMMIT,
    ]
    subprocess.run(  # noqa: S603
        ["git", "-C", str(repo), "fetch", "--quiet", "origin", *dict.fromkeys(refs)],  # noqa: S607
        env=run_env,
        check=True,
    )
    for ref in refs:  # each one is there now, or this fails here and not at the service's start
        subprocess.run(  # noqa: S603
            ["git", "-C", str(repo), "cat-file", "-e", f"{ref}^{{commit}}"],  # noqa: S607
            env=run_env,
            check=True,
        )
    return f"gears-rust ready at {', '.join(r[:9] for r in dict.fromkeys(refs))}"


STEPS = {"database": prepare_database, "checkout": prepare_checkout}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or args[0] not in STEPS:
        print(f"usage: gears-service-prepare {{{'|'.join(STEPS)}}}", file=sys.stderr)
        return 2
    try:
        config = os.environ.get("GEARS_MATCHER_CONFIG")
        if config:
            load_config(Path(config))
        print(STEPS[args[0]](os.environ))
    except (ConfigError, ValueError, OSError, subprocess.CalledProcessError) as exc:
        # Neither a token nor a password is in these messages: git's own output went to stderr
        # already, and the header is in the environment, not the command.
        print(f"gears-service-prepare {args[0]}: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # psycopg errors name the server and the role, never a password
        print(f"gears-service-prepare {args[0]}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
