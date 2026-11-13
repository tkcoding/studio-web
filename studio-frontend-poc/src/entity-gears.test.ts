// Which gear keeps an entity: these pin the order of the evidence (name over
// display name over description), plural folding, the generic words a name
// ignores, the gap, and the project's own gears.
import { describe, expect, it } from "vitest";

import { entityGears, gearRefs, gearSubject, gearSubjects, type EntityRef } from "./entity-gears";
import { indexCatalogue, type CatalogueGear } from "./product-configurator";
import { subjectKey } from "./spec-model";

const gear = (id: string, extra: Partial<CatalogueGear> = {}): CatalogueGear => ({
  id,
  package: { crate_name: `cf-gears-${id}` },
  ...extra,
});
const index = indexCatalogue({
  gears: Object.fromEntries(
    [
      gear("studio-projects", { display_name: "Projects" }),
      gear("studio-user", { description: "Users, memberships and invitations of an organization." }),
      gear("account-management", { description: "Tenants and accounts." }),
      gear("api-gateway", { display_name: "API gateway" }),
      gear("studio-reports", { display_name: "Roadmap reports", description: "Weekly reports on the roadmap." }),
      gear("authn-static", { implements: { spec: "authn" }, description: "Static users for tests." }),
    ].map((g) => [g.id, g]),
  ),
});
const entity = (name: string, ...aliases: string[]): EntityRef => {
  const key = subjectKey(name);
  return { key, name, keys: [key, ...aliases.map(subjectKey)] };
};

describe("the gears an entity can be kept by", () => {
  it("are the catalogue's, without plugins, and the project's own gears it does not list", () => {
    const refs = gearRefs(index, [
      { name: "cf-gears-studio-projects", origin: "catalogue" },
      { name: "insight-metrics", origin: "project" },
      { name: "cf-gears-studio-user", origin: "project" },
    ]);
    expect(refs.map((g) => g.id)).toEqual([
      "account-management",
      "api-gateway",
      "studio-projects",
      "studio-reports",
      "studio-user",
      "insight-metrics",
    ]);
    expect(refs.find((g) => g.id === "insight-metrics")).toMatchObject({ origin: "project", label: "insight-metrics" });
  });

  it("are named by what they are about", () => {
    expect(gearSubject("cf-gears-studio-projects")).toBe("project");
    expect(gearSubject("studio-project-members")).toBe("project member");
    expect(gearSubject("account_management")).toBe("account management");
    // A name that starts with a prefix word is also about the whole of it.
    expect(gearSubjects("cf-gears-studio-sessions")).toEqual(["session", "studio session"]);
    expect(gearSubjects("cf-gears-invoices")).toEqual(["invoice"]);
  });
});

describe("the gear that keeps an entity", () => {
  const gears = gearRefs(index);
  const keep = (...es: EntityRef[]) => entityGears(es, gears);

  it("is the one named after it, plural folded", () => {
    const k = keep(entity("Project")).byEntity.get("project");
    expect(k?.gear.id).toBe("studio-projects");
    expect(k?.score).toBe(4);
    expect(k?.why).toMatch(/studio-projects/);
    expect(keep(entity("Users")).byEntity.get("user")?.gear.id).toBe("studio-user");
  });

  it("reads a word of the name, but not a word that only says what kind of gear it is", () => {
    expect(keep(entity("Account")).byEntity.get("account")?.gear.id).toBe("account-management");
    expect(keep(entity("Account")).byEntity.get("account")?.score).toBe(3);
    // "management" names the kind of gear, not what account-management keeps.
    expect(keep(entity("Management")).byEntity.get("management")).toBeNull();
  });

  it("falls back to the display name, then to the description", () => {
    expect(keep(entity("Roadmap")).byEntity.get("roadmap")).toMatchObject({ score: 2, gear: { id: "studio-reports" } });
    const m = keep(entity("Membership")).byEntity.get("membership");
    expect(m).toMatchObject({ score: 1, gear: { id: "studio-user" } });
    expect(m?.why).toMatch(/description/);
  });

  it("is found through a glossary alias", () => {
    const k = keep(entity("Workspace member", "membership")).byEntity.get("workspace member");
    expect(k?.gear.id).toBe("studio-user");
  });

  it("is none when no gear says the word: a gap", () => {
    expect(keep(entity("Invoice")).byEntity.get("invoice")).toBeNull();
  });

  it("is none when too many gears only mention it in passing", () => {
    const many = gearRefs(
      indexCatalogue({
        gears: Object.fromEntries(
          ["a", "b", "c", "d"].map((id) => [id, gear(`g-${id}`, { description: "Reads the tenant's settings." })]),
        ),
      }),
    );
    expect(entityGears([entity("Tenant")], many).byEntity.get("tenant")).toBeNull();
  });

  it("lists, per gear, the entities it keeps", () => {
    const { byGear } = keep(entity("Project"), entity("Users"), entity("Membership"), entity("Invoice"));
    expect(byGear.get("studio-user")?.map((e) => e.name)).toEqual(["Users", "Membership"]);
    expect(byGear.get("studio-projects")?.map((e) => e.name)).toEqual(["Project"]);
    expect(byGear.has("api-gateway")).toBe(false);
  });

  it("keeps an entity in a project gear by its name", () => {
    const own = gearRefs(null, [{ name: "invoices", origin: "project" }]);
    expect(entityGears([entity("Invoice")], own).byEntity.get("invoice")?.gear).toMatchObject({ id: "invoices", origin: "project" });
  });
});
