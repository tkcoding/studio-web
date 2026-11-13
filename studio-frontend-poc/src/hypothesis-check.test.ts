// A hypothesis's check as a record of the project: these pin the method
// catalogue (built in, then each kit's), the proposals with their reasons, the
// record's round trip and limit, the brief that leaves the criterion open,
// the document a reader opens, and the link from a requirement.
import { describe, expect, it } from "vitest";

import {
  BUILTIN_METHODS,
  checkIndex,
  checkWrite,
  CHECK_NOTE_MAX,
  hypothesesDocument,
  hypothesesFor,
  methodCatalogue,
  proposedBrief,
  proposedMethods,
  type Check,
  type MethodDef,
} from "./hypothesis-check";
import { hypothesesOf } from "./need-view";
import type { SpecModelReview } from "./review-state";
import type { SpecModelFact } from "./spec-model";

const benefit = (solution: string, role: string, effect: string): SpecModelFact => ({
  kind: "benefit",
  subject: solution,
  aspect: role,
  value: effect,
  text: `${solution} will let ${role} ${effect}.`,
  status: "active",
  status_because: "",
  source: { path: "docs/prd.md", line_start: 12, quote: `${solution} will help` },
});

const [search] = hypothesesOf([benefit("Search by number", "operators", "find a request in seconds")]);

const kitMethod: MethodDef = {
  id: "usability-test",
  kit: "ux",
  label: "Usability test",
  uncertainty: "Can people do the task?",
  inputs: "A prototype.",
  action: "Watch five people try.",
  limits: "Five people are not a population.",
  appliesTo: ["request"],
};

const check: Check = { methods: ["tco"], timing: "experiment", brief: "b", criterion: "", result: "Two of three found it under 10 s." };

describe("the method catalogue", () => {
  it("has the five built-in methods, then each kit's under the kit's name", () => {
    const all = methodCatalogue([kitMethod, { ...kitMethod }]);
    expect(all.slice(0, 5).map((m) => m.id)).toEqual(["problem", "benefit", "tco", "demand", "existing"]);
    expect(all.map((m) => m.id).slice(5)).toEqual(["ux/usability-test"]);
  });

  it("proposes the built-in method for the claim's uncertainty and a kit's by its words, saying why", () => {
    const p = proposedMethods(search, methodCatalogue([kitMethod]));
    expect(p[0]).toEqual({ id: "tco", why: "the claim speaks of time, effort or cost" });
    expect(p[1].id).toBe("ux/usability-test");
    expect(p[1].why).toContain("ux kit");
  });
});

describe("the check record", () => {
  it("round-trips through a review keyed hyp:", () => {
    const w = checkWrite(search, check, "abc");
    expect(w.fact_key).toMatch(/^hyp:[0-9a-f]{16}$/);
    expect(w.state).toBe("check");
    const review: SpecModelReview = { ...w, note: w.note ?? null, decided_by: "u", decided_at: "t" };
    expect(checkIndex([review]).get(w.fact_key.slice(4))).toEqual(check);
  });

  it("refuses a record over the limit rather than cut it", () => {
    expect(() => checkWrite(search, { ...check, result: "x".repeat(CHECK_NOTE_MAX) }, "")).toThrow(/longer than/);
  });

  it("reads past a record it cannot parse", () => {
    expect(checkIndex([{ fact_key: "hyp:1", state: "check", path: "", revision: "", note: "{", decided_by: "u", decided_at: "t" }]).size).toBe(0);
  });
});

describe("the brief and the document", () => {
  it("leaves the criterion open and names the limits", () => {
    const brief = proposedBrief(search, [BUILTIN_METHODS[2]], "research");
    expect(brief).toContain("Claim: Search by number — find a request in seconds, for operators.");
    expect(brief).toContain("Criterion: not agreed yet");
    expect(brief).toContain("docs/prd.md:12");
    expect(brief).toContain("Limit (Time / TCO estimate)");
  });

  it("groups the hypotheses by where they stand, with how each is checked", () => {
    const doc = hypothesesDocument([search], () => "insufficient", () => check, BUILTIN_METHODS);
    expect(doc).toContain("## Insufficient");
    expect(doc).toContain("- **Checked by:** Time / TCO estimate");
    expect(doc).toContain("_not agreed — a result is exploratory_");
    expect(doc).toContain("> Two of three found it under 10 s.");
  });
});

describe("hypotheses about a requirement", () => {
  it("are the ones whose solution it names", () => {
    expect(hypothesesFor({ id: "cpt-x-fr-search", title: "Search by number", text: "" }, [search])).toEqual([search]);
    expect(hypothesesFor({ id: "cpt-x-fr-theme", title: "Dark mode", text: "A dark theme." }, [search])).toEqual([]);
  });
});
