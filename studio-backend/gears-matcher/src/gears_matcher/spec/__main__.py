"""`python -m gears_matcher.spec <bundle> [--product ID] [--out spec.json]`: read and summarise.

Exit codes: 0 read cleanly · 1 read, with errors in the report · 2 the input cannot be read.
"""

import argparse
import sys
import unicodedata
from pathlib import Path

from gears_matcher.spec.bundle import SUPPORTING, SpecError, load_spec


def _plain(text: str) -> str:
    """`text` safe for a terminal: control and format characters (escape sequences) become `?`.

    Newlines and tabs are kept: a multi-line error stays readable and cannot drive the terminal.
    """
    return "".join(
        "?" if c not in "\n\t" and unicodedata.category(c).startswith("C") else c for c in text
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Read a product spec bundle's CF requirements.")
    ap.add_argument("path", type=Path, help="bundle folder, product folder, or one Markdown file")
    ap.add_argument("--product", help="product id, when the manifest lists several")
    ap.add_argument("--out", type=Path, help="write the spec JSON here")
    args = ap.parse_args(argv)

    try:
        spec = load_spec(args.path, args.product)
    except SpecError as exc:  # NotATemplate included
        print(f"error: {_plain(str(exc))}", file=sys.stderr)
        return 2
    r = spec.report
    if args.out:
        args.out.write_text(spec.model_dump_json(indent=2) + "\n", encoding="utf-8")
    print(_plain(f"{spec.product_id} @ {spec.commit or 'unknown commit'}: {spec.name}"))
    print(
        f"requirements: {r.requirements} ({r.fr} FR, {r.nfr} NFR;"
        f" {r.no_must_level} without MUST/SHALL/SHOULD/MAY; {r.planned} planned)"
    )
    print(f"documents: {r.read} read, {r.handed_to_t8} handed to T8, {r.skipped} skipped")
    for doc in spec.inputs:
        if doc.reason != SUPPORTING:  # supporting documents are counted, not listed
            print(_plain(f"  {doc.status:<12} {doc.path} — {doc.reason}"))
    for issue in r.errors:
        print(_plain(f"ERROR {issue.kind}: {issue.message} ({issue.where})"), file=sys.stderr)
    return 1 if r.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
