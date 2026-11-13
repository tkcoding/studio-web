import { describe, expect, it } from "vitest";
import { readinessOf } from "./readiness";

const board = (parts: { label: string; pct: number | null }[]) => ({
  roadmap_progress: { b: "…", parts: parts.map((p) => ({ ...p, value: p.pct === null ? "N/A" : `${p.pct}%` })) },
});

describe("build readiness", () => {
  it("has nothing to say without a board or a scan", () => {
    expect(readinessOf({})).toBeUndefined();
  });

  it("reads the board's axes as SPEC, SDK and IMPL, in that order", () => {
    const r = readinessOf(board([{ label: "Implementation", pct: 20 }, { label: "Design", pct: 100 }, { label: "SDK", pct: null }]))!;

    expect(r.bars.map((b) => [b.axis, b.pct])).toEqual([["SPEC", 100], ["SDK", null], ["IMPL", 20]]);
    expect(r.gaps).toEqual([]);
  });

  it("keeps what the repository shows beside what the board says", () => {
    const r = readinessOf({
      ...board([{ label: "Design", pct: 80 }]),
      progress: { b: "12 / 20 ticked", n: 60 },
      impl_trace: { b: "7 of 9 requirement IDs in code", n: 77 },
    })!;

    expect(r.evidence).toEqual([
      { axis: "SPEC", text: "Specs: 12 / 20 ticked", pct: 60 },
      { axis: "IMPL", text: "Code: 7 of 9 requirement IDs in code", pct: 77 },
    ]);
    expect(r.gaps).toEqual([]);
  });

  it("flags a board well ahead of its repository", () => {
    const r = readinessOf({
      ...board([{ label: "Design", pct: 100 }, { label: "Implementation", pct: 90 }]),
      progress: { b: "0 / 11 ticked", n: 0 },
      impl_trace: { b: "2 of 9", n: 22 },
    })!;

    expect(r.gaps).toEqual([
      "The board says Design 100%, the specs have 0% of their requirements ticked",
      "The board says Implementation 90%, the code cites 22% of the requirements",
    ]);
  });

  it("does not flag a board at N/A, which plans nothing", () => {
    expect(readinessOf({ ...board([{ label: "Implementation", pct: null }]), impl_trace: { n: 0 } })!.gaps).toEqual([]);
  });
});
