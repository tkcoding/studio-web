import { describe, expect, it } from "vitest";
import { bringsSummary, contractLabel, type GearBrings } from "./gear-brings";

describe("what a candidate gear brings", () => {
  const brings: GearBrings = {
    described: true,
    brought: [
      { gear: "cf-gears-billing", reason: "the gear you picked", database: false },
      { gear: "cf-gears-billing-audit", reason: "cf-gears-billing must run with it", database: true },
    ],
    overlaps: [{ contract: "audit/AuditLog@v1", already: ["cf-gears-audit"], brought: ["cf-gears-billing-audit"] }],
    changes: [],
  };

  it("summarises what comes along and what clashes", () => {
    expect(bringsSummary("cf-gears-billing", brings)).toBe(
      "1 more gear comes with it. 1 keeps its own database. 1 contract is already provided in the product.",
    );
    expect(bringsSummary("x", { described: true, brought: [{ gear: "x", reason: "", database: false }], overlaps: [], changes: [] })).toBe(
      "Nothing else comes with it.",
    );
    expect(bringsSummary("x", { described: false, brought: [], overlaps: [], changes: [] })).toMatch(/No gear.gdl/);
  });

  it("reads a contract id", () => {
    expect(contractLabel("audit/AuditLog@v1")).toBe("AuditLog (audit, v1)");
    expect(contractLabel("odd")).toBe("odd");
  });
});
