import { describe, expect, it } from "vitest";
import { fieldTrend } from "./field-trend";

const fields = [
  { key: "coverage", label: "Coverage", lamp: true },
  { key: "codeloc", label: "Code LOC", lamp: false },
  { key: "lifecycle", label: "Lifecycle", lamp: false },
  { key: "owner", label: "Path owner", lamp: true },
];

const snap = (f: Record<string, { n?: number; s?: string; b?: string }>) => ({
  component: "studio-core",
  date: "2026-09-01",
  fields: f,
});

describe("what changed since the window opened", () => {
  it("has nothing to say without a snapshot", () => {
    expect(fieldTrend(fields, {}, undefined)).toBeUndefined();
  });

  it("judges a graded field by its lamp", () => {
    const t = fieldTrend(
      fields,
      { coverage: { b: "41%", n: 41, s: "bad" }, owner: { b: "@team", s: "good" } },
      snap({ coverage: { b: "80%", n: 80, s: "good" }, owner: { b: "none", s: "bad" } }),
    )!;

    expect(t.since).toBe("2026-09-01");
    expect(t.changes).toEqual([
      { key: "coverage", label: "Coverage", before: "80% (good)", now: "41% (bad)", tone: "worse" },
      { key: "owner", label: "Path owner", before: "none (bad)", now: "@team (good)", tone: "better" },
    ]);
    expect([t.better, t.worse]).toEqual([1, 1]);
  });

  it("shows a bare number that moved without calling it better or worse", () => {
    const t = fieldTrend(fields, { codeloc: { b: "12,400", n: 12400 } }, snap({ codeloc: { b: "9,800", n: 9800 } }))!;

    expect(t.changes).toEqual([{ key: "codeloc", label: "Code LOC", before: "9,800", now: "12,400", tone: "neutral" }]);
    expect([t.better, t.worse]).toEqual([0, 0]);
  });

  it("notices a badge that changed, and ignores what did not move", () => {
    const t = fieldTrend(
      fields,
      { lifecycle: { b: "production" }, coverage: { b: "80%", n: 80, s: "good" } },
      snap({ lifecycle: { b: "beta" }, coverage: { b: "80%", n: 80, s: "good" } }),
    )!;

    expect(t.changes.map((c) => [c.key, c.before, c.now])).toEqual([["lifecycle", "beta", "production"]]);
  });

  it("compares a long badge on the part the snapshot kept", () => {
    const long = "A description well past the eighty characters a snapshot keeps of any one badge, and then some.";
    const kept = [...long].slice(0, 80).join("");

    expect(fieldTrend(fields, { lifecycle: { b: long } }, snap({ lifecycle: { b: kept } }))!.changes).toEqual([]);
  });

  it("counts a field answered only now as changed", () => {
    const t = fieldTrend(fields, { lifecycle: { b: "beta" } }, snap({}))!;
    expect(t.changes).toEqual([{ key: "lifecycle", label: "Lifecycle", before: "—", now: "beta", tone: "neutral" }]);
  });

  it("puts the grade first, higher being better", () => {
    const t = fieldTrend(
      fields,
      { grade: { b: "B", n: 70 }, codeloc: { n: 2 } },
      snap({ grade: { b: "C", n: 55 }, codeloc: { n: 1 } }),
    )!;

    expect(t.changes[0]).toEqual({ key: "grade", label: "Grade", before: "C 55%", now: "B 70%", tone: "better" });
    expect(t.better).toBe(1);
  });
});
