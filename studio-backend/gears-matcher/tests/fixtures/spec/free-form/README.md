# Free-form evaluation set (T8, design note D17 and M2)

Seven invented documents that state requirements the way people actually write them, each with an
`expected.json` saying where the requirements are, what only looks like one, and what an author
should be asked about. T2 finds no CF ID in any of them, so T8 reads them.

| Case | Shape (T7 §3) | What makes it hard |
|---|---|---|
| `todo-app-prose` | messy | the todo-app PRD's 8 requirements as prose: no IDs, no MUST; goals and an out-of-scope line are not requirements; two statements share a paragraph |
| `meeting-notes` | messy | bullets, chatter, decisions, action items and a "maybe": a requirement spans a bullet and its continuation |
| `user-stories` | messy | "As a ... I want ..." with acceptance bullets: one statement over several blocks; a story marked "not planned" |
| `paragraphs` | paragraphs | flowing prose, no bullets; two statements in a paragraph (a known limit, D3); a payment step left undecided |
| `plain-lines` | lines | an email in plain text: six requirement lines with no blank line between them are one block; a quoted older figure that was corrected; a nice-to-have |
| `ids-and-tables` | messy | other ID schemes (`FR-1`, `REQ-10`, `NFR-1`) in headings, a table and bullets: the spec's own ID must be used (D5); a draft line and an optional line to ask about |
| `gaps-and-injection` | incomplete | vague statements to ask about ("secure", "fast enough"), a gap, and an instruction injected into the document |

**One format with T7's variants.** Each `expected.json` carries T7's `variant` record
(`gears_matcher.eval.records.Variant`, T7 D4): the model that wrote it, the prompt (`variant-prompt.md`,
here) and the reviewers. Six cases are invented from scratch, so they have no `derived_from` (T7's
record allows that); `todo-app-prose` is a rewrite of the todo-app PRD and says so.

**How a case is written.** A requirement is marked by `start` (and `end` for one over several blocks):
words that occur once in the document, never offsets, so the file can be edited and the check still
reads it. `not_requirements` are decoys. `known_limit` marks a statement that shares a block with
another: one block is one requirement (D3), so it cannot be found alone, and a score says so instead
of hiding it. `clarifications` anchor what an author should be asked.

**Status: a development set.** Written by `claude-sonnet-5-5` (not the extractor's model) on
2026-11-04. `variant.reviewed_by` is empty until a named person has read each case and its markings (T7
D4). Until then these are development numbers, never a held-out result, and n is small: a count
like "6 of 7" cannot tell two prompts apart.

**Use.** `uv run pytest tests/test_free_form_dataset.py` checks the set as data and reads it with
two scripted models (no model is asked). To score a real extraction:

    uv run python -m gears_matcher.extract tests/fixtures/spec/free-form/<case>/<document> \
      --max-calls 10 --out ~/extraction.json
    uv run python tests/free_form.py score <case> ~/extraction.json

That run calls a paid model (never in CI). It reports, per case, requirements found of n, the
precision of what was kept, kind agreement, decoys kept, and topics asked.

**Recorded replies.** `tests/fixtures/llm/extract-free-form.json` holds one real reply per case
(`claude-sonnet-4-6` through Constructor's LLM Connectors, prompt `v1`, recorded 2026-11-04), each
tied to the exact prompt it answered by a hash. `tests/test_extract_recorded.py` replays them and
pins what the real model did; a prompt change makes a recording stale and the test says so.
