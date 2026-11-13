// A fact's review key and how reviews lay over the model: these pin that a
// reading keeps its review across line moves and loses it when its words change.
import { describe, expect, it } from "vitest";

import { factKey, reviewCounts, reviewIndex, withoutRejected } from "./review-state";
import type { SpecModelFact } from "./spec-model";

const fact = (text: string, extra: Partial<SpecModelFact> = {}): SpecModelFact => ({
  kind: "attribute",
  subject: "Invoice",
  aspect: "number",
  value: "",
  text,
  status: "active",
  status_because: "",
  source: { path: "docs/prd/x.md", line_start: 3, quote: text },
  ...extra,
});

describe("a fact's review key", () => {
  it("stays when the passage moves or is re-wrapped, and the subject is spelt otherwise", () => {
    const a = fact("An invoice has a **number**.");
    const moved = fact("An  invoice has a number.", { subject: "invoices", source: { path: "docs/prd/x.md", line_start: 40, quote: "An  invoice has a number." } });
    expect(factKey(moved)).toBe(factKey(a));
    expect(factKey(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the words do", () => {
    expect(factKey(fact("An invoice has a number."))).not.toBe(factKey(fact("An invoice has two numbers.")));
  });
});

describe("reviews over the model", () => {
  const a = fact("A one.");
  const b = fact("B two.");
  const c = fact("C three.");
  const index = reviewIndex([
    { fact_key: factKey(a), state: "accepted", path: "", revision: "", decided_by: "", decided_at: "" },
    { fact_key: factKey(b), state: "rejected", path: "", revision: "", decided_by: "", decided_at: "" },
  ]);

  it("leaves a rejected reading out", () => {
    expect(withoutRejected([a, b, c], index)).toEqual([a, c]);
  });

  it("counts what is accepted, rejected and still proposed", () => {
    expect(reviewCounts([a, b, c], index)).toEqual({ accepted: 1, rejected: 1, proposed: 1 });
  });
});
