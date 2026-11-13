// The need and the hypotheses read off facts: these pin that roles group what
// they have, that a missing link is a gap and never filled in, and that a
// benefit becomes a hypothesis with a proposed check.
import { describe, expect, it } from "vitest";

import { hypothesesOf, materialDocument, materialFromFile, MATERIAL_MAX_BYTES, needGaps, needsByRole, proposeMethod } from "./need-view";
import { entitiesOf, type SpecModelFact } from "./spec-model";

const f = (kind: SpecModelFact["kind"], subject: string, aspect = "", value = "", text = `${subject}.`): SpecModelFact => ({
  kind,
  subject,
  aspect,
  value,
  text,
  status: "active",
  status_because: "",
  source: { path: "docs/discovery/interviews.md", line_start: 1 },
});

describe("the need by role", () => {
  const facts = [
    f("role", "Operator"),
    f("problem", "slow request search", "operator", "phone calls"),
    f("outcome", "find a request in seconds", "Operators"),
    f("idea", "search by number", "slow request search", "operator"),
    f("problem", "lost approvals", ""),
  ];

  it("groups what each role has and wants, and keeps an unnamed role apart", () => {
    const roles = needsByRole(facts);
    expect(roles[0]).toMatchObject({ role: "Operator" });
    expect(roles[0].problems.map((p) => p.subject)).toEqual(["slow request search"]);
    expect(roles[0].outcomes).toHaveLength(1);
    expect(roles[0].ideas).toHaveLength(1);
    expect(roles[roles.length - 1].role).toBe("");
  });

  it("shows a problem nothing solves as a gap, not one with an invented solution", () => {
    const gaps = needGaps(facts);
    expect(gaps.map((g) => g.title)).toContain("Nothing proposes to solve “lost approvals”");
    expect(gaps.map((g) => g.title)).not.toContain("Nothing proposes to solve “slow request search”");
  });

  it("shows an idea that names no problem", () => {
    expect(needGaps([f("idea", "dark mode", "", "operator")]).map((g) => g.kind)).toContain("idea-without-problem");
  });

  it("keeps the need off the model map", () => {
    expect(entitiesOf(facts).map((e) => e.key)).toEqual(["operator"]);
  });
});

describe("hypotheses", () => {
  it("turn a benefit into a claim with a proposed check, and leave the unstated empty", () => {
    const [h] = hypothesesOf([f("benefit", "search by number", "operator", "finds a request in seconds instead of minutes")]);
    expect(h).toMatchObject({ solution: "search by number", role: "operator", method: "tco" });
    expect(hypothesesOf([f("benefit", "audit log", "", "")])[0]).toMatchObject({ role: "", effect: "" });
  });

  it("read the kind of uncertainty from the claim", () => {
    expect(proposeMethod("customers ask for it every week")).toBe("demand");
    expect(proposeMethod("operators struggle to approve")).toBe("problem");
    expect(proposeMethod("the CRM already exports it")).toBe("existing");
    expect(proposeMethod("approvals will be more accurate")).toBe("benefit");
  });
});

describe("requirements and the need", () => {
  it("names a requirement no problem or goal explains, once the need is described", async () => {
    const { unlinkedRequirements } = await import("./need-view");
    const reqs = [
      { id: "cpt-a", title: "Search by number", text: "The operator finds a slow request search fast." },
      { id: "cpt-b", title: "Dark mode", text: "The portal has a dark theme." },
    ];
    expect(unlinkedRequirements(reqs, [f("problem", "slow request search", "operator")]).map((r) => r.id)).toEqual(["cpt-b"]);
    expect(unlinkedRequirements(reqs, [])).toEqual([]);
  });
});

describe("materials from files", () => {
  it("takes a text file as a material, titled from its name", () => {
    expect(materialFromFile("operator_interview-2026-10-12.md", 40, "We lose requests.")).toEqual({
      title: "operator interview 2026 10 12",
      content: "We lose requests.",
    });
    expect(materialDocument("Call", "text")).toBe("# Call\n\n## Source\n\nCall\n\n## Material\n\ntext\n");
  });

  it("refuses what is not text, too large or empty, saying why", () => {
    expect(materialFromFile("deck.pdf", 10, "%PDF")).toHaveProperty("refused");
    expect(materialFromFile("big.txt", MATERIAL_MAX_BYTES + 1, "x")).toHaveProperty("refused");
    expect(materialFromFile("blank.md", 3, "  \n")).toHaveProperty("refused");
    expect(materialFromFile("odd.txt", 3, "a\u0000b")).toHaveProperty("refused");
  });
});
