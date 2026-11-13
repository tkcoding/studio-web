import { describe, expect, it } from "vitest";
import { rowReview, withDecisions } from "./spec-findings";

const typed = { type_key: "adr", state: "confirmed" as const, checked_at: null, findings: 0 };

describe("rowReview", () => {
  it("asks for a type before anything else", () => {
    expect(rowReview({ ...typed, type_key: null }).label).toBe("Needs type");
  });

  it("calls a typed document nobody checked a check needed, not clean", () => {
    expect(rowReview(typed)).toEqual({ label: "Check needed", tone: "var(--warning)" });
  });

  it("puts findings before the date: a verdict from before verdicts were dated still counts", () => {
    expect(rowReview({ ...typed, checked_at: null, findings: 1 }).label).toBe("1 finding");
  });

  it("counts what the server counted", () => {
    const checked = { ...typed, checked_at: "2026-10-01T00:00:00Z" };
    expect(rowReview({ ...checked, findings: 3 })).toEqual({
      label: "3 findings",
      tone: "var(--destructive)",
    });
    expect(rowReview({ ...checked, findings: 1 }).label).toBe("1 finding");
    expect(rowReview(checked)).toEqual({ label: "0 findings", tone: "var(--success)" });
  });

  it("says nothing about the review when the verdicts could not be read", () => {
    expect(rowReview(typed, false).label).toBe("—");
    // The type is known either way.
    expect(rowReview({ ...typed, type_key: null }, false).label).toBe("Needs type");
  });

  it("does not review a file decided not to be a document", () => {
    expect(rowReview({ ...typed, state: "not_a_document" }).label).toBe("Not a document");
  });
});

describe("withDecisions", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("folds the dismissed apart and puts confirmed first", () => {
    const { open, dismissed } = withDecisions(items, { b: "confirmed", c: "dismissed" });
    expect(open.map((i) => i.id)).toEqual(["b", "a"]);
    expect(open[0].decision).toBe("confirmed");
    expect(dismissed.map((i) => i.id)).toEqual(["c"]);
  });
  it("keeps the order when nothing is decided", () => {
    expect(withDecisions(items, {}).open.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
