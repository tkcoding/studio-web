"""`python -m gears_matcher.catalogue --repo ../gears-rust --out catalogue.json`: parse and dump."""

import argparse
import sys
from pathlib import Path

from gears_matcher.catalogue.build import (
    PINNED_GDL_COMMIT,
    PINNED_MD_COMMIT,
    build_from_repo,
)
from gears_matcher.catalogue.sources import GitError


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build the Gear catalogue from a gears-rust checkout.")
    ap.add_argument("--repo", type=Path, required=True, help="gears-rust git checkout")
    ap.add_argument(
        "--md-ref",
        default=PINNED_MD_COMMIT,
        help="ref/commit to read docs/GEARS.md at (default: pinned; `origin/main` to follow)",
    )
    ap.add_argument(
        "--gdl-ref",
        default=PINNED_GDL_COMMIT,
        help="ref/commit to read gear.gdl files at",
    )
    ap.add_argument("--out", type=Path, help="write the catalogue JSON here")
    args = ap.parse_args(argv)

    try:
        cat = build_from_repo(args.repo, args.md_ref, args.gdl_ref)
    except GitError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    r = cat.report
    if args.out:
        args.out.write_text(cat.model_dump_json(indent=2) + "\n", encoding="utf-8")
    print(
        f"GEARS.md @ {cat.gears_md_commit}: {r.md_sections} sections"
        f" (skipped: {', '.join(r.md_skipped) or 'none'})"
    )
    print(
        f"gear.gdl @ {cat.gear_gdl_commit}: {r.gdl_gears} gears + {r.gdl_plugins} plugins"
        f" ({len(r.gdl_skipped)} skipped)"
    )
    print(
        f"joined: {r.joined}; only in GEARS.md: {len(r.md_only)};"
        f" only in gear.gdl: {len(r.gdl_only)}"
    )
    for gid in r.gdl_only:
        print(f"  gear.gdl only: {gid}")
    for issue in r.issues:
        if issue.severity == "error":
            print(f"ERROR {issue.kind}: {issue.message} ({issue.where})", file=sys.stderr)
    return 1 if r.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
