import { describe, expect, it } from "vitest";

import type { CatalogRepoSource, GearboxSource } from "./api";
import { refLabel, repositoryRoles, rolesNote } from "./component-repositories";
import type { GearRepositoryRow } from "./gear-repositories";

const cat = (repo: string, mode = "gears", git_ref: string | null = "HEAD"): CatalogRepoSource => ({
  tenant: "t",
  connection_id: null,
  repo,
  git_ref,
  mode,
});
const eng = (repo: string, ref = ""): GearRepositoryRow => ({ connection: null, sourceId: repo.split("/")[1], repo, ref, read: null });

describe("a tier's component repositories", () => {
  it("are one row per repository, with both roles", () => {
    const rows = repositoryRoles(
      [eng("constructorfabric/gears-rust")],
      [cat("constructorfabric/gears-rust"), cat("constructorfabric/gears-frontx", "frontx"), cat("Constructorfabric/Gears-Rust", "kits")],
    );
    expect(rows.map((r) => r.repo)).toEqual(["constructorfabric/gears-rust", "constructorfabric/gears-frontx"]);
    expect(rows[0].engine).not.toBeNull();
    expect(rows[0].catalogue.map((c) => c.mode)).toEqual(["gears", "kits"]);
    expect(rows[1].engine).toBeNull();
    expect(rolesNote(rows[0])).toBeNull();
    expect(rolesNote(rows[1])).toBeNull();
  });

  it("show the deployment's corpus while no gear repository is connected", () => {
    const corpus = { source_id: "gears-rust", repo: "mikefalcon77/gears-rust", git_ref: "feature/gearbox", gears: 49 } as GearboxSource;
    const rows = repositoryRoles([], [cat("constructorfabric/gears-rust")], corpus);
    expect(rows[0]).toMatchObject({ repo: "mikefalcon77/gears-rust", fallback: true });
    expect(rolesNote(rows[0])).toMatch(/deployment's corpus/);
    expect(rows[1].engine).toBeNull();
  });

  it("say when the catalogue and the products read different refs", () => {
    const rows = repositoryRoles([eng("acme/gears", "v2")], [cat("acme/gears", "gears", "HEAD")]);
    expect(rolesNote(rows[0])).toBe("The catalogue reads default branch, products are built from v2.");
    expect(rolesNote(repositoryRoles([eng("acme/gears")], [])[0])).toMatch(/does not list it/);
  });

  it("read blank and HEAD as the default branch", () => {
    expect(refLabel("")).toBe("default branch");
    expect(refLabel("HEAD")).toBe("default branch");
    expect(refLabel(null)).toBe("default branch");
    expect(refLabel("v1")).toBe("v1");
  });
});
