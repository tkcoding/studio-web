// A saved entity shows at once, before a build reads it: these pin what it
// replaces, what it leaves, and when it goes.
import { describe, expect, it } from "vitest";

import { overlaySaved, pruneSaved, savedFacts, withSaved, type SavedEdit } from "./saved-entities";
import { entitiesOf, type SpecModelFact } from "./spec-model";

const fact = (subject: string, kind: SpecModelFact["kind"], path = "docs/prd/x.md", text = `${subject} ${kind}`): SpecModelFact => ({
  kind,
  subject,
  aspect: "",
  value: "",
  text,
  status: "active",
  status_because: "",
  source: { path },
});
const write = { path: "docs/domain-model.md", branch: "studio/domain-model", commit_sha: "abc" };
const saved = (name: string, definition: string | null, at = 1000, extra: Partial<SavedEdit["edit"]> = {}): SavedEdit => ({
  edit: { name, definition, fields: [], relations: [], ...extra },
  write,
  at,
});

describe("a saved entity", () => {
  it("becomes provisional facts from docs/domain-model.md", () => {
    const facts = savedFacts({ name: "Invoice", definition: "Asks to pay.", fields: [{ name: "total", meaning: "the sum" }], relations: [{ verb: "belongs to", target: "Customer" }, { verb: "", target: "x" }] });
    expect(facts.map((f) => [f.kind, f.aspect, f.value])).toEqual([
      ["entity", "", ""],
      ["attribute", "total", "the sum"],
      ["relation", "belongs to", "Customer"],
    ]);
    expect(facts.every((f) => f.provisional && f.source.path === "docs/domain-model.md" && f.status_because === "saved, read on next build")).toBe(true);
  });

  it("replaces what its section said before and leaves the other documents", () => {
    const facts = [fact("Invoice", "entity", "docs/prd/x.md", "Old."), fact("Invoices", "attribute", "docs/domain-model.md"), fact("Customer", "entity", "docs/domain-model.md")];
    const out = overlaySaved(facts, [saved("Invoice", "New.")]);
    expect(out.map((f) => `${f.subject}:${f.text}:${f.source.path}`)).toEqual([
      "Invoice:New.:docs/domain-model.md",
      "Invoice:Old.:docs/prd/x.md",
      "Customer:Customer entity:docs/domain-model.md",
    ]);
    // The card shows the saved definition, not the old one.
    expect(entitiesOf(out).find((e) => e.key === "invoice")?.facts.find((f) => f.kind === "entity")?.text).toBe("New.");
  });

  it("keeps the last save of an entity", () => {
    const list = withSaved([saved("Invoice", "One.")], saved("invoice", "Two."));
    expect(list).toHaveLength(1);
    expect(overlaySaved([], list).map((f) => f.text)).toEqual(["Two."]);
  });

  it("stays until a build that finished after the save", () => {
    const list = [saved("Invoice", "x", Date.parse("2026-10-15T10:00:00Z"))];
    expect(pruneSaved(list, { running: false, finished_at: "2026-10-15T09:00:00Z" })).toBe(list);
    expect(pruneSaved(list, { running: true, finished_at: "2026-10-15T11:00:00Z" })).toBe(list);
    expect(pruneSaved(list, { running: false, finished_at: null })).toBe(list);
    expect(pruneSaved(list, { running: false, finished_at: "2026-10-15T11:00:00Z" })).toEqual([]);
  });
});
