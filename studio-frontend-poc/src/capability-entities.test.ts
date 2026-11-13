// A gear made for a capability carries the Domain model's entities and
// requirements into its PRD: these pin which entities count as the
// capability's, in what order, and what the PRD then says.
import { describe, expect, it } from "vitest";

import type { PlanRow } from "./api";
import { capabilityEntities, capabilityWords, keptSentences, suggestedCategory } from "./capability-entities";
import { entitiesOf, type SpecModelFact } from "./spec-model";

const fact = (subject: string, kind: SpecModelFact["kind"], extra: Partial<SpecModelFact> = {}): SpecModelFact => ({
  kind,
  subject,
  aspect: "",
  value: "",
  text: `${subject} ${kind}`,
  status: "active",
  status_because: "",
  source: { path: "docs/prd/billing.md", line_start: 1 },
  ...extra,
});
const entity = (subject: string, ...fields: string[]) => [
  fact(subject, "entity", { text: `${subject} is a thing the product keeps.` }),
  ...fields.map((aspect) => fact(subject, "attribute", { aspect, value: `its ${aspect}` })),
];
const requirement = (subject: string, text: string, line = 7) =>
  fact(subject, "requirement", { text, source: { path: "docs/prd/billing.md", line_start: line } });

const model = entitiesOf([
  ...entity("Invoice", "number", "total", "due date"),
  ...entity("Invoice line", "amount"),
  ...entity("Customer", "email"),
  ...entity("Payment", "amount"),
  ...entity("Shipment", "carrier"),
  requirement("Customer", "The system shall email the customer a reminder before the due date.", 12),
  requirement("Payment", "Payments are matched to invoices every night.", 20),
  requirement("Customer", "Reminders go out three days ahead.", 14),
]);

const row = (extra: Partial<PlanRow> = {}): Pick<PlanRow, "capability" | "label" | "terms" | "sources"> => ({
  capability: "invoicing",
  label: "Invoicing",
  terms: ["invoice"],
  sources: [],
  ...extra,
});

describe("the capability's words", () => {
  it("are its key, its label and its terms, folded once each", () => {
    expect(capabilityWords(row({ capability: "invoice-lines", label: "Invoice lines", terms: ["invoice line"] }))).toEqual([
      "invoice line",
    ]);
  });

  it("take the terms the documents used too", () => {
    const words = capabilityWords(row({ sources: [{ kind: "document", id: "d", label: "Billing PRD", terms: ["billing run"] }] }));
    expect(words).toContain("billing run");
  });
});

describe("the entities a gear for a capability keeps", () => {
  it("are the ones the capability's words name, the most described first", () => {
    const found = capabilityEntities(row(), model);
    expect(found.entities.map((e) => e.name)).toEqual(["Invoice", "Invoice line"]);
    expect(found.entities[0]).toMatchObject({ score: 3, fields: ["number", "total", "due date"] });
  });

  it("take an entity a requirement that asked for the capability names", () => {
    const found = capabilityEntities(
      row({ sources: [{ kind: "document", id: "d", label: "Billing PRD", inferred: true, because: ["Payments are matched to invoices every night."] }] }),
      model,
    );
    const payment = found.entities.find((e) => e.name === "Payment");
    expect(payment?.score).toBe(2);
    expect(payment?.why).toContain("Payments are matched");
  });

  it("take an entity whose own requirement asked for the capability, though it does not name it", () => {
    const found = capabilityEntities(
      row({
        capability: "reminders",
        label: "Reminders",
        terms: [],
        sources: [{ kind: "document", id: "d", label: "Billing PRD", inferred: true, because: ["Reminders go out three days ahead"] }],
      }),
      model,
    );
    expect(found.entities.map((e) => [e.name, e.score])).toEqual([["Customer", 1]]);
    // The one that asked first, then its other requirement that says "reminder".
    expect(found.requirements.map((r) => [r.text, r.source?.line_start])).toEqual([
      ["Reminders go out three days ahead", 14],
      ["The system shall email the customer a reminder before the due date.", 12],
    ]);
  });

  it("leave out what the capability does not touch", () => {
    expect(capabilityEntities(row(), model).entities.map((e) => e.name)).not.toContain("Shipment");
    expect(capabilityEntities(row({ capability: "search", label: "Search", terms: [] }), model).entities).toEqual([]);
  });
});

describe("the requirements the gear answers", () => {
  it("are the ones that asked for the capability, with their place when the model holds them", () => {
    const found = capabilityEntities(
      row({ sources: [{ kind: "document", id: "d", label: "Billing PRD", inferred: true, because: ["Payments are matched to invoices every night."] }] }),
      model,
    );
    expect(found.requirements[0]).toEqual({
      text: "Payments are matched to invoices every night.",
      source: { path: "docs/prd/billing.md", line_start: 20 },
    });
  });

  it("add the kept entities' own requirements that use the capability's words, once each", () => {
    const withLine = entitiesOf([
      ...entity("Invoice", "number"),
      requirement("Invoice", "An invoice is numbered once it is issued.", 3),
      requirement("Invoice", "An invoice is numbered once it is issued.", 9),
      requirement("Invoice", "Totals are rounded to cents.", 4),
    ]);
    expect(capabilityEntities(row(), withLine).requirements.map((r) => r.text)).toEqual(["An invoice is numbered once it is issued."]);
  });
});

describe("the category suggested for the gear", () => {
  const categories: Record<string, string> = { "cf-gears-ledger": "bss", "cf-gears-pricing": "bss", "cf-gears-chat": "gen-ai", "hello-world": "example" };
  const index = { find: (name: string) => (categories[name] ? { category: categories[name] } as never : undefined) };
  const candidate = (name: string) => ({ name }) as PlanRow["candidates"][number];
  const none = () => [];

  it("is where most of the capability's candidates sit, examples aside", () => {
    const row = { candidates: [candidate("cf-gears-chat"), candidate("cf-gears-ledger"), candidate("cf-gears-pricing"), candidate("hello-world")] };
    expect(suggestedCategory(row, [], model, index, none)).toMatchObject({ category: "bss" });
  });

  it("else is where the gears keeping the related entities sit", () => {
    const related = entitiesOf([
      ...entity("Invoice", "number"),
      fact("Invoice", "relation", { aspect: "is paid by", value: "Payment" }),
      ...entity("Payment", "amount"),
    ]);
    const keeperOf = (keys: string[]) => keys.map((k) => (k === "payment" ? "cf-gears-ledger" : null));
    expect(suggestedCategory({ candidates: [] }, [{ key: "invoice" }], related, index, keeperOf)).toMatchObject({ category: "bss" });
  });

  it("is nothing when nothing says, or the catalogue is not read", () => {
    expect(suggestedCategory({ candidates: [candidate("unknown")] }, [], model, index, none)).toBeNull();
    expect(suggestedCategory({ candidates: [candidate("cf-gears-chat")] }, [], model, null, none)).toBeNull();
  });
});

describe("what the PRD says", () => {
  it("names the entities with what they store, and quotes the requirements", () => {
    expect(
      keptSentences({
        entities: [
          { key: "invoice", name: "Invoice", fields: ["number", "total"], why: "", score: 3 },
          { key: "invoice line", name: "Invoice line", fields: [], why: "", score: 3 },
        ],
        requirements: [{ text: "Payments are matched to invoices every night.", source: null }],
      }),
    ).toBe("It keeps Invoice (number, total) and Invoice line. The requirements it answers: “Payments are matched to invoices every night”.");
  });

  it("is empty when the Domain model says nothing about the capability", () => {
    expect(keptSentences({ entities: [], requirements: [] })).toBe("");
  });
});
