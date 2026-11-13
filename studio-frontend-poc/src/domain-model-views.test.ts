// The three views answer three people's questions; these pin what each puts
// first, which lines the map draws, and where a requirement's chain breaks.
import { describe, expect, it } from "vitest";

import {
  blockItems,
  entityArea,
  findingTitle,
  findRequirements,
  layout,
  mapEdges,
  neighbours,
  readiness,
  resolveQueue,
  traceChain,
} from "./domain-model-views";
import { entitiesOf, type SpecModelFact, type SpecModelFinding, type SpecRequirement } from "./spec-model";

const fact = (subject: string, kind: SpecModelFact["kind"], extra: Partial<SpecModelFact> = {}): SpecModelFact => ({
  kind,
  subject,
  aspect: "",
  value: "",
  text: `${subject} ${kind}`,
  status: "active",
  status_because: "",
  source: { path: "docs/design/a.md", line_start: 1, line_end: 1, quote: "q" },
  ...extra,
});

const req = (id: string, extra: Partial<SpecRequirement> = {}): SpecRequirement => ({
  id,
  defined_in: { path: "docs/prd.md", line_start: 3 },
  title: id,
  text: "",
  kind: "fr",
  priority: "p1",
  done: null,
  basis: "cited",
  cites: [],
  because: null,
  work: 0,
  ...extra,
});

const finding = (fingerprint: string, extra: Partial<SpecModelFinding> = {}): SpecModelFinding => ({
  fingerprint,
  rule: "reference.dangling",
  severity: "high",
  message: "ADR-0040 is cited, but the project has no ADR numbered 40.",
  sides: [],
  decide: [],
  ...extra,
});

describe("to resolve", () => {
  it("puts the documents' problems first, then questions, assumptions and buildable requirements with no basis", () => {
    const q = resolveQueue(
      [finding("f1")],
      [
        req("cpt-a", { basis: "stated", kind: "fr" }),
        req("cpt-b", { basis: "assumption", because: "Postgres everywhere" }),
        req("cpt-c", { basis: "open_question" }),
        req("cpt-adr", { basis: "stated", kind: "adr" }),
      ],
    );
    expect(q.map((i) => i.key)).toEqual(["f:f1", "q:cpt-c", "a:cpt-b", "n:cpt-a"]);
    expect(q[2].hint).toContain("“Postgres everywhere”");
  });

  it("moves a decided finding to the end and counts only what is open", () => {
    const q = resolveQueue([finding("f1", { decision: "dismissed" }), finding("f2", { severity: "low" })], []);
    expect(q.map((i) => [i.key, i.done])).toEqual([
      ["f:f2", false],
      ["f:f1", true],
    ]);
    expect(readiness(q, { cited: 3, reasoned: 1 }, 5)).toEqual({ total: 5, cited: 3, reasoned: 1, open: 1, blocking: 1, ready: false });
  });

  it("lets assumptions, unsourced requirements and unconfirmed concerns wait without stopping a build", () => {
    const q = resolveQueue(
      [finding("c1", { rule: "contradiction.value" })],
      [req("cpt-a", { basis: "stated", kind: "fr" }), req("cpt-b", { basis: "assumption" })],
    );
    expect(q[0]).toMatchObject({ concern: true, tone: "warn" });
    expect(readiness(q, {}, 2)).toMatchObject({ open: 3, blocking: 0, ready: true });
    const confirmed = resolveQueue([finding("c1", { rule: "contradiction.value", decision: "confirmed" })], []);
    expect(readiness(confirmed, {}, 0)).toMatchObject({ blocking: 1, ready: false });
    expect(readiness(resolveQueue([], [req("cpt-q", { basis: "open_question" })]), {}, 1).ready).toBe(false);
  });

  it("reads a dangling reference as what is missing", () => {
    expect(findingTitle(finding("f"))).toBe("ADR-0040 is cited, but there is no ADR numbered 40");
  });
});

describe("the model map", () => {
  const entities = entitiesOf([
    fact("Project", "entity", { text: "A project belongs to a workspace." }),
    fact("Project", "relation", { aspect: "belongs to", value: "Workspace" }),
    fact("Workspace", "entity", { text: "A workspace groups projects." }),
    fact("Gear", "entity", { text: "A gear is built by its project." }),
    fact("Note", "entity", { text: "Nothing else." }),
  ]);

  it("draws a declared relation once, and a mention where one entity's facts name another", () => {
    const edges = mapEdges(entities);
    const of = (a: string, b: string) => edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    expect(of("project", "workspace")?.kind).toBe("relation");
    expect(of("gear", "project")?.kind).toBe("mentions");
    expect(of("note", "project")).toBeUndefined();
    expect([...neighbours("project", edges)].sort()).toEqual(["gear", "workspace"]);
  });

  it("places every node inside the frame, the same way every time", () => {
    const keys = entities.map((e) => e.key);
    const edges = mapEdges(entities);
    const a = layout(keys, edges, 400, 300);
    expect(a).toEqual(layout(keys, edges, 400, 300));
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(12);
      expect(p.x).toBeLessThanOrEqual(388);
      expect(p.y).toBeGreaterThanOrEqual(12);
      expect(p.y).toBeLessThanOrEqual(288);
    }
  });

  it("groups an entity by the folder most of its facts come from", () => {
    expect(entityArea({ facts: [fact("x", "entity"), fact("x", "lifecycle"), fact("x", "attribute", { source: { path: "PRODUCT.md" } })] })).toBe("docs/design");
  });
});

describe("requirements", () => {
  it("reads a block as list items: a done mark and priority stay with the identifier they mark", () => {
    expect(blockItems("- workspaces - [x] `p1` - `cpt-studio-fr-x` - `/cf/api`")).toEqual([
      [{ t: "text", v: "workspaces" }],
      [{ t: "done" }, { t: "priority", v: "p1" }, { t: "text", v: " " }, { t: "id", v: "cpt-studio-fr-x" }],
      [{ t: "code", v: "/cf/api" }],
    ]);
  });

  it("follows a requirement to where its chain breaks", () => {
    const r = req("cpt-a", { cites: ["cpt-b"] });
    const chain = traceChain(r, { id: "cpt-a", defined_in: r.defined_in, title: null, text: "", documents: [{ path: "d.md" }], code: [], tests: [] }, []);
    expect(chain.map((s) => [s.label, s.on])).toEqual([
      ["Stated in", true],
      ["Rests on 1 identifier", true],
      ["Used by 1 document", true],
      ["No issue or PR names it", false],
      ["No code names it", false],
      ["No test names it", false],
    ]);
    expect(traceChain(r, null, [])[4].label).toBe("The code is not read yet");
  });

  it("finds by basis and by words", () => {
    const all = [req("cpt-a", { title: "Tenants", basis: "stated" }), req("cpt-b", { title: "Billing" })];
    expect(findRequirements(all, "all", "tenant").map((r) => r.id)).toEqual(["cpt-a"]);
    expect(findRequirements(all, "cited", "").map((r) => r.id)).toEqual(["cpt-b"]);
  });
});
