"""T8: put the requirements T8 extracted beside the ones T2 read, in one `Spec` (T8 note §3, D12).

Both are `Requirement` records, so everything after this (T3 to T6) runs unchanged. The documents T8
read keep their `handed-to-t8` status and gain `extraction`: what was kept, dropped, left out, and
whether the document is incomplete.
"""

from collections import Counter

from gears_matcher.extract.models import Extraction
from gears_matcher.models import Requirement
from gears_matcher.spec.models import LoadedSpec, Spec, SpecReport


def merge(loaded: LoadedSpec, extraction: Extraction) -> Spec:
    """`loaded.spec` with `extraction`'s requirements added, in (path, line) order as T2's are."""
    spec = loaded.spec
    requirements = sorted(
        [*spec.requirements, *(e.requirement for e in extraction.extracted)],
        key=lambda r: (r.source.path, r.source.line),
    )
    outcomes = {o.path: o for o in extraction.outcomes}
    inputs = tuple(
        doc.model_copy(
            update={
                "requirements": outcomes[doc.path].kept,
                "extraction": outcomes[doc.path].counts(),
            }
        )
        if doc.path in outcomes
        else doc
        for doc in spec.inputs
    )
    return spec.model_copy(
        update={
            "requirements": tuple(requirements),
            "inputs": inputs,
            "report": _report(spec.report, requirements),
        }
    )


def _report(old: SpecReport, requirements: list[Requirement]) -> SpecReport:
    """T2's counts over all the requirements. `no_must_level` stays T2's own: free prose rarely
    writes capital MUST, so counting extracted requirements would say nothing (T8 D6)."""
    kind = Counter(r.kind for r in requirements)
    template = [r for r in requirements if r.origin == "template"]
    return old.model_copy(
        update={
            "requirements": len(requirements),
            "fr": kind["fr"],
            "nfr": kind["nfr"],
            "no_must_level": sum(r.must_level is None for r in template),
            "planned": sum(r.planned for r in requirements),
        }
    )
