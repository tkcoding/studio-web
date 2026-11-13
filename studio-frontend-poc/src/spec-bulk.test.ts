import { describe, expect, it } from "vitest";
import {
  applies,
  bodyOf,
  foldStale,
  staleCounts,
  placeByPath,
  progressLine,
  pruneSelection,
  repoShortName,
  runLimited,
  toggleAll,
  type PathRow,
} from "./spec-bulk";

describe("applies", () => {
  it("confirms only a proposal with a type", () => {
    expect(applies({ id: "a", state: "detected", type_key: "prd" }, { action: "confirm" })).toBe(true);
    expect(applies({ id: "a", state: "unknown", type_key: null }, { action: "confirm" })).toBe(false);
    expect(applies({ id: "a", state: "confirmed", type_key: "prd" }, { action: "confirm" })).toBe(false);
  });
  it("skips rows already in the asked state", () => {
    expect(applies({ id: "a", state: "manual", type_key: "adr" }, { action: "set", type_key: "adr" })).toBe(false);
    expect(applies({ id: "a", state: "detected", type_key: "adr" }, { action: "set", type_key: "adr" })).toBe(true);
    expect(applies({ id: "a", state: "not_a_document" }, { action: "reject" })).toBe(false);
    expect(applies({ id: "a", state: "unknown" }, { action: "reject" })).toBe(true);
  });
  it("sends the per-row route's body", () => {
    expect(bodyOf({ action: "set", type_key: "adr" })).toEqual({ action: "set", type_key: "adr" });
    expect(bodyOf({ action: "reject" })).toEqual({ action: "reject" });
  });
});

describe("selection", () => {
  it("select all adds the queue, and clears it when all are in", () => {
    const one = toggleAll(new Set(["x"]), ["a", "b"]);
    expect([...one].sort()).toEqual(["a", "b", "x"]);
    expect([...toggleAll(one, ["a", "b"])]).toEqual(["x"]);
    expect(toggleAll(new Set(), []).size).toBe(0);
  });
  it("drops ids no longer offered", () => {
    expect([...pruneSelection(new Set(["a", "gone"]), ["a", "b"])]).toEqual(["a"]);
  });
});

describe("runLimited", () => {
  it("never runs more than the limit at once and carries on past a failure", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    const result = await runLimited(
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      4,
      async (n) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
        if (n === 5) throw new Error("refused");
      },
      (p) => seen.push(p.done + p.failed),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.done).toBe(8);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(["refused"]);
    expect(seen[seen.length - 1]).toBe(9);
  });
  it("stops taking work once aborted", async () => {
    const ctl = new AbortController();
    const result = await runLimited(
      [1, 2, 3, 4],
      1,
      async (n) => {
        if (n === 2) ctl.abort();
      },
      () => undefined,
      ctl.signal,
    );
    expect(result.done).toBe(2);
  });
  it("words the progress line", () => {
    expect(progressLine({ done: 2, failed: 1, total: 10 }, false)).toBe("Applying to 3 of 10…");
    expect(progressLine({ done: 9, failed: 1, total: 10 }, true)).toBe("9 of 10 updated; 1 failed.");
    expect(progressLine({ done: 10, failed: 0, total: 10 }, true)).toBe("10 of 10 updated.");
  });
});

describe("rows sharing a path", () => {
  const row = (id: string, repo: string, state: string | null, full = ""): PathRow => ({
    id,
    origin: "repository",
    path: "docs/prd.md",
    repo,
    repo_full_path: full,
    state,
  });

  it("names a repository by its last path segment, else its id", () => {
    expect(repoShortName({ repo: "r1", repo_full_path: "acme/portal" })).toBe("portal");
    expect(repoShortName({ repo: "0123456789abcdef", repo_full_path: "" })).toBe("01234567");
    expect(repoShortName({ repo: "", repo_full_path: "" })).toBe("");
  });

  it("marks rows of two repositories as shared, neither stale", () => {
    const places = placeByPath([row("b1", "r1", "confirmed", "acme/a"), row("c1", "r2", null, "acme/b")]);
    expect(places.get("b1")).toEqual({ shared: true });
    expect(places.get("c1")).toEqual({ shared: true });
  });

  it("folds an unscanned copy in the same repository under the decided row", () => {
    const places = placeByPath([row("b1", "r1", "confirmed"), row("c1", "r1", null)]);
    expect(places.get("c1")).toEqual({ shared: true, staleOf: "b1" });
    expect(places.get("b1")).toEqual({ shared: true });
  });

  it("leaves a path held once alone, and ignores authored rows", () => {
    const authored: PathRow = { ...row("d1", "", null), origin: "authored", path: "" };
    const places = placeByPath([row("b1", "r1", "confirmed"), authored]);
    expect(places.size).toBe(0);
  });
});

describe("folding stale copies", () => {
  const r = (id: string, repo: string, state: string | null): PathRow => ({
    id,
    origin: "repository",
    path: id.startsWith("x") ? "x.md" : "docs/prd.md",
    repo,
    repo_full_path: "",
    state,
  });
  const rows = [r("c1", "r1", null), r("b1", "r1", "confirmed"), r("x1", "r1", null)];
  const places = placeByPath(rows);

  it("hides a stale copy until its row is opened, then lists it right after", () => {
    expect(foldStale(rows, places, new Set()).map((x) => x.id)).toEqual(["b1", "x1"]);
    expect(foldStale(rows, places, new Set(["b1"])).map((x) => x.id)).toEqual(["b1", "c1", "x1"]);
    expect(staleCounts(places).get("b1")).toBe(1);
  });
});
