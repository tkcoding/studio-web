import { describe, expect, it } from "vitest";

import type { Connection, GearboxStatus } from "./api";
import {
  createTargetOf,
  defaultSourceId,
  deploymentCorpus,
  gearRepositoryRows,
  gearRepositoryRowsFromStatus,
  isSourceId,
  readLine,
  repositoryOf,
} from "./gear-repositories";

const ROOT = "00000000-0000-0000-0000-000000000001";

function conn(id: string, url: string, at: number, options: Record<string, string>, owner = ROOT): Connection {
  return {
    id,
    owner_tenant_id: owner,
    provider: "gear-repository",
    label: id,
    account: "",
    base_url: url,
    scope: "organization",
    secret_ref: "",
    created_at_epoch_secs: at,
    options,
  };
}

describe("gear repositories", () => {
  it("reads owner/repo off a GitHub address and names the source after the repository", () => {
    expect(repositoryOf("https://github.com/constructorfabric/gears-rust")).toBe("constructorfabric/gears-rust");
    expect(repositoryOf("https://github.com/constructorfabric/Gears_BSS.git")).toBe("constructorfabric/Gears_BSS");
    expect(repositoryOf("https://github.com/constructorfabric")).toBeNull();
    expect(repositoryOf("https://gitlab.com/a/b")).toBeNull();
    expect(defaultSourceId("https://github.com/constructorfabric/Gears_BSS.git")).toBe("gears-bss");
    expect(defaultSourceId("nonsense")).toBe("");
  });

  it("takes the source ids the engine takes as directory names", () => {
    for (const ok of ["gears-rust", "core2"]) expect(isSourceId(ok)).toBe(true);
    for (const bad of ["", "Gears", "-a", "a-", "a--b", "1a", "a_b"]) expect(isSourceId(bad)).toBe(false);
  });

  it("lists the tenant's own repositories in the engine's order, with what the engine read", () => {
    const status: GearboxStatus = {
      enabled: true,
      source_id: "gears-core",
      profiles: [],
      sources: [
        { source_id: "gears-core", repo: "cf/gears-core", git_ref: "", commit: "aaaaaaaaaa", gears: 30, connection_id: "c2" },
      ],
    };
    const rows = gearRepositoryRows(
      [
        conn("c1", "https://github.com/cf/gears-bss", 20, { source_id: "gears-bss", ref: "v1" }),
        conn("c2", "https://github.com/cf/gears-core", 10, { source_id: "gears-core" }),
        conn("c3", "https://github.com/acme/gears", 5, { source_id: "acme" }, "org-acme"),
        { ...conn("c4", "https://api.github.com", 1, {}), provider: "github" },
      ],
      ROOT,
      status,
    );
    expect(rows.map((r) => r.sourceId)).toEqual(["gears-core", "gears-bss"]);
    expect(rows[1].ref).toBe("v1");
    expect(readLine(rows[0].read)).toBe("30 gears at aaaaaaa");
    expect(readLine(rows[1].read)).toBe("not read yet");
    expect(deploymentCorpus(status)).toBeNull();
    expect(
      deploymentCorpus({
        ...status,
        sources: [{ source_id: "gears-rust", repo: "MikeFalcon77/gears-rust", git_ref: "feature/gearbox", gears: 1 }],
      })?.repo,
    ).toBe("MikeFalcon77/gears-rust");
  });

  it("shows a member who may not read the platform's connections what the engine read, read-only", () => {
    const rows = gearRepositoryRowsFromStatus({
      enabled: true,
      source_id: "gears-core",
      profiles: [],
      sources: [
        { source_id: "gears-core", repo: "cf/gears-core", git_ref: "v2", commit: "abc", gears: 3, connection_id: "c1" },
        { source_id: "gears-rust", repo: "MikeFalcon77/gears-rust", git_ref: "x", gears: 49 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ connection: null, sourceId: "gears-core", ref: "v2" });
    expect(readLine(rows[0].read)).toBe("3 gears at abc");
    expect(gearRepositoryRowsFromStatus(null)).toEqual([]);
  });

  it("tells an organization's rows from the platform's, and which one new gears go into", () => {
    const status: GearboxStatus = {
      enabled: true,
      source_id: "gears-core",
      profiles: [],
      sources: [
        { source_id: "gears-core", repo: "cf/gears-core", git_ref: "", gears: 3, connection_id: "p1", tier: "platform" },
        { source_id: "acme", repo: "acme/gears", git_ref: "", gears: 1, connection_id: "o1", tier: "organization" },
      ],
    };
    expect(gearRepositoryRowsFromStatus(status, "platform").map((r) => r.sourceId)).toEqual(["gears-core"]);
    expect(gearRepositoryRowsFromStatus(status, "organization").map((r) => r.sourceId)).toEqual(["acme"]);

    const ORG = "org-acme";
    const first = conn("o1", "https://github.com/acme/gears", 1, { source_id: "acme" }, ORG);
    const second = conn("o2", "https://github.com/acme/more", 2, { source_id: "more" }, ORG);
    // None marked: the first added.
    expect(createTargetOf(gearRepositoryRows([second, first], ORG, status))).toBe("o1");
    const marked = { ...second, options: { source_id: "more", create_target: "true" } };
    expect(createTargetOf(gearRepositoryRows([first, marked], ORG, status))).toBe("o2");
    expect(createTargetOf([])).toBeNull();
  });
});
