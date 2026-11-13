// What kind of requirement an identifier is, and what the requirements as a
// whole lack: these pin the reading the Requirements view groups by.
import { describe, expect, it } from "vitest";

import { classify, requirementProblems, tallyTypes } from "./requirement-types";
import type { SpecRequirement } from "./spec-model";

let seq = 0;
const req = (kind: string, path = "docs/prd/constructor-studio.md", extra: Partial<SpecRequirement> = {}): SpecRequirement => ({
  id: `cpt-x-${kind}-${seq++}`,
  defined_in: { path, line_start: 1 },
  title: null,
  text: "",
  kind,
  priority: null,
  done: null,
  basis: "stated",
  cites: [],
  because: null,
  work: 0,
  ...extra,
});

describe("what kind of requirement an identifier is", () => {
  it("reads the kind, and a principle by where it is written", () => {
    expect(classify(req("fr"))).toEqual({ type: "functional", level: "user", nature: "functional" });
    expect(classify(req("fr", "docs/design/x.md"))).toEqual({ type: "functional", level: "system", nature: "functional" });
    expect(classify(req("nfr"))?.type).toBe("nonfunctional");
    expect(classify(req("principle"))?.type).toBe("rule");
    expect(classify(req("principle", "docs/design/x.md"))?.type).toBe("nonfunctional");
    expect(classify(req("constraint"))).toEqual({ type: "constraint", level: "system", nature: "nonfunctional" });
  });

  it("takes a part of the design for what it is, not a requirement", () => {
    for (const k of ["component", "seq", "design", "entity", "dbtable", "adr"]) expect(classify(req(k))).toBeNull();
    expect(classify(req("whatever"))).toBeNull();
  });

  it("counts every type, so an empty one shows", () => {
    const t = tallyTypes([req("fr", undefined, { basis: "cited" }), req("fr"), req("component")]);
    expect(t.design).toBe(1);
    expect(t.types.find((x) => x.type === "functional")).toEqual({ type: "functional", n: 2, grounded: 1 });
    expect(t.types.find((x) => x.type === "transition")?.n).toBe(0);
  });
});

describe("what the requirements lack", () => {
  const frs = (n: number) => Array.from({ length: n }, () => req("fr", undefined, { basis: "cited" }));

  it("names a type nobody wrote, and where it goes", () => {
    const p = requirementProblems([...frs(3), req("nfr", undefined, { basis: "cited" })]);
    const business = p.find((x) => x.type === "business");
    expect(business).toMatchObject({ severity: "missing", where: { path: "docs/prd/constructor-studio.md", section: "Goals (Business Outcomes)" } });
  });

  it("says too few non-functional for what the system is asked to do", () => {
    const p = requirementProblems([...frs(100), ...Array.from({ length: 4 }, () => req("nfr", undefined, { basis: "cited" }))]);
    expect(p.find((x) => x.type === "nonfunctional")).toMatchObject({ severity: "few", title: "Only 4 non-functional requirements for 100 functional" });
  });

  it("says when a type mostly rests on nothing", () => {
    const p = requirementProblems(Array.from({ length: 10 }, () => req("constraint")));
    expect(p.find((x) => x.severity === "ungrounded")?.title).toBe("10 of 10 constraints rest on nothing");
  });
});
