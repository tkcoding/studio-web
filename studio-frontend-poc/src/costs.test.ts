import { describe, expect, it } from "vitest";

import type { CostRow } from "./api";
import { blankModel, hours, money, periodRange, priceProblem, rowLabel, tokens } from "./costs";

const row = (key: string, label?: string): CostRow => ({
  key,
  label,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  session_seconds: 0,
  cost: 0,
  unpriced: false,
});

describe("the costs screen", () => {
  it("asks for whole UTC months and the last thirty days up to tomorrow", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(periodRange("this-month", now)).toEqual({ from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" });
    expect(periodRange("last-month", now)).toEqual({ from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" });
    expect(periodRange("last-30-days", now)).toEqual({ from: "2026-09-16T00:00:00Z", to: "2026-10-16T00:00:00Z" });
    // January's last month is December of the year before.
    expect(periodRange("last-month", new Date("2026-01-10T00:00:00Z")).from).toBe("2025-12-01T00:00:00Z");
  });

  it("shows a single call's cost rather than rounding it away", () => {
    expect(money(12.5, "USD")).toBe("$12.50");
    expect(money(0.0019, "USD")).toBe("$0.0019");
    expect(money(0, "USD")).toBe("$0.00");
  });

  it("reads tokens and session time the way people do", () => {
    expect(tokens(950)).toBe("950");
    expect(tokens(3_200)).toBe("3.2k");
    expect(tokens(4_500_000)).toBe("4.5M");
    expect(hours(0)).toBe("—");
    expect(hours(300)).toBe("5 min");
    expect(hours(5400)).toBe("1 h 30 min");
  });

  it("names rows by what they group", () => {
    expect(rowLabel(row("ws-1", "Studio / Web"), "project")).toBe("Studio / Web");
    expect(rowLabel(row(""), "person")).toBe("IDE sessions (nobody in particular)");
    expect(rowLabel(row("abc"), "person", "abc")).toBe("You");
    expect(rowLabel(row("personal"), "payer")).toBe("People's own keys");
    expect(rowLabel(row("session"), "source")).toBe("IDE sessions");
    expect(rowLabel(row("ide-session"), "model")).toBe("IDE sessions");
  });

  it("refuses a price list the backend would refuse", () => {
    const m = { ...blankModel(), model: "claude-sonnet-5-5", input_per_mtok: 3 };
    expect(priceProblem([m])).toBeNull();
    expect(priceProblem([m, m])).toMatch(/twice/);
    expect(priceProblem([{ ...m, model: " " }])).toMatch(/names/);
    expect(priceProblem([{ ...m, output_per_mtok: -1 }])).toMatch(/not a price/);
    expect(priceProblem([m], { cpu_core_hour: Number.NaN, memory_gib_hour: 0 })).toMatch(/session/);
    expect(priceProblem([m], { cpu_core_hour: 0.04, memory_gib_hour: 0.005 }, "EUR")).toBeNull();
    expect(priceProblem([m], null, "dollars")).toMatch(/ISO 4217/);
  });
});
