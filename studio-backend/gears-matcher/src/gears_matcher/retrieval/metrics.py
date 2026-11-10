"""recall@k: share of gold (requirement, gear) pairs whose gear is in the requirement's top-k."""

from collections.abc import Collection, Mapping
from typing import Literal

from gears_matcher.models import Frozen
from gears_matcher.retrieval.models import RetrievalError, Shortlist

__all__ = ["Miss", "Recall", "recall_at_k"]


class Miss(Frozen):
    """A gold pair that is not in the top-k, and what can be said about why.

    `no_shared_token` is only claimed when it is provable: the requirement had no usable query, or
    the shortlist was shorter than the `k` it was retrieved with, so the gear scored 0. Otherwise
    it is `below_k`: the gear may have ranked lower, or scored 0 in a full shortlist.
    """

    requirement_id: str
    gear_id: str
    reason: Literal["below_k", "no_shared_token"]


class Recall(Frozen):
    k: int
    hits: int
    total: int  # gold pairs behind the number; shown beside it, small gold moves in big steps
    missed: tuple[Miss, ...]

    @property
    def value(self) -> float:
        return self.hits / self.total


def _reason(shortlist: Shortlist, gear_id: str) -> Literal["below_k", "no_shared_token"]:
    if gear_id in shortlist.gear_ids:
        return "below_k"
    if shortlist.status != "ok" or len(shortlist.candidates) < shortlist.k:
        return "no_shared_token"
    return "below_k"


def _check(
    shortlists: Mapping[str, Shortlist],
    gold: Mapping[str, Collection[str]],
    k: int,
    catalogue_ids: Collection[str] | None,
) -> None:
    if k < 1:
        raise RetrievalError("invalid_k", f"k must be at least 1, got {k}")
    bare = sorted(r for r, gears in gold.items() if isinstance(gears, str))
    if bare:
        raise RetrievalError("invalid_gold", f"gold for {', '.join(bare)} must be a collection")
    absent = sorted(r for r, gears in gold.items() if gears and r not in shortlists)
    if absent:
        raise RetrievalError("gold_not_retrieved", ", ".join(absent))
    too_big = sorted(r for r, gears in gold.items() if gears and shortlists[r].k < k)
    if too_big:
        raise RetrievalError("k_exceeds_retrieved", f"k={k} but retrieved with less: {too_big}")
    if catalogue_ids is not None:
        unknown = sorted({g for gears in gold.values() for g in gears} - set(catalogue_ids))
        if unknown:
            raise RetrievalError("unknown_gold_gear", ", ".join(unknown))


def recall_at_k(
    shortlists: Mapping[str, Shortlist],
    gold: Mapping[str, Collection[str]],
    k: int,
    *,
    catalogue_ids: Collection[str] | None = None,
) -> Recall:
    """Recall over requirements that have gold gears; one with none is a gap and is skipped.

    Fails loud instead of returning a number that looks like a result: `k` above what was
    retrieved, a gold requirement that was not retrieved, a gold entry that is a bare string, a
    gold gear that is not in `catalogue_ids` (when given: a typo would read as a filter miss), and
    no gold pair at all.
    """
    _check(shortlists, gold, k, catalogue_ids)
    hits = 0
    missed: list[Miss] = []
    for req_id in sorted(gold):
        for gear_id in sorted(gold[req_id]):
            if gear_id in shortlists[req_id].gear_ids[:k]:
                hits += 1
            else:
                reason = _reason(shortlists[req_id], gear_id)
                missed.append(Miss(requirement_id=req_id, gear_id=gear_id, reason=reason))
    total = hits + len(missed)
    if total == 0:
        raise RetrievalError("no_gold_pairs", "the gold has no (requirement, gear) pair to score")
    return Recall(k=k, hits=hits, total=total, missed=tuple(missed))
