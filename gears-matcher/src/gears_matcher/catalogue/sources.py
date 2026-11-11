"""Read-only views of a `gears-rust` tree: a git ref (real runs) or a plain directory (fixtures)."""

import hashlib
import os
import posixpath
import re
import stat
import subprocess
from pathlib import Path
from typing import Protocol

GIT_TIMEOUT_SECONDS = 60
BUNDLE_MAX_BYTES = 5_000_000  # the reference bundle is about 300 KB
# One line opens each gear of a bundle: `# ===== gears/system/x/gear.gdl =====`.
_BUNDLE_MARKER = re.compile(r"^# ===== (\S+) =====[ \t]*$", re.MULTILINE)


class GitError(RuntimeError):
    """A `git` call failed; the message carries git's own stderr."""


class Tree(Protocol):
    @property
    def commit(self) -> str | None: ...

    def paths(self) -> list[str]: ...

    def read(self, path: str) -> str: ...


class GitTree:
    """Files of `repo` at `ref`, read with `git` without touching the working tree."""

    def __init__(self, repo: Path, ref: str) -> None:
        self._repo = repo
        self.ref = ref
        self._commit = self._git("rev-parse", "--verify", f"{ref}^{{commit}}").strip()

    @property
    def commit(self) -> str:
        return self._commit

    def _git(self, *args: str) -> str:
        cmd = ["git", "-C", str(self._repo), *args]
        try:
            done = subprocess.run(  # noqa: S603 -- fixed argv, no shell; `ref`/`path` are values, not options
                cmd,
                capture_output=True,
                encoding="utf-8",
                check=True,
                timeout=GIT_TIMEOUT_SECONDS,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or "").strip() or f"exit status {exc.returncode}"
            raise GitError(f"`git {' '.join(args)}` failed in {self._repo}: {detail}") from exc
        except subprocess.TimeoutExpired as exc:
            raise GitError(
                f"`git {' '.join(args)}` timed out after {GIT_TIMEOUT_SECONDS}s in {self._repo}"
            ) from exc
        except OSError as exc:
            raise GitError(f"cannot run git: {exc}") from exc
        return done.stdout

    def paths(self) -> list[str]:
        return self._git("ls-tree", "-r", "--name-only", self.commit).splitlines()

    def read(self, path: str) -> str:
        return self._git("show", f"{self.commit}:{path}")


class DirTree:
    """Files under `root`; `commit` is whatever the caller says the directory represents."""

    def __init__(self, root: Path, commit: str | None = None) -> None:
        self._root = root
        self._commit = commit

    @property
    def commit(self) -> str | None:
        return self._commit

    def paths(self) -> list[str]:
        return sorted(
            p.relative_to(self._root).as_posix() for p in self._root.rglob("*") if p.is_file()
        )

    def read(self, path: str) -> str:
        return (self._root / path).read_text(encoding="utf-8")


class BundleError(ValueError):
    """A gear bundle cannot be used; the message says why."""


def split_bundle(text: str) -> dict[str, str]:
    """A bundle (`examples/gears.gdl`) as the `gear.gdl` files it holds, by repository path.

    Text before the first marker is the bundle's own header and is dropped. A path must be a
    relative `gear.gdl` path inside the repository, and each path may appear once.
    """
    marks = list(_BUNDLE_MARKER.finditer(text))
    if not marks:
        raise BundleError("no `# ===== path/gear.gdl =====` markers: not a gear bundle")
    files: dict[str, str] = {}
    for i, mark in enumerate(marks):
        path = mark.group(1)
        clean = posixpath.normpath(path)
        if clean != path or path.startswith(("/", "../")) or posixpath.basename(path) != "gear.gdl":
            raise BundleError(f"marker path `{path[:80]}` is not a relative gear.gdl path")
        if path in files:
            raise BundleError(f"`{path}` appears twice")
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        files[path] = text[mark.end() : end].strip("\n") + "\n"
    return files


class BundleTree:
    """A tree with some `gear.gdl` files replaced by the text of a bundle.

    Only a path `base` already has is replaced: `paths()` is the base's, so the catalogue never
    reads a bundle gear with no file in `base`; those are listed in `unused`. A bundle cannot add a
    gear the pinned checkout does not know (it would duplicate or contradict the `GEARS.md`
    section). Every other file comes from `base`. The
    `commit` names both, so a report says which sources it used.
    """

    def __init__(self, base: Tree, bundle_text: str) -> None:
        self._base = base
        self._files = split_bundle(bundle_text)
        self.unused = tuple(sorted(set(self._files) - set(base.paths())))
        digest = hashlib.sha256(bundle_text.encode("utf-8")).hexdigest()[:12]
        self._commit = f"{base.commit}+bundle-{digest}" if base.commit else f"bundle-{digest}"

    @property
    def commit(self) -> str:
        return self._commit

    def paths(self) -> list[str]:
        return self._base.paths()

    def read(self, path: str) -> str:
        return self._files[path] if path in self._files else self._base.read(path)


def read_bundle(path: Path) -> str:
    """The bundle's text, bounded and read as UTF-8.

    The file is opened without blocking and must be a regular file, so a named pipe (whose `stat`
    size is 0 and whose `open` waits for a writer) is refused instead of hanging. At most
    `BUNDLE_MAX_BYTES + 1` bytes are read, so a file that grows after the check is bounded too.
    """
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "rb") as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise BundleError(f"{path.name}: not a regular file")
            raw = handle.read(BUNDLE_MAX_BYTES + 1)
        if len(raw) > BUNDLE_MAX_BYTES:
            raise BundleError(f"{path.name}: larger than {BUNDLE_MAX_BYTES // 1_000_000} MB")
        return raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise BundleError(f"{path.name}: cannot be read as text ({type(exc).__name__})") from exc
