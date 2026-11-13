// One list of the organization's components: these pin how a project's
// declaration meets what was published, and that nothing is dropped.
import { describe, expect, it } from "vitest";

import type { CatalogNode, RegistryEntry } from "./api";
import { componentRows, sameComponent } from "./component-registry";

const entry = (name: string, extra: Partial<RegistryEntry> = {}): RegistryEntry =>
  ({ name, kind: "gear", state: "declared", capabilities: [], orphaned: false, occurrences: [], ...extra }) as RegistryEntry;
const node = (name: string): CatalogNode => ({ type_id: "t", instance_id: `i-${name}`, value: { name, kind: "gear" } }) as CatalogNode;

describe("one list of components", () => {
  it("takes a published crate for the declared component it is", () => {
    expect(sameComponent(entry("graph-storage"), "cf-gears-graph-storage")).toBe(true);
    expect(sameComponent(entry("analytics", { aliases: ["insight-analytics"] }), "insight-analytics")).toBe(true);
    expect(sameComponent(entry("analytics"), "analytics-sdk")).toBe(false);
  });

  it("joins them into one row, and keeps what only one side knows", () => {
    const rows = componentRows([entry("graph-storage"), entry("previews", { state: "candidate" })], [node("cf-gears-graph-storage"), node("cf-gears-toolkit-trace-context")]);
    expect(rows.map((r) => [r.name, r.state, !!r.entry, !!r.node])).toEqual([
      ["cf-gears-toolkit-trace-context", "published", false, true],
      ["graph-storage", "declared", true, true],
      ["previews", "candidate", true, false],
    ]);
  });

  it("names a node without a name by whose it is, never by its id", () => {
    const profile = { type_id: "p", instance_id: "0eb1662c-2f35", value: { gear_name: "@gears-frontx/auth" } } as unknown as CatalogNode;
    expect(componentRows([], [profile])[0].name).toBe("@gears-frontx/auth");
  });
});
