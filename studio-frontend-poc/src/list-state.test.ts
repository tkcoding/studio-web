import { describe, expect, it } from "vitest";

import { applyClient, EMPTY_LIST_STATE, nextSort, readListState, writeListState } from "./list-state";

describe("the address a list keeps", () => {
  it("reads search, filters, sort and page", () => {
    expect(readListState("?q=adr&f.review=needs-check&sort=-updated&page=3")).toEqual({
      q: "adr",
      filters: { review: "needs-check" },
      sort: { key: "updated", dir: "desc" },
      page: 2,
    });
  });

  it("reads an empty address as the list's defaults", () => {
    expect(readListState("")).toEqual(EMPTY_LIST_STATE);
    expect(readListState("?page=0&page=abc&sort=")).toEqual(EMPTY_LIST_STATE);
  });

  it("keeps what is not a list's, and leaves defaults out", () => {
    const written = writeListState("?org=o1&q=old&f.kind=x", { ...EMPTY_LIST_STATE, q: "new" });
    expect(written).toBe("?org=o1&q=new");
    expect(writeListState("?org=o1", EMPTY_LIST_STATE)).toBe("?org=o1");
    expect(writeListState("", EMPTY_LIST_STATE)).toBe("");
  });

  it("round-trips", () => {
    const state = { q: "a b", filters: { review: "open", kind: "gear" }, sort: { key: "name", dir: "asc" as const }, page: 4 };
    expect(readListState(writeListState("?org=o", state))).toEqual(state);
  });

  it("keeps two lists on one screen apart by prefix", () => {
    const search = writeListState("?q=projects", { ...EMPTY_LIST_STATE, q: "github" }, "conn.");
    expect(readListState(search).q).toBe("projects");
    expect(readListState(search, "conn.").q).toBe("github");
  });
});

describe("a header clicked", () => {
  it("sorts ascending, then descending, then back to the default", () => {
    const first = nextSort(null, "name");
    expect(first).toEqual({ key: "name", dir: "asc" });
    const second = nextSort(first, "name");
    expect(second).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(second, "name")).toBeNull();
    expect(nextSort(second, "updated")).toEqual({ key: "updated", dir: "asc" });
  });
});

describe("a whole list in the browser", () => {
  type Row = { name: string; kind: string; size: number };
  const rows: Row[] = [
    { name: "alpha", kind: "gear", size: 3 },
    { name: "beta", kind: "kit", size: 1 },
    { name: "gamma", kind: "gear", size: 2 },
    { name: "delta", kind: "gear", size: 1 },
  ];
  const spec = {
    searchText: (r: Row) => [r.name],
    filters: [
      {
        id: "kind",
        match: (r: Row, v: string) => r.kind === v,
        options: [{ value: "gear" }, { value: "kit" }],
      },
    ],
    comparators: { size: (a: Row, b: Row) => a.size - b.size },
  };

  it("searches, filters and sorts, keeping ties in the order they came", () => {
    const { matched } = applyClient(rows, { ...EMPTY_LIST_STATE, filters: { kind: "gear" }, sort: { key: "size", dir: "asc" } }, spec);
    expect(matched.map((r) => r.name)).toEqual(["delta", "gamma", "alpha"]);
    const desc = applyClient(rows, { ...EMPTY_LIST_STATE, sort: { key: "size", dir: "desc" } }, spec);
    expect(desc.matched.map((r) => r.name)).toEqual(["alpha", "gamma", "beta", "delta"]);
  });

  it("counts each option under the search and the other filters, not under itself", () => {
    const { counts, matched } = applyClient(rows, { ...EMPTY_LIST_STATE, q: "a", filters: { kind: "kit" } }, spec);
    // "a" is in alpha, beta, gamma, delta; choosing "kit" must not zero "gear".
    expect(counts.kind).toEqual({ gear: 3, kit: 1 });
    expect(matched.map((r) => r.name)).toEqual(["beta"]);
  });

  it("leaves an unknown sort key in the list's own order", () => {
    const { matched } = applyClient(rows, { ...EMPTY_LIST_STATE, sort: { key: "nope", dir: "desc" } }, spec);
    expect(matched.map((r) => r.name)).toEqual(["alpha", "beta", "gamma", "delta"]);
  });
});
