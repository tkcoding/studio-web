import { describe, expect, it } from "vitest";

import type { GearConfigSchema } from "./api";
import { configRows, configText, configValue, unsetRequired } from "./gear-config";

const schemas: GearConfigSchema[] = [
  {
    gear: "cf-gears-event-broker",
    id: "event-broker",
    fields: [
      { name: "mode", required: true, derived: false },
      { name: "retention", required: true, default: "7d", derived: false },
      { name: "tuning", required: false, derived: false },
    ],
  },
  {
    gear: "cf-gears-api-gateway",
    id: "api-gateway",
    fields: [{ name: "bind_addr", required: true, derived: true }],
  },
  { gear: "cf-gears-unknown", id: null, fields: [] },
];

describe("configValue / configText", () => {
  it("reads booleans and numbers, keeps other text", () => {
    expect(configValue("true")).toBe(true);
    expect(configValue(" false ")).toBe(false);
    expect(configValue("42")).toBe(42);
    expect(configValue("7d")).toBe("7d");
    expect(configValue("")).toBe("");
  });

  it("writes a value back the way it is typed", () => {
    expect(configText("7d")).toBe("7d");
    expect(configText(42)).toBe("42");
    expect(configText({ a: 1 })).toBe('{"a":1}');
    expect(configText(undefined)).toBe("");
  });
});

describe("configRows", () => {
  it("merges each pick's schema with what the product sets", () => {
    const gears = configRows(
      ["cf-gears-event-broker", "cf-gears-api-gateway"],
      schemas,
      { "cf-gears-event-broker": { retention: "30d", custom: 1 } },
    );
    expect(gears.map((g) => g.gear)).toEqual(["cf-gears-event-broker", "cf-gears-api-gateway"]);
    const broker = gears[0];
    expect(broker.described).toBe(true);
    expect(broker.rows.map((r) => [r.field, r.set, r.missing, r.declared])).toEqual([
      ["mode", false, true, true],
      ["retention", true, false, true],
      ["tuning", false, false, true],
      ["custom", true, false, false],
    ]);
    expect(broker.rows[1]).toMatchObject({ default: "7d", value: "30d" });
    expect(gears[1].rows[0]).toMatchObject({ field: "bind_addr", derived: true, missing: false });
  });

  it("treats a null default as none", () => {
    const [g] = configRows(
      ["x"],
      [{ gear: "x", id: "x", fields: [{ name: "f", required: true, default: null, derived: false }] }],
      {},
    );
    expect(g.rows[0]).toMatchObject({ default: undefined, missing: true });
  });

  it("keeps a setting for a gear no longer picked, and an undescribed gear's settings", () => {
    const gears = configRows(["cf-gears-unknown"], schemas, {
      "cf-gears-unknown": { a: true },
      "cf-gears-gone": { b: 2 },
    });
    expect(gears.map((g) => [g.gear, g.described, g.picked])).toEqual([
      ["cf-gears-unknown", false, true],
      ["cf-gears-gone", false, false],
    ]);
    expect(gears[0].rows).toEqual([
      { field: "a", required: false, derived: false, declared: false, set: true, value: true, missing: false },
    ]);
  });

  it("without schemas still lists what the config sets", () => {
    const gears = configRows(["a"], [], { a: { f: 1 } });
    expect(gears[0].described).toBe(false);
    expect(gears[0].rows.map((r) => r.field)).toEqual(["f"]);
  });
});

describe("unsetRequired", () => {
  it("names the required fields with no default that nothing sets", () => {
    const rows = configRows(["cf-gears-event-broker", "cf-gears-api-gateway"], schemas, {});
    expect(unsetRequired(rows)).toEqual([{ gear: "cf-gears-event-broker", field: "mode" }]);
    const set = configRows(["cf-gears-event-broker"], schemas, { "cf-gears-event-broker": { mode: "x" } });
    expect(unsetRequired(set)).toEqual([]);
  });
});
