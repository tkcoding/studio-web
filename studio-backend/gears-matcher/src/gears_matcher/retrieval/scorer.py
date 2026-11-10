"""T3 scoring: tf-idf over each gear's text, cosine to each requirement, top-k by score."""

from collections import Counter
from collections.abc import Sequence

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore[import-untyped]

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.models import Gear
from gears_matcher.retrieval.models import (
    Candidate,
    RequirementLike,
    RetrievalError,
    Shortlist,
)

__all__ = ["DEFAULT_K", "STOP_WORDS", "gear_text", "retrieve"]

DEFAULT_K = 10  # chosen on 6 interim gold pairs, not 0.9 (none reaches it); see the design note
SCORE_PLACES = 9  # scores that agree to this many places tie and fall back to the gear id

# Function words and modal verbs only, fixed here so a library upgrade cannot change a score.
# Content words ("system", "bill", "detail") are deliberately not in it: they name what gears do.
STOP_WORDS = frozenset(
    {
        "a",
        "about",
        "above",
        "after",
        "again",
        "against",
        "all",
        "am",
        "an",
        "and",
        "any",
        "are",
        "as",
        "at",
        "be",
        "because",
        "been",
        "before",
        "being",
        "below",
        "between",
        "both",
        "but",
        "by",
        "can",
        "could",
        "did",
        "do",
        "does",
        "doing",
        "down",
        "during",
        "each",
        "few",
        "for",
        "from",
        "further",
        "had",
        "has",
        "have",
        "having",
        "he",
        "her",
        "here",
        "hers",
        "him",
        "his",
        "how",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "itself",
        "just",
        "may",
        "me",
        "might",
        "more",
        "most",
        "must",
        "my",
        "no",
        "nor",
        "not",
        "now",
        "of",
        "off",
        "on",
        "once",
        "only",
        "or",
        "other",
        "our",
        "ours",
        "out",
        "over",
        "own",
        "same",
        "shall",
        "she",
        "should",
        "so",
        "some",
        "such",
        "than",
        "that",
        "the",
        "their",
        "theirs",
        "them",
        "then",
        "there",
        "these",
        "they",
        "this",
        "those",
        "through",
        "to",
        "too",
        "under",
        "until",
        "up",
        "very",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "while",
        "who",
        "whom",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
        "yours",
    }
)


def gear_text(gear: Gear) -> str:
    """What is indexed for a gear: name, responsibility, capabilities, gear.gdl description.

    A description identical to the responsibility (a gear known only from `gear.gdl`) counts once.
    """
    parts = [gear.name, gear.responsibility, *gear.capabilities]
    if gear.description and gear.description != gear.responsibility:
        parts.append(gear.description)
    return "\n".join(parts)


def _vectorizer() -> TfidfVectorizer:
    # Everything that decides a score is spelled out, so a library default changing cannot move it.
    return TfidfVectorizer(
        lowercase=True,
        strip_accents="unicode",
        token_pattern=r"[^\W_]{2,}",  # noqa: S106 -- a regex, not a credential
        stop_words=sorted(STOP_WORDS),
        sublinear_tf=True,
        norm="l2",
        use_idf=True,
        smooth_idf=True,
        dtype=np.float64,
    )


def retrieve(
    requirements: Sequence[RequirementLike],
    catalogue: Catalogue,
    k: int = DEFAULT_K,
) -> dict[str, Shortlist]:
    """The top-`k` gears per requirement id, best first, ties broken by gear id.

    The query is the requirement's `title` and `text`, nothing else. Raises `RetrievalError` when
    the call cannot be answered; a requirement that cannot be matched gets a status
    (`empty_query`, `no_overlap`), not an error and not a silent empty list. The tokenizer reads
    letters and digits of any script but there is no stemming or translation: English text is what
    the catalogue holds.
    """
    if k < 1:
        raise RetrievalError("invalid_k", f"k must be at least 1, got {k}")
    if not catalogue.gears:
        raise RetrievalError("empty_catalogue", "the catalogue has no gears")
    gear_counts = Counter(g.id for g in catalogue.gears)
    repeated_gears = sorted(i for i, n in gear_counts.items() if n > 1)
    if repeated_gears:
        raise RetrievalError("duplicate_gear_id", ", ".join(repeated_gears))
    requirement_counts = Counter(r.id for r in requirements)
    repeated = sorted(i for i, n in requirement_counts.items() if n > 1)
    if repeated:
        raise RetrievalError("duplicate_requirement_id", ", ".join(repeated))
    if not requirements:
        return {}

    gears = sorted(catalogue.gears, key=lambda g: g.id)
    vectorizer = _vectorizer()
    try:
        gear_matrix = vectorizer.fit_transform([gear_text(g) for g in gears])
    except ValueError as exc:  # scikit-learn: "empty vocabulary"
        raise RetrievalError("no_gear_text", "no gear has any indexable text") from exc
    queries = [f"{r.title}\n{r.text}" for r in requirements]
    query_matrix = vectorizer.transform(queries)
    scores = (
        query_matrix @ gear_matrix.T
    ).toarray()  # rows are L2-normalised: dot product = cosine

    out: dict[str, Shortlist] = {}
    for row, req in enumerate(requirements):
        if not queries[row].strip():
            out[req.id] = Shortlist(requirement_id=req.id, status="empty_query", k=k, candidates=())
        elif query_matrix[row].nnz == 0:
            out[req.id] = Shortlist(requirement_id=req.id, status="no_overlap", k=k, candidates=())
        else:
            ranked = sorted(
                (
                    (round(float(s), SCORE_PLACES), g.id)
                    for s, g in zip(scores[row], gears, strict=True)
                ),
                key=lambda pair: (-pair[0], pair[1]),
            )
            top = tuple(Candidate(gear_id=gid, score=s) for s, gid in ranked if s > 0)[:k]
            out[req.id] = Shortlist(requirement_id=req.id, status="ok", k=k, candidates=top)
    return out
