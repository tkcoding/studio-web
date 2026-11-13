import { describe, expect, it } from "vitest";
import { responsibilityOf } from "./responsibility";

describe("the responsibility map", () => {
  it("lists every role, held or not, in a fixed order", () => {
    const map = responsibilityOf({});

    expect(map.roles.map((r) => r.role)).toEqual([
      "Path owner",
      "Maintainer approval",
      "Code experts",
      "Roadmap assignees",
      "Product manager",
      "Architecture reviewer",
      "3rd-line support",
    ]);
    expect(map.held).toBe(0);
    expect(map.roles.every((r) => r.holders.length === 0)).toBe(true);
  });

  it("names the holders the sources give, with their link and grade", () => {
    const map = responsibilityOf({
      owner: { b: "@constructorfabric/platform", s: "good", l: "https://github.com/constructorfabric" },
      experts: { b: "alice, bob,  carol" },
      roadmap_owner: { v: "dave and erin" },
      pm: { b: "none" },
    });

    const role = (key: string) => map.roles.find((r) => r.key === key)!;
    expect(role("owner")).toMatchObject({ holders: ["@constructorfabric/platform"], lamp: "good", source: "CODEOWNERS" });
    expect(role("experts").holders).toEqual(["alice", "bob", "carol"]);
    expect(role("roadmap_owner").holders).toEqual(["dave", "erin"]);
    expect(role("pm").holders).toEqual([]);
    expect(map.held).toBe(3);
  });
});
