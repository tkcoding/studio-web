// Moved from the prototype (src/domain-origin.test.ts, studio-frontend-poc/); added: the kit origin (issue #1025).
import { describe, expect, it } from "vitest";

import { linksOf, originOf } from "./domain-origin";
import type { DomainModel, ModelEntity } from "./domain-runtime";

function model(entities: ModelEntity[], studio: string[]): DomainModel {
  return {
    entities,
    byId: new Map(entities.map((e) => [e.id, e])),
    buckets: [],
    canEdit: true,
    source: "server",
    studioTypes: new Set(studio),
    gts: { types: {}, relations: {} },
  };
}

const m = model(
  [
    { id: "node", properties: [{ name: "owner", type: "Person", extends: "edge" }] },
    { id: "person" },
    { id: "project", extends: "node", properties: [{ name: "uses", type: "Repository", extends: "edge", relationLabel: "uses" }] },
    { id: "repository", meta: { held_by: "studio-artifact-ingest" } },
    { id: "requirement", meta: { origin: "upload", upload: "studio-product-full" }, properties: [{ name: "of", type: "project", extends: "edge" }] },
    { id: "cost-centre", meta: { origin: "organization" } },
    { id: "risk" },
    { id: "milestone", meta: { origin: "kit", kit: "project-lifecycle", kit_version: "0.3.0" } },
    { id: "finding", meta: { origin: "kit", kit: "project-issues", held_by: "studio-spec-quality" } },
    { id: "orphan", meta: { origin: "kit" } },
    { id: "ghost", properties: [{ name: "to", type: "Nowhere", extends: "edge" }] },
  ],
  ["node", "person", "project"],
);

describe("originOf", () => {
  it("names where each type came from", () => {
    const key = (id: string) => originOf(m, m.byId.get(id)!).key;
    expect(key("project")).toBe("studio");
    expect(key("repository")).toBe("gear");
    expect(key("requirement")).toBe("upload");
    expect(originOf(m, m.byId.get("requirement")!).label).toBe("uploaded · studio-product-full");
    expect(key("cost-centre")).toBe("organization");
    expect(key("risk")).toBe("earlier");
  });


  it("keeps an open gear declaration distinct from core ownership and kit installation", () => {
    const entity: ModelEntity = { id: "work-item", meta: { origin: "gear", declared_by: "studio-artifact-ingest", kit: "project-issues" } };
    const state = model([entity], ["work-item"]);
    expect(originOf(state, entity)).toMatchObject({ key: "gear", label: "gear studio-artifact-ingest" });
    expect(originOf(state, entity).hint).toContain("does not install its kit");
  });

  it("names the kit that brought a type, with its version, before the gear that keeps it", () => {
    const o = (id: string) => originOf(m, m.byId.get(id)!);
    expect(o("milestone")).toMatchObject({ key: "kit", label: "kit · project-lifecycle 0.3.0" });
    expect(o("milestone").hint).toContain("the kit project-lifecycle");
    expect(o("finding")).toMatchObject({ key: "kit", label: "kit · project-issues" });
    expect(o("finding").hint).toContain("studio-spec-quality keeps its records");
    expect(o("orphan")).toMatchObject({ key: "kit", label: "kit" });
  });
});

describe("linksOf", () => {
  it("reads relations out, inherited ones marked, and relations in", () => {
    const { out, in: into } = linksOf(m, "project");
    expect(out).toEqual([
      { name: "uses", label: "uses", other: "repository", inherited: false },
      { name: "owner", label: "owner", other: "person", inherited: true },
    ]);
    expect(into).toEqual([{ name: "of", label: "of", other: "requirement", inherited: false }]);
  });

  it("leaves out a relation to a type the model lacks", () => {
    expect(linksOf(m, "ghost").out).toEqual([]);
  });
});
