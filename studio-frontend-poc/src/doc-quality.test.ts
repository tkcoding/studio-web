// The queue suggests changes that make the documentation better, each ready
// to save: these pin which things it asks about, the text it proposes, and
// that a saved change takes the item off the list at once.
import { describe, expect, it } from "vitest";

import { definitionFrom, docQuality, inverseVerb, relationSentence } from "./doc-quality";
import { overlaySaved } from "./saved-entities";
import { entitiesOf, type GlossaryEntry, type SpecModelFact } from "./spec-model";

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
const attr = (subject: string, aspect: string, extra: Partial<SpecModelFact> = {}) => fact(subject, "attribute", { aspect, value: `its ${aspect}`, ...extra });
const rel = (subject: string, verb: string, target: string, extra: Partial<SpecModelFact> = {}) =>
  fact(subject, "relation", { aspect: verb, value: target, text: `${subject} ${verb} ${target}`, ...extra });
const types = (facts: SpecModelFact[], glossary: GlossaryEntry[] = []) => docQuality(entitiesOf(facts, glossary), glossary).map((i) => `${i.type}:${i.key}`);

describe("no definition", () => {
  const facts = [attr("Invoice", "number"), attr("Invoice", "total"), rel("Invoice", "belongs to", "Customer"), fact("Customer", "entity", { text: "A Customer buys.", })];

  it("is asked of a domain thing described three times but never said what it is", () => {
    const items = docQuality(entitiesOf(facts));
    const nd = items.find((i) => i.type === "nodefinition");
    expect(nd?.title).toBe("Invoice has no definition");
    expect(nd?.edit?.definition).toBe("An Invoice holds number and total and belongs to Customer.");
    // The rest of the entity is kept, so the save does not lose it.
    expect(nd?.edit?.fields.map((f) => f.name)).toEqual(["number", "total"]);
    expect(nd?.edit?.relations).toEqual([{ verb: "belongs to", target: "Customer" }]);
  });

  it("is not asked of a thing that has one, of a passing word, or of what serves the product", () => {
    expect(types([fact("Customer", "entity"), attr("Customer", "a"), attr("Customer", "b")])).toEqual([]);
    expect(types([attr("Refund", "a"), attr("Refund", "b")])).toEqual([]);
    expect(types([attr("Billing service", "a"), attr("Billing service", "b"), attr("Billing service", "c")])).toEqual([]);
  });

  it("goes once the definition is saved", () => {
    const edit = { name: "Invoice", definition: "An Invoice asks a customer to pay.", fields: [], relations: [] };
    const after = overlaySaved(facts, [{ edit, write: { path: "docs/domain-model.md", branch: "b", commit_sha: "c" }, at: 1 }]);
    expect(types(after).filter((t) => t.startsWith("nodefinition"))).toEqual([]);
  });
});

describe("a proposed definition", () => {
  it("reads what the documents say when nothing is held or related", () => {
    expect(definitionFrom(entitiesOf([fact("Order", "constraint", { text: "An order is never empty." })])[0])).toBe("An Order: An order is never empty.");
  });
});

describe("one-sided relation", () => {
  it("proposes the other side on the thing that never mentions the first", () => {
    const facts = [
      fact("Invoice", "entity"),
      rel("Invoice", "belongs to", "Customer"),
      fact("Customer", "entity", { text: "Someone who buys." }),
      attr("Customer", "email"),
    ];
    const os = docQuality(entitiesOf(facts)).filter((i) => i.type === "onesided");
    expect(os).toHaveLength(1);
    expect(os[0].edit?.name).toBe("Customer");
    expect(os[0].edit?.definition).toBe("Someone who buys.");
    expect(os[0].edit?.relations).toEqual([{ verb: "has", target: "Invoice" }]);
  });

  it("is not asked when the other side names it, by a relation or in passing", () => {
    const base = [fact("Invoice", "entity"), rel("Invoice", "belongs to", "Customer"), fact("Customer", "entity")];
    expect(types([...base, rel("Customer", "has", "Invoices")]).filter((t) => t.startsWith("onesided"))).toEqual([]);
    expect(types([...base, fact("Customer", "constraint", { text: "A customer pays every invoice." })]).filter((t) => t.startsWith("onesided"))).toEqual([]);
  });

  it("goes once the other side is saved", () => {
    const facts = [fact("Invoice", "entity"), rel("Invoice", "owns", "Customer"), fact("Customer", "entity")];
    const item = docQuality(entitiesOf(facts)).find((i) => i.type === "onesided")!;
    expect(item.edit?.relations).toEqual([{ verb: "is owned by", target: "Invoice" }]);
    const after = overlaySaved(facts, [{ edit: item.edit!, write: { path: "docs/domain-model.md", branch: "b", commit_sha: "c" }, at: 1 }]);
    expect(types(after)).toEqual([]);
  });

  it("turns the verb around where it knows how, and reads has otherwise", () => {
    expect(inverseVerb("Belongs to")).toBe("has");
    expect(inverseVerb("contains")).toBe("is part of");
    expect(inverseVerb("approves")).toBe("has");
  });
});

describe("only in an ADR or a feature", () => {
  const adr = { source: { path: "docs/adr/0007-billing.md" } };
  it("proposes adding a thing only a decision or a feature describes to the domain model", () => {
    const facts = [fact("Invoice", "entity", { ...adr, text: "An invoice is what we bill." }), attr("Invoice", "total", { source: { path: "docs/features/billing.md" } })];
    const items = docQuality(entitiesOf(facts));
    expect(items.map((i) => i.type)).toEqual(["onlyadr"]);
    expect(items[0].title).toBe("Invoice is described only in an ADR");
    expect(items[0].edit?.definition).toBe("An invoice is what we bill.");
  });

  it("is not asked once a requirement or the domain model describes it", () => {
    expect(types([fact("Invoice", "entity", adr), attr("Invoice", "total")])).toEqual([]);
    expect(types([fact("Invoice", "entity", adr), attr("Invoice", "total", { source: { path: "docs/domain-model.md" } })])).toEqual([]);
  });

  it("puts the sentence together when the decision does not say what it is either", () => {
    const facts = [attr("Invoice", "total", adr), attr("Invoice", "due", adr), attr("Invoice", "number", adr)];
    const items = docQuality(entitiesOf(facts));
    // One item for the thing, not one per gap.
    expect(items.map((i) => i.type)).toEqual(["onlyadr"]);
    expect(items[0].edit?.definition).toBe("An Invoice holds total, due and number.");
  });
});

describe("two names for one thing", () => {
  const entry = (name: string, facts = 5): GlossaryEntry => ({ key: name.toLowerCase(), name, chosen: false, spellings: [name], aliases: [], facts, documents: 2 });
  it("comes from the glossary's similar pairs, the busier name kept", () => {
    const items = docQuality([], [entry("Member", 9), entry("Membership", 4)]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("twonames");
    expect(items[0].pair?.a.key).toBe("member");
    expect(items[0].pair?.b.key).toBe("membership");
  });
});

describe("no relation", () => {
  const at = (line: number, path = "docs/prd/x.md") => ({ source: { path, line_start: line, line_end: line + 1, quote: "q" } });
  const revisions = new Map([["docs/prd/x.md", "r1"]]);
  const facts = [
    fact("Connection", "entity", { text: "A Connection reaches a host.", ...at(3) }),
    fact("Connection health", "entity", { text: "Connection health is read from the host.", ...at(10) }),
    attr("Connection health", "status", at(12)),
  ];
  const noRelation = (fs: SpecModelFact[], rev = revisions) => docQuality(entitiesOf(fs), [], rev).filter((i) => i.type === "norelation");

  it("proposes the sentence its name implies, after the passage that describes it", () => {
    const [item] = noRelation(facts);
    expect(item?.title).toBe("Connection health is related to nothing");
    expect(item?.sentence).toMatchObject({
      path: "docs/prd/x.md",
      revision: "r1",
      line: 11,
      sentence: "Connection health belongs to **Connection**.",
      verb: "belongs to",
      target: "Connection",
    });
  });

  it("reads a head noun alone as what it is a kind of", () => {
    const fs = [fact("Grant", "entity", at(1)), fact("Owner grant", "entity", at(5)), attr("Owner grant", "who", at(6))];
    expect(noRelation(fs)[0]?.sentence?.sentence).toBe("Owner grant is a kind of **Grant**.");
  });

  it("is not asked once a relation ties it in, of a screen or a step, or of a document read at an older revision", () => {
    expect(noRelation([...facts, rel("Connection health", "describes", "Connection", at(14))])).toEqual([]);
    const screen = [fact("Connection", "entity", at(3)), fact("Connection list", "entity", at(10)), attr("Connection list", "a", at(11))];
    expect(noRelation(screen)).toEqual([]);
    expect(noRelation(facts, new Map())).toEqual([]);
  });

  it("states the relation the way a document would", () => {
    expect(relationSentence("role grant", " grants ", "Role")).toBe("Role grant grants **Role**.");
  });
});
