// Checks over confirmed rules: these pin the readings, the four outcomes and
// that a conflict comes with the two passages that witness it.
import { describe, expect, it } from "vitest";

import { conflicts, describe as say, readRule } from "./rule-checks";
import type { SpecModelFact } from "./spec-model";

const c = (subject: string, aspect: string, value: string, text = ""): SpecModelFact => ({
  kind: "constraint",
  subject,
  aspect,
  value,
  text,
  status: "active",
  status_because: "",
  source: { path: "docs/prd/x.md", line_start: 1 },
});

describe("reading a rule", () => {
  it("reads a permission and says it back", () => {
    const r = readRule(c("Project", "who may delete", "only owners", "Only owners may delete a project."));
    expect(r.outcome).toBe("read");
    expect(say(r.reading!)).toBe("only owner may delete project");
  });

  it("reads a numeric bound", () => {
    const r = readRule(c("Session", "limit", "at most 3 sessions", "A member has at most 3 sessions."));
    expect(r.reading).toMatchObject({ form: "limit", bound: "max", n: 3, what: "session" });
  });

  it("says what is missing, or that it has no form for it", () => {
    expect(readRule(c("Project", "who may delete", "", "Deletion may happen later.")).outcome).toBe("incomplete");
    expect(readRule(c("Invoice", "format", "ISO 8601", "Dates are written in ISO 8601.")).outcome).toBe("unsupported");
  });
});

describe("conflicts between confirmed rules", () => {
  it("finds a bound that cannot hold with another, with both passages", () => {
    const a = readRule(c("Session", "limit", "at most 3 sessions"));
    const b = readRule(c("Session", "limit", "at least 5 sessions"));
    const [x] = conflicts([a, b]);
    expect(x.witness).toBe("session: at most 3 session, but also session: at least 5 session");
    expect([x.a, x.b]).toEqual([a, b]);
  });

  it("finds a role allowed by one rule and refused by another", () => {
    const found = conflicts([
      readRule(c("Project", "who may delete", "", "Members may delete a project.")),
      readRule(c("Project", "who may delete", "", "Members cannot delete a project.")),
    ]);
    expect(found).toHaveLength(1);
  });

  it("finds a role let in past an 'only'", () => {
    const found = conflicts([
      readRule(c("Project", "who may delete", "only owners", "Only owners may delete a project.")),
      readRule(c("Project", "who may delete", "", "Administrators may delete any project.")),
    ]);
    expect(found[0].witness).toBe("only owner may delete project, yet administrator may too");
  });

  it("finds nothing between rules about different things", () => {
    expect(conflicts([readRule(c("Project", "limit", "at most 3 repositories")), readRule(c("Workspace", "limit", "at least 5 repositories"))])).toEqual([]);
  });
});
