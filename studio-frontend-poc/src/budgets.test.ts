import { describe, expect, it } from "vitest";

import type { BudgetPlace, BudgetStanding, BudgetStatus } from "./api";
import { budgetProblem, budgetWarnings, budgetsOf, levelBadge, nextPlace, percent, rowsOf, standingText } from "./budgets";

const standing = (patch: Partial<BudgetStanding>): BudgetStanding => ({
  tenant_id: null,
  label: "Acme",
  monthly: 100,
  spent: 0,
  forecast: null,
  level: "ok",
  by_forecast: false,
  ...patch,
});

const places: BudgetPlace[] = [
  { id: "org", label: "Acme", kind: "organization" },
  { id: "ws", label: "Platform", kind: "workspace" },
  { id: "p1", label: "Platform / Portal", kind: "project" },
];

describe("budgets", () => {
  it("names only what needs someone, in the order the backend ranked it", () => {
    const status = {
      standings: [
        standing({ level: "over", spent: 120 }),
        standing({ tenant_id: "ws", level: "warning", by_forecast: true }),
        standing({ tenant_id: "p1" }),
      ],
    } as BudgetStatus;
    expect(budgetWarnings(status).map((s) => s.tenant_id)).toEqual([null, "ws"]);
    expect(budgetWarnings(null)).toEqual([]);
  });

  it("says whether the spend or only the forecast crossed the line", () => {
    expect(standingText(standing({ level: "over", spent: 120 }), "USD")).toBe("Over budget: $120.00 of $100.00 spent.");
    expect(standingText(standing({ level: "over", spent: 60, forecast: 120, by_forecast: true }), "USD")).toBe(
      "On course to pass the budget: $60.00 of $100.00 spent, $120.00 by the month's end.",
    );
    expect(standingText(standing({ level: "warning", spent: 85 }), "USD")).toBe("85% of the budget spent: $85.00 of $100.00.");
    expect(standingText(standing({ level: "warning", spent: 40, forecast: 90, by_forecast: true }), "USD")).toContain(
      "On course for 90%",
    );
    expect(standingText(standing({ spent: 10 }), "USD")).toBe("$10.00 of $100.00 spent.");
    expect(levelBadge(standing({ level: "over", by_forecast: true }))).toBe("Over by forecast");
    expect(levelBadge(standing({}))).toBe("On track");
    expect(percent(5, 0)).toBe(0);
  });

  it("edits the organization as an empty place and sends it without an id", () => {
    const rows = rowsOf([{ tenant_id: null, monthly: 100 }, { tenant_id: "ws", monthly: 10 }]);
    expect(rows).toEqual([
      { tenant_id: "", monthly: 100 },
      { tenant_id: "ws", monthly: 10 },
    ]);
    expect(budgetsOf(rows)[0].tenant_id).toBeNull();
    expect(nextPlace(places, rows)).toBe("p1");
    expect(nextPlace(places, [])).toBe("");
    expect(nextPlace(places, [...rows, { tenant_id: "p1", monthly: 1 }])).toBeNull();
  });

  it("refuses what the backend would", () => {
    expect(budgetProblem([{ tenant_id: "", monthly: 100 }], 80)).toBeNull();
    expect(budgetProblem([{ tenant_id: "", monthly: 0 }], 80)).toMatch(/above zero/);
    expect(budgetProblem([{ tenant_id: "ws", monthly: 1 }, { tenant_id: "ws", monthly: 2 }], 80)).toMatch(/one budget/);
    expect(budgetProblem([], 100)).toMatch(/1 to 99/);
  });
});
