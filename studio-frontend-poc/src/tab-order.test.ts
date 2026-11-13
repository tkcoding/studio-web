/* A band somebody reordered is a band they built a habit on, so the two
 * failure shapes worth pinning down are a section that disappears because the
 * stored order never heard of it, and a save the gear refuses because the
 * value grew past its limit.
 */
import { describe, expect, it } from "vitest";

import { applyOrder, isDefaultOrder, MAX_ORDER_LENGTH, moveTo, parseOrder, serializeOrder } from "./tab-order";

const tabs = ["overview", "specs", "model", "builds", "team"].map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("applyOrder", () => {
  it("is the default order when nothing is stored", () => {
    expect(ids(applyOrder(tabs, []))).toEqual(ids(tabs));
  });

  it("follows the stored order", () => {
    expect(ids(applyOrder(tabs, ["team", "builds", "overview", "specs", "model"]))).toEqual([
      "team",
      "builds",
      "overview",
      "specs",
      "model",
    ]);
  });

  it("skips ids this build no longer has", () => {
    expect(ids(applyOrder(tabs, ["gone", "team", "overview", "specs", "model", "builds"]))).toEqual([
      "team",
      "overview",
      "specs",
      "model",
      "builds",
    ]);
  });

  it("puts a section added since behind its default predecessor", () => {
    // `model` is new: it goes right after `specs`, wherever `specs` now is.
    expect(ids(applyOrder(tabs, ["specs", "team", "overview", "builds"]))).toEqual([
      "specs",
      "model",
      "team",
      "overview",
      "builds",
    ]);
  });

  it("puts a new first section first", () => {
    expect(ids(applyOrder(tabs, ["team", "specs", "model", "builds"]))).toEqual([
      "overview",
      "team",
      "specs",
      "model",
      "builds",
    ]);
  });
});

describe("moveTo", () => {
  it("moves an id to the index it is dropped at", () => {
    expect(moveTo(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
  });

  it("leaves the list alone for an unknown id", () => {
    expect(moveTo(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});

describe("codec", () => {
  it("round-trips and drops blanks and repeats", () => {
    expect(parseOrder(serializeOrder(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
    expect(parseOrder(" a, ,b,a ")).toEqual(["a", "b"]);
    expect(parseOrder("")).toEqual([]);
  });

  it("never writes a value the gear would refuse", () => {
    const many = Array.from({ length: 40 }, (_, i) => `section-${i}`);
    const value = serializeOrder(many);
    expect(value.length).toBeLessThanOrEqual(MAX_ORDER_LENGTH);
    // What was cut is the tail, so the head of the chosen order survives.
    expect(parseOrder(value)).toEqual(many.slice(0, parseOrder(value).length));
  });

  it("knows the default order when it sees it", () => {
    expect(isDefaultOrder(ids(tabs), tabs)).toBe(true);
    expect(isDefaultOrder(["specs", "overview", "model", "builds", "team"], tabs)).toBe(false);
  });
});
