// The map shows the product's entities by layer, as a diagram that is read:
// these pin what is left out, which layer a thing lands in, the verbs on a
// relation, and that no two cards overlap.
import { describe, expect, it } from "vitest";

import { cardFields, cardSize, entityDraft, layerOf, placeCards, relationEdges, weight } from "./domain-layers";
import { entitiesOf, type SpecModelFact } from "./spec-model";

const fact = (subject: string, kind: SpecModelFact["kind"], extra: Partial<SpecModelFact> = {}): SpecModelFact => ({
  kind,
  subject,
  aspect: "",
  value: "",
  text: `${subject} ${kind}`,
  status: "active",
  status_because: "",
  source: { path: "docs/prd/x.md", line_start: 1 },
  ...extra,
});
const one = (facts: SpecModelFact[]) => entitiesOf(facts)[0];

describe("a layer", () => {
  it("is Domain for the subject, System for what serves it, Deployment for where it runs", () => {
    expect(layerOf(one([fact("Organization", "entity")]))).toBe("domain");
    expect(layerOf(one([fact("IDE session", "entity")]))).toBe("system");
    expect(layerOf(one([fact("Keycloak realm", "entity")]))).toBe("deployment");
    // Described only in deployment documents.
    expect(layerOf(one([fact("Stage", "entity", { source: { path: "deploy/PIPELINES.md" } })]))).toBe("deployment");
  });

  it("is the one the extractor stated most, over a guess from the name", () => {
    // The name says System; the extractor said Domain.
    expect(layerOf(one([fact("Session", "entity", { layer: "domain" })]))).toBe("domain");
    expect(
      layerOf(
        one([
          fact("Build", "entity", { layer: "deployment" }),
          fact("Build", "entity", { layer: "system" }),
          fact("Build", "entity", { layer: "deployment" }),
          // Only an entity fact states a layer.
          fact("Build", "attribute", { layer: "system" }),
          fact("Build", "attribute", { layer: "system" }),
        ]),
      ),
    ).toBe("deployment");
  });

  it("is guessed when no entity fact states one, and still none for an identifier", () => {
    expect(layerOf(one([fact("IDE session", "entity", { layer: null }), fact("IDE session", "entity")]))).toBe("system");
    expect(layerOf(one([fact("ADR-0007", "entity", { layer: "domain" })]))).toBeNull();
  });

  it("is none for an identifier, a passing word, or a kit's template", () => {
    expect(layerOf(one([fact("ADR-0007", "entity")]))).toBeNull();
    expect(layerOf(one([fact("header", "attribute")]))).toBeNull();
    expect(layerOf(one([fact("Project", "entity", { source: { path: "x/kits/sdlc/artifacts/PRD/template.md" } })]))).toBeNull();
  });
});

describe("a card", () => {
  const project = one([
    fact("Project", "entity"),
    fact("Project", "attribute", { aspect: "type" }),
    fact("Project", "attribute", { aspect: "type" }),
    fact("Project", "attribute", { aspect: "payload" }),
    fact("Project", "relation", { aspect: "belongs to", value: "Workspace" }),
  ]);

  it("lists each field once, and is as big as its text", () => {
    expect(cardFields(project)).toEqual(["type", "payload"]);
    expect(cardSize("Project", ["type", "payload"])).toEqual({ w: 130, h: 68 });
  });

  it("weighs a relation above a plain fact", () => {
    expect(weight(project)).toBe(5 + 6);
  });
});

describe("the diagram", () => {
  const entities = entitiesOf([
    fact("Project", "entity"),
    fact("Project", "relation", { aspect: "belongs to", value: "Workspace" }),
    fact("Workspace", "relation", { aspect: "holds", value: "Projects" }),
    fact("Workspace", "entity"),
    fact("Note", "entity"),
  ]);

  it("draws one line per pair with every verb the documents use", () => {
    const edges = relationEdges(entities);
    expect(edges).toHaveLength(1);
    expect(edges[0].verbs.sort()).toEqual(["belongs to", "holds"]);
  });

  it("places no two cards over each other, and the loose ones in a row beneath", () => {
    const cards = entities.map((e) => ({ key: e.key, w: 160, h: 70 }));
    const { cards: placed, looseTop } = placeCards(cards, relationEdges(entities));
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart, `${a.key} / ${b.key}`).toBe(true);
      }
    const note = placed.find((c) => c.key === "note")!;
    expect(note.loose).toBe(true);
    expect(note.y - note.h / 2).toBeGreaterThan(looseTop!);
    expect(placeCards(cards, relationEdges(entities))).toEqual(placeCards(cards, relationEdges(entities)));
  });
});

describe("the editor's draft", () => {
  it("starts from what the model knows, each field and relation once", () => {
    const e = one([
      fact("Project", "entity", { text: "A project is a unit of work." }),
      fact("Project", "attribute", { aspect: "type", value: "product" }),
      fact("Project", "attribute", { aspect: "type", value: "library" }),
      fact("Project", "relation", { aspect: "belongs to", value: "Workspace" }),
      fact("Project", "relation", { aspect: "belongs to", value: "workspace" }),
    ]);
    expect(entityDraft(e)).toEqual({
      name: "Project",
      definition: "A project is a unit of work.",
      fields: [{ name: "type", meaning: "product" }],
      relations: [{ verb: "belongs to", target: "Workspace" }],
    });
  });
});
