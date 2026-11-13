import { describe, expect, it } from "vitest";
import type { CatalogNode } from "./api";
import { NOT_COMPONENTS, inKindFilter, kindChips, syncedSources } from "./component-kinds";

function node(name: string, value: Record<string, unknown>, type_id = "gts.cf.studio.catalog.gear.v1~"): CatalogNode {
  return { type_id, instance_id: name, value: { name, ...value } } as CatalogNode;
}

/** A slice of what `/components` returned on the local stand (#507). */
const nodes: CatalogNode[] = [
  node("cf-gears-account-management", { component_kind: "gear", kind: "gear", synced_from: "constructorfabric/gears-rust", downloads: 792 }),
  node("cf-chat-engine", { component_kind: "gear", kind: "gear", downloads: 583 }),
  node("cf-gears-keycloak-idp-plugin", { component_kind: "plugin", kind: "plugin", downloads: 210 }),
  node("cf-gears-account-management-sdk", { component_kind: "sdk", kind: "sdk", downloads: 1048 }),
  node("cf-gears-rustls-fips-shim", { component_kind: "library", kind: "gear", downloads: 552 }),
  node("cf-gears-toolkit-db", { component_kind: "library", kind: "toolkit", downloads: 26166 }),
  node("@gears-frontx/ui-kit", { component_kind: "frontend-library", kind: "frontx", synced_from: "constructorfabric/gears-frontx" }, "gts.cf.studio.catalog.frontx.v1~"),
  node("@gears-frontx/cli", { component_kind: "tool", kind: "frontx", synced_from: "constructorfabric/gears-frontx" }, "gts.cf.studio.catalog.frontx.v1~"),
  node("sdlc", { component_kind: "kit", kind: "kit" }, "gts.cf.studio.catalog.kit.v1~"),
  node("@gears-frontx/eslint-config", {
    component_kind: "config",
    kind: "frontx",
    component_excluded: "not a component (config): an internal package at internal/eslint-config",
    synced_from: "constructorfabric/gears-frontx",
  }, "gts.cf.studio.catalog.frontx.v1~"),
  node("cf-gears-cluster-conformance", {
    component_kind: "test-support",
    kind: "gear",
    component_excluded: "not a component (test-support): test helpers or a conformance suite",
    downloads: 477,
  }),
];

describe("kind chips", () => {
  it("count exactly the rows each chip shows", () => {
    const chips = kindChips(nodes);
    for (const chip of chips) {
      const rows = nodes.filter((n) => inKindFilter(n, chip.value));
      expect(chip.count, chip.label).toBe(rows.length);
    }
  });

  it("offer the new kinds, not graph types or stored kinds", () => {
    expect(kindChips(nodes).map((c) => `${c.label} ${c.count}`)).toEqual([
      "All 9",
      "gear 2",
      "plugin 1",
      "SDK 1",
      "library 2",
      "frontend library 1",
      "tool / CLI 1",
      "kit 1",
      "Not components 2",
    ]);
  });

  it("keep non-components out of All and every kind", () => {
    expect(nodes.filter((n) => inKindFilter(n, "")).map((n) => n.value.name)).not.toContain("@gears-frontx/eslint-config");
    expect(nodes.filter((n) => inKindFilter(n, NOT_COMPONENTS)).map((n) => n.value.name)).toEqual([
      "@gears-frontx/eslint-config",
      "cf-gears-cluster-conformance",
    ]);
  });

  it("fall back to the stored kind on a backend that does not classify", () => {
    const old = [node("a", { kind: "gear" }), node("b", { kind: "sdk" })];
    expect(kindChips(old).map((c) => c.value)).toEqual(["", "gear", "sdk"]);
  });
});

describe("synced sources", () => {
  it("name what filled the catalogue, not the picker's saved choice", () => {
    expect(syncedSources(nodes)).toEqual(["gears-frontx", "gears-rust", "crates.io"]);
    expect(syncedSources([])).toEqual([]);
  });

  it("name the roadmap board that planned the gears, once", () => {
    const planned = { auto: { roadmap_board: { b: "BACKEND ROADMAP", v: "constructorfabric/projects/48" } } };
    const profiles = {
      "cf-gears-event-broker": planned,
      "cf-gears-account-management": planned,
      "cf-gears-oagw": { auto: { lifecycle: { b: "mature" } } },
      untitled: { auto: { roadmap_board: { v: "o/projects/7" } } },
    };
    expect(syncedSources(nodes, profiles)).toEqual([
      "gears-frontx",
      "gears-rust",
      "crates.io",
      "roadmap (BACKEND ROADMAP)",
      "roadmap (o/projects/7)",
    ]);
  });
});
