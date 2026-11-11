"""T3 candidate retrieval: ranking, determinism, k, error kinds, query isolation, recall@k."""

from pathlib import Path
from typing import NamedTuple

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gears_matcher.catalogue import build_catalogue
from gears_matcher.catalogue.aliases import GDL_TO_MD
from gears_matcher.catalogue.models import Catalogue, ParseReport
from gears_matcher.catalogue.sources import DirTree
from gears_matcher.models import Gear, SourceRef
from gears_matcher.retrieval import (
    DEFAULT_K,
    STOP_WORDS,
    Miss,
    RetrievalError,
    Shortlist,
    gear_text,
    recall_at_k,
    retrieve,
    scorer,
)
from gears_matcher.spec import load_spec

SRC = (SourceRef(kind="gears-md", path="docs/GEARS.md", line=1),)


class Req(NamedTuple):
    id: str
    title: str
    text: str


def gear(
    name: str, responsibility: str, caps: tuple[str, ...] = (), description: str | None = None
) -> Gear:
    return Gear(
        id=f"gears-rust/{name}",
        name=name,
        category=None,
        responsibility=responsibility,
        description=description,
        capabilities=caps,
        sources=SRC,
    )


def catalogue(*gears: Gear) -> Catalogue:
    report = ParseReport(
        md_sections=0, md_skipped=(), gdl_gears=0, gdl_plugins=0, gdl_skipped=(),
        joined=0, md_only=(), gdl_only=(), markers_stripped=0,
    )  # fmt: skip
    return Catalogue(gears_md_commit=None, gear_gdl_commit=None, gears=gears, report=report)


CAT = catalogue(
    gear("event-broker", "Publish and subscribe to typed events", ("event replay",)),
    gear("credstore", "Secure secret storage for credentials", ("rotate secrets",)),
    gear(
        "registry",
        "Durable CRUD storage for typed resources",
        ("create resources", "filter resources"),
    ),
    gear("search", "Full text search over documents", ("keyword queries",)),
)


def ids(s: Shortlist) -> list[str]:
    return [g.removeprefix("gears-rust/") for g in s.gear_ids]


def test_ranks_the_best_match_first() -> None:
    out = retrieve([Req("r1", "Store secrets", "Credentials must be stored securely")], CAT, k=2)
    assert ids(out["r1"])[0] == "credstore"
    assert out["r1"].status == "ok"
    scores = [c.score for c in out["r1"].candidates]
    assert scores == sorted(scores, reverse=True)
    assert all(0 < s <= 1 for s in scores)


def test_k_limits_and_k_above_catalogue_is_fine() -> None:
    req = [Req("r1", "Resources", "typed resources with events and search")]
    assert len(retrieve(req, CAT, k=1)["r1"].candidates) == 1
    assert 1 < len(retrieve(req, CAT, k=1000)["r1"].candidates) <= len(CAT.gears)


def test_only_gears_that_share_a_token_are_candidates() -> None:
    out = retrieve([Req("r1", "Secrets", "rotate secrets")], CAT, k=10)
    assert ids(out["r1"]) == ["credstore"]  # not padded to k with zero-score gears


def test_ties_break_by_gear_id() -> None:
    twins = catalogue(
        gear("zeta", "shared widget"), gear("alpha", "shared widget"), gear("mid", "shared widget")
    )
    out = retrieve([Req("r1", "widget", "shared widget")], twins, k=3)
    assert ids(out["r1"]) == ["alpha", "mid", "zeta"]
    assert len({c.score for c in out["r1"].candidates}) == 1


def test_same_output_on_every_run_and_input_order() -> None:
    reqs = [
        Req("a", "Events", "publish typed events"),
        Req("b", "Search", "keyword search over documents"),
    ]
    first = retrieve(reqs, CAT, k=3)
    assert retrieve(reqs, CAT, k=3) == first
    shuffled = catalogue(*reversed(CAT.gears))
    assert retrieve(reqs, shuffled, k=3) == first


def test_pinned_scores_on_the_fixture() -> None:
    out = retrieve([Req("r1", "Events", "publish events")], CAT, k=1)
    assert out["r1"].candidates[0].gear_id == "gears-rust/event-broker"
    # Derived by hand, not with scikit-learn: smoothed idf, (1 + ln tf), L2 norm, dot product.
    assert out["r1"].candidates[0].score == 0.470084362


def test_no_overlap_is_a_status_not_an_error_and_not_an_empty_ok() -> None:
    out = retrieve([Req("r1", "Zzz", "qqqq xxxx"), Req("r2", "Events", "typed events")], CAT)
    assert out["r1"].status == "no_overlap"
    assert out["r1"].candidates == ()
    assert out["r2"].status == "ok"  # one odd requirement does not stop the others


@pytest.mark.parametrize(("title", "text"), [("", ""), ("  ", "\n\t")])
def test_blank_query_is_its_own_status(title: str, text: str) -> None:
    out = retrieve([Req("r1", title, text)], CAT)
    assert out["r1"].status == "empty_query"  # not a vocabulary mismatch
    assert out["r1"].candidates == ()


def test_accents_are_folded_not_split_into_fragments() -> None:
    cat = catalogue(gear("resume", "Parse a résumé file"), gear("sum", "Sum of numbers"))
    assert ids(retrieve([Req("r1", "t", "resume")], cat)["r1"]) == ["resume"]
    assert ids(retrieve([Req("r1", "t", "résumé")], cat)["r1"]) == ["resume"]  # no "sum" fragment


def test_non_latin_text_is_no_overlap_not_a_crash() -> None:
    assert retrieve([Req("r1", "t", "日本語のテキスト")], CAT)["r1"].status == "no_overlap"


def test_rounding_ties_fall_back_to_gear_id(monkeypatch: pytest.MonkeyPatch) -> None:
    cat = catalogue(gear("b", "alpha beta"), gear("a", "alpha beta beta beta gamma delta"))
    req = [Req("r1", "t", "alpha beta")]
    before = ids(retrieve(req, cat)["r1"])
    scores = [c.score for c in retrieve(req, cat)["r1"].candidates]
    assert scores[0] != scores[1]  # different at full precision, so the order is by score
    monkeypatch.setattr(scorer, "SCORE_PLACES", 0)
    tied = retrieve(req, cat)["r1"]
    assert len({c.score for c in tied.candidates}) == 1
    assert ids(tied) == ["a", "b"]  # rounding made them equal; the gear id decides
    assert before != ["a", "b"]


def test_content_words_are_not_stop_words() -> None:
    assert not {"system", "bill", "detail", "payment", "user", "event"} & STOP_WORDS
    cat = catalogue(gear("billing", "Bill customers"), gear("other", "Something else"))
    assert ids(retrieve([Req("r1", "t", "bill")], cat)["r1"]) == ["billing"]


def test_duplicate_gear_ids_raise() -> None:
    twin = catalogue(gear("a", "alpha"), gear("a", "beta"))
    with pytest.raises(RetrievalError) as exc:
        retrieve([Req("r1", "t", "alpha")], twin)
    assert exc.value.kind == "duplicate_gear_id"


def test_shortlist_remembers_the_k_it_was_retrieved_with() -> None:
    assert retrieve([Req("r1", "t", "events")], CAT, k=3)["r1"].k == 3


def test_stop_words_alone_are_no_overlap() -> None:
    assert retrieve([Req("r1", "The", "the and of")], CAT)["r1"].status == "no_overlap"


@pytest.mark.parametrize("k", [0, -3])
def test_k_below_one_raises(k: int) -> None:
    with pytest.raises(RetrievalError) as exc:
        retrieve([Req("r1", "t", "events")], CAT, k=k)
    assert exc.value.kind == "invalid_k"


def test_empty_catalogue_raises() -> None:
    with pytest.raises(RetrievalError) as exc:
        retrieve([Req("r1", "t", "events")], catalogue(), k=3)
    assert exc.value.kind == "empty_catalogue"


def test_catalogue_without_indexable_text_raises() -> None:
    with pytest.raises(RetrievalError) as exc:
        retrieve([Req("r1", "t", "events")], catalogue(gear("x", "the of")), k=3)
    assert exc.value.kind == "no_gear_text"


def test_duplicate_requirement_ids_raise() -> None:
    with pytest.raises(RetrievalError) as exc:
        retrieve([Req("r1", "a", "events"), Req("r1", "b", "search")], CAT)
    assert exc.value.kind == "duplicate_requirement_id"


def test_no_requirements_is_an_empty_answer() -> None:
    assert retrieve([], CAT) == {}


def test_default_k_is_a_positive_int() -> None:
    assert DEFAULT_K >= 1


class WithContext(NamedTuple):
    id: str
    title: str
    text: str
    context: str  # a field T3 must never read, e.g. a traceability table naming gears


def test_only_title_and_text_reach_the_query() -> None:
    plain = retrieve([Req("r1", "Events", "typed events")], CAT, k=4)
    leaky = retrieve(
        [WithContext("r1", "Events", "typed events", "credstore secrets search")], CAT, k=4
    )
    assert leaky == plain


def test_markdown_in_text_is_not_a_token() -> None:
    marked = Req("r1", "t", "**publish** `typed` _events_")
    assert retrieve([marked], CAT) == retrieve([Req("r1", "t", "publish typed events")], CAT)


def test_known_limit_vocabulary_mismatch_is_missed() -> None:
    """The trap in the issue: no shared token, no candidate. Embeddings are a separate follow-up."""
    cat = catalogue(gear("billing", "Invoices and subscription charges for customers"))
    out = retrieve([Req("r1", "Card payment", "Users pay with a card")], cat)
    assert out["r1"].status == "no_overlap"


def test_gear_text_uses_every_field_and_counts_a_repeated_description_once() -> None:
    g = gear("registry", "Durable CRUD", ("filter resources",), description="Typed storage")
    assert gear_text(g) == "registry\nDurable CRUD\nfilter resources\nTyped storage"
    same = gear("x", "Same words", description="Same words")
    assert gear_text(same).count("Same words") == 1


def test_description_is_searchable() -> None:
    cat = catalogue(
        gear("a", "alpha thing", description="uniqueterm lives here"), gear("b", "beta thing")
    )
    assert ids(retrieve([Req("r1", "t", "uniqueterm")], cat)["r1"]) == ["a"]


# --- recall@k ---------------------------------------------------------------------------


def _answers() -> dict[str, Shortlist]:
    return retrieve(
        [Req("r1", "Events", "publish typed events"), Req("r2", "Secrets", "rotate secrets")],
        CAT,
        k=3,
    )


def test_recall_counts_hits_and_misses_with_the_pairs_behind_it() -> None:
    gold = {"r1": {"gears-rust/event-broker", "gears-rust/search"}, "r2": {"gears-rust/credstore"}}
    r = recall_at_k(_answers(), gold, k=3)
    assert (r.hits, r.total) == (2, 3)
    assert r.missed == (
        Miss(requirement_id="r1", gear_id="gears-rust/search", reason="no_shared_token"),
    )
    assert r.value == pytest.approx(2 / 3)


def test_recall_respects_k() -> None:
    answers = retrieve([Req("r1", "t", "typed resources events search")], CAT, k=4)
    gold = {"r1": {answers["r1"].gear_ids[-1]}}
    assert recall_at_k(answers, gold, k=4).hits == 1
    assert recall_at_k(answers, gold, k=1).hits == 0


def test_recall_cannot_exceed_the_k_it_was_retrieved_with() -> None:
    answers = retrieve([Req("r1", "t", "typed resources events search")], CAT, k=1)
    with pytest.raises(RetrievalError) as exc:
        recall_at_k(answers, {"r1": {"gears-rust/search"}}, k=4)
    assert exc.value.kind == "k_exceeds_retrieved"
    assert recall_at_k(answers, {"r1": set(answers["r1"].gear_ids)}, k=1).hits == 1


def test_a_bare_string_is_not_a_gold_set() -> None:
    with pytest.raises(RetrievalError) as exc:
        recall_at_k(_answers(), {"r1": "gears-rust/search"}, k=3)
    assert exc.value.kind == "invalid_gold"


def test_an_unknown_gold_gear_is_not_a_filter_miss() -> None:
    known = {g.id for g in CAT.gears}
    gold = {"r1": {"gears-rust/evnt-broker"}}  # a typo
    with pytest.raises(RetrievalError) as exc:
        recall_at_k(_answers(), gold, k=3, catalogue_ids=known)
    assert exc.value.kind == "unknown_gold_gear"
    assert recall_at_k(_answers(), gold, k=3).total == 1  # without the ids it cannot know


def test_misses_say_whether_the_gear_ranked_low_or_shared_nothing() -> None:
    cat = catalogue(*(gear(f"g{i}", f"widget part{i}") for i in range(4)), gear("far", "unrelated"))
    answers = retrieve([Req("r1", "t", "widget part0")], cat, k=2)
    gold = {"r1": {"gears-rust/g3", "gears-rust/far"}}
    by_gear = {m.gear_id: m.reason for m in recall_at_k(answers, gold, k=2).missed}
    assert by_gear["gears-rust/g3"] == "below_k"  # full shortlist: cannot claim it scored 0
    wide = retrieve([Req("r1", "t", "widget part0")], cat, k=10)
    by_gear = {m.gear_id: m.reason for m in recall_at_k(wide, gold, k=10).missed}
    assert by_gear["gears-rust/far"] == "no_shared_token"  # shortlist shorter than k: scored 0
    blank = retrieve([Req("r1", "", "")], cat, k=2)
    only = recall_at_k(blank, {"r1": {"gears-rust/g0"}}, k=2).missed
    assert [m.reason for m in only] == ["no_shared_token"]


def test_gap_requirements_with_no_gold_gears_are_skipped() -> None:
    gold = {"r1": {"gears-rust/event-broker"}, "r2": set[str]()}
    assert recall_at_k(_answers(), gold, k=3).total == 1


def test_recall_fails_loud_on_bad_input() -> None:
    answers = _answers()
    with pytest.raises(RetrievalError) as exc:
        recall_at_k(answers, {"r1": {"gears-rust/event-broker"}}, k=0)
    assert exc.value.kind == "invalid_k"
    with pytest.raises(RetrievalError) as exc:
        recall_at_k(answers, {"nope": {"gears-rust/event-broker"}}, k=3)
    assert exc.value.kind == "gold_not_retrieved"
    with pytest.raises(RetrievalError) as exc:
        recall_at_k(answers, {"r1": set[str]()}, k=3)
    assert exc.value.kind == "no_gold_pairs"


# --- wiring: T2's real requirements into T3 (CONTRIBUTING B7) ------------------------------------

FIXTURES = Path(__file__).parent / "fixtures"


class _FixtureMd(DirTree):
    """T1's excerpt lives at tests/fixtures/GEARS.md; the parser asks for docs/GEARS.md."""

    def __init__(self) -> None:
        super().__init__(FIXTURES, "md-sha")

    def read(self, path: str) -> str:
        return (FIXTURES / "GEARS.md").read_text()


def test_t2_requirements_flow_through_retrieve_on_t1s_fixture_catalogue() -> None:
    """Runs everywhere (no gears-rust). Passing `Requirement` to `retrieve` also makes strict mypy
    check that T2's model satisfies `RequirementLike`."""
    reqs = load_spec(FIXTURES / "spec/todo-app/PRD.md").requirements
    aliases = {k: v for k, v in GDL_TO_MD.items() if k in {"event-broker", "authn-resolver"}}
    fixture = build_catalogue(_FixtureMd(), DirTree(FIXTURES / "gdl", "gdl-sha"), aliases=aliases)
    out = retrieve(reqs, fixture, k=3)
    assert list(out) == [r.id for r in reqs]  # one shortlist per requirement, in PRD order
    assert len(reqs) == 8
    known = {g.id for g in fixture.gears}
    for shortlist in out.values():
        assert len(shortlist.candidates) <= 3
        assert set(shortlist.gear_ids) <= known
        assert (shortlist.status == "ok") == bool(shortlist.candidates)
    assert any(s.status == "ok" for s in out.values())


# --- properties (CONTRIBUTING §3) ---------------------------------------------------------------

_WORDS = st.sampled_from(
    ["event", "events", "secret", "store", "search", "task", "tasks", "feed", "typed", "queue"]
)
_TEXT = st.lists(_WORDS, max_size=6).map(" ".join)
_GEAR_TEXT = st.lists(_WORDS, min_size=1, max_size=6).map(
    " ".join
)  # `no_gear_text` has its own test
_GEARS = st.lists(
    st.tuples(st.from_regex(r"[a-z]{1,6}", fullmatch=True), _GEAR_TEXT),
    min_size=1,
    max_size=8,
    unique_by=lambda t: t[0],
)


@settings(max_examples=60, deadline=None)
@given(gears=_GEARS, query=_TEXT, k=st.integers(min_value=1, max_value=10))
def test_shortlists_are_bounded_sorted_scored_and_order_independent(
    gears: list[tuple[str, str]], query: str, k: int
) -> None:
    cat = catalogue(*(gear(name, text) for name, text in gears))
    req = [Req("r1", "t", query)]
    shortlist = retrieve(req, cat, k=k)["r1"]
    keys = [(-c.score, c.gear_id) for c in shortlist.candidates]
    assert len(shortlist.candidates) <= min(k, len(gears))
    assert keys == sorted(keys)
    assert all(0 < c.score <= 1 for c in shortlist.candidates)
    assert retrieve(req, catalogue(*reversed(cat.gears)), k=k)["r1"] == shortlist
