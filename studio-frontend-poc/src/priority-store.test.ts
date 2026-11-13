// The Priorities working set and its confirmed orders kept with the project:
// these pin how they are written as review records and read back, that a long
// identifier still fits a key, and that a confirmation fits its note.
import { describe, expect, it } from "vitest";

import { changedSince, confirmations, confirmationWrite, itemKey, itemWrite, removeWrite, workingSet, type ConfirmedRow, type ReviewWrite } from "./priority-store";
import type { SpecModelReview } from "./review-state";

/** A write as the server answers it back. */
const stored = (w: ReviewWrite, at: string): SpecModelReview => ({
  fact_key: w.fact_key,
  state: w.state,
  path: w.path,
  revision: w.revision,
  note: w.note ?? null,
  decided_by: "u1",
  decided_at: at,
});

describe("the working set", () => {
  it("reads back what was entered, in the order items were added", () => {
    const reviews = [
      stored(itemWrite("cpt-b", { impact: 7, effort: "1.5-3" }), "2026-10-19T09:00:01Z"),
      stored(itemWrite("cpt-a", {}), "2026-10-19T09:00:00Z"),
      stored({ fact_key: "0123456789abcdef", state: "accepted", path: "", revision: "" }, "2026-10-19T08:00:00Z"),
    ];
    expect(workingSet(reviews)).toEqual({ items: ["cpt-a", "cpt-b"], entries: { "cpt-a": {}, "cpt-b": { impact: 7, effort: "1.5-3" } } });
  });

  it("takes an item out by withdrawing its record", () => {
    expect(removeWrite("cpt-a")).toEqual({ fact_key: "pri:cpt-a", state: "proposed", path: "", revision: "" });
  });

  it("hashes an identifier too long for a key and keeps it whole in the note", () => {
    const id = `cpt-${"x".repeat(200)}`;
    const w = itemWrite(id, {});
    expect(w.fact_key).toMatch(/^pri:#[0-9a-f]{16}$/);
    expect(workingSet([stored(w, "2026-10-19T09:00:00Z")]).items).toEqual([id]);
    expect(itemKey("cpt-a")).toBe("pri:cpt-a");
  });

  it("ignores a record it cannot read", () => {
    expect(workingSet([{ ...stored(itemWrite("cpt-a", {}), "t"), note: "{" }]).items).toEqual([]);
  });
});

describe("confirmed orders", () => {
  const rows: ConfirmedRow[] = [
    { id: "cpt-a", rank: 1, ice: "7" },
    { id: "cpt-b", rank: 2, ice: "5–5.67" },
  ];

  it("keep the pull request and the order, the latest first", () => {
    const first = stored(confirmationWrite("2026-10-18T10:00:00.000Z", { pr_url: "https://x/pr/1" }, rows), "2026-10-18T10:00:01Z");
    const second = stored(confirmationWrite("2026-10-19T10:00:00.000Z", { branch: "studio/priorities" }, rows.slice(0, 1)), "2026-10-19T10:00:01Z");
    const list = confirmations([first, second]);
    expect(list.map((c) => c.at)).toEqual(["2026-10-19T10:00:00.000Z", "2026-10-18T10:00:00.000Z"]);
    expect(list[1]).toMatchObject({ prUrl: "https://x/pr/1", rows, more: 0 });
    expect(list[0].branch).toBe("studio/priorities");
  });

  it("fit the note, counting the lines left out", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `cpt-studio-item-${i}`, rank: i + 1, ice: "5" }));
    const w = confirmationWrite("2026-10-19T10:00:00.000Z", {}, many);
    expect(new TextEncoder().encode(w.note!).length).toBeLessThanOrEqual(2000);
    const [c] = confirmations([stored(w, "t")]);
    expect(c.rows.length + c.more).toBe(200);
    expect(c.more).toBeGreaterThan(0);
  });

  it("say whether the order changed since", () => {
    const [last] = confirmations([stored(confirmationWrite("2026-10-19T10:00:00.000Z", {}, rows), "t")]);
    expect(changedSince(last, rows)).toBe(false);
    expect(changedSince(last, [rows[1], rows[0]])).toBe(true);
    expect(changedSince(last, [{ ...rows[0], ice: "8" }, rows[1]])).toBe(true);
    expect(changedSince(last, rows.slice(0, 1))).toBe(true);
    expect(changedSince(undefined, rows)).toBe(true);
    expect(changedSince(undefined, [])).toBe(false);
  });
});
