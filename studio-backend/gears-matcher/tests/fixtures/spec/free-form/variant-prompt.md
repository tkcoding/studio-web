# The brief the free-form cases were written from

This is the prompt (T7 D4: "the model, its version and the prompt are committed next to the
variant"). It was given in a chat session on 2026-11-04 and is written down here from that
instruction; it is not a verbatim transcript.

**Model:** `claude-sonnet-5-5` (not the model the extractor runs on, `claude-sonnet-4-6`).

**Instruction:** create datasets of different free-form specifications to test T8, the extraction
of requirements from specifications that do not follow the CF template, and keep them in the
repository as tests.

**How it was done**

1. Cover T7's free-form shapes (§3): *messy* (notes, user stories, a prose rewrite), *paragraphs*,
   *lines*, *incomplete*, plus one case with other ID schemes (`FR-1`, `REQ-10`, `NFR-1`).
2. Invent the products and the text. Nothing is copied from a real or confidential specification
   (Examples 3 and 5 are never used here). One case, `todo-app-prose`, rewrites the committed
   todo-app PRD (`tests/fixtures/spec/todo-app/PRD.md`) as prose, keeping its 8 requirements.
3. Make each case hard in a way that can be scored: statements that share a paragraph, a quoted
   older figure that was corrected, an out-of-scope line, a "maybe later", a story marked not
   planned, vague statements to ask about, and an instruction injected into the document.
4. Mark, per case and by words that occur once (never by offsets), the requirement passages, the
   decoys (text that looks like a requirement and is not) and the topics an author should be asked
   about, in `expected.json`.

**Not done:** no reviewer has read the cases yet (`reviewed_by` is empty). T7 D4 asks for Sanjeev's
review (the same meaning, nothing added, nothing dropped, realistic) and then Andrej's (fair to the
baseline) before a case enters the set, and until then the numbers on them are development numbers.
