import { describe, expect, it } from "vitest";
import { decisionFromRemark, orderChanges, remarkState, type Remark } from "./remarks";

const remark = (over: Partial<Remark> = {}): Remark => ({
  thread_id: "t",
  repo: "acme/specs",
  pull_number: 3,
  pull_title: "PRD",
  pull_url: "https://x/3",
  pull_state: "MERGED",
  resolved: false,
  outdated: false,
  left_open: true,
  line: 4,
  comments: [
    { author: "ann", body: "50 MB?", url: "https://x/c1" },
    { author: "bob", body: " Agreed: 50 MB. ", url: "https://x/c2" },
  ],
  requirements: ["cpt-app-fr-limit"],
  ...over,
});

describe("remarks", () => {
  it("names a remark the merge left behind", () => {
    expect(remarkState(remark())).toEqual({ label: "Left open after merge", tone: "late" });
    expect(remarkState(remark({ left_open: false, pull_state: "OPEN" })).label).toBe("Open");
    expect(remarkState(remark({ left_open: false, resolved: true })).label).toBe("Resolved");
  });

  it("drafts a decision from the thread's last word", () => {
    expect(decisionFromRemark(remark(), "docs/prd.md")).toEqual({
      statement: "Agreed: 50 MB.",
      requirements: ["cpt-app-fr-limit"],
      source_url: "https://x/c2",
      source_kind: "review_thread",
      path: "docs/prd.md",
    });
  });

  it("puts changes of meaning first", () => {
    const got = orderChanges([
      { id: "a", kind: "changed", meaning: false, why: "" },
      { id: "b", kind: "added", meaning: true, why: "" },
    ]);
    expect(got.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
