"""T8: generated documents with planted requirements (CONTRIBUTING §3, property-based)."""

import json
import string
import tempfile
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from gears_matcher.extract import Extractor
from gears_matcher.extract.prompt import unescape_quote
from gears_matcher.judge.llm.schema import ModelOutput
from gears_matcher.spec.models import Document

_WORD = st.text(alphabet=string.ascii_lowercase, min_size=2, max_size=9)
_SENTENCE = st.lists(_WORD, min_size=3, max_size=8).map(" ".join)
_FILLER = st.sampled_from(
    [
        "",
        "Background text that states nothing.",
        "## Another section",
        "<!-- a comment with words in it -->",
        "```\ncode with words in it\n```",
        "| a | b |",
    ]
)


class Planted:
    """A model that quotes every planted sentence present in its excerpt, plus one invention."""

    def __init__(self, sentences: list[str]) -> None:
        self.sentences = sentences

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        excerpt = unescape_quote(user.split("<excerpt>\n", 1)[1].rsplit("\n</excerpt>", 1)[0])
        quotes = [s for s in self.sentences if s in excerpt]
        items = [{"quote": q, "kind": "fr"} for q in quotes]
        items.append({"quote": "an invented statement zzqx that is nowhere", "kind": "fr"})
        return ModelOutput(text=json.dumps({"items": items}), input_tokens=1, output_tokens=1)


@given(
    st.lists(_SENTENCE, min_size=1, max_size=15, unique=True),
    st.lists(_FILLER, min_size=1, max_size=15),
    st.integers(60, 400),
)
@settings(max_examples=120, deadline=None)
def test_every_planted_requirement_is_found_once_at_its_exact_offsets(
    sentences: list[str], filler: list[str], chunk_chars: int
) -> None:
    planted = [
        f"{s} qq{i}" for i, s in enumerate(sentences)
    ]  # a unique tail: no sentence contains another
    parts = ["# Title", ""]
    for i, sentence in enumerate(planted):
        parts += [f"- The product must {sentence}.", "", filler[i % len(filler)], ""]
    text = "\n".join(parts) + "\n"
    with tempfile.TemporaryDirectory() as folder:
        extractor = Extractor(
            Planted(planted),
            Path(folder),
            model="planted",
            max_calls=500,
            chunk_chars=chunk_chars,
        )
        result = extractor.extract([Document(path="spec.md", text=text)])
    assert result.report.chunks_failed == 0
    texts = [e.requirement.text for e in result.extracted]
    assert texts == [f"- The product must {s}." for s in planted]  # each once, in order
    for e, sentence in zip(result.extracted, planted, strict=True):
        assert text[e.span.start : e.span.end] == f"- The product must {sentence}."
    assert all("zzqx" not in e.requirement.text for e in result.extracted)  # the invention is gone
    assert result.report.dropped_total >= 1
