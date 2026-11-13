import { describe, expect, it } from "vitest";
import { expertLine, questionSentence } from "./domain-questions";

describe("domain questions", () => {
  it("says why an entity is asked about", () => {
    expect(questionSentence({ entity: "Ledger", because_of: ["Invoice"], facts: 2, documents: [] })).toBe(
      "This document speaks of Invoice, which the project relates to Ledger. What does it do with Ledger?",
    );
    expect(questionSentence({ entity: "L", because_of: ["A", "B", "C"], facts: 1, documents: [] })).toContain(
      "A, B and C",
    );
    // #744: nothing to name is not " and undefined".
    expect(questionSentence({ entity: "Ledger", because_of: [], facts: 1, documents: [] })).toBe(
      "The project relates this document to Ledger. What does it do with Ledger?",
    );
  });

  it("describes an expert by their changes", () => {
    expect(expertLine({ person: "ann", commits: 1, documents: [], last_change: "2026-10-02T10:00:00Z" })).toBe(
      "1 commit, last 2026-10-02",
    );
    expect(expertLine({ person: "bob", commits: 3, documents: [] })).toBe("3 commits");
  });
});
