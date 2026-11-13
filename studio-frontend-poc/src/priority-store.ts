// The Priorities view's working set and its confirmed orders, kept with the
// project instead of in one browser (PRD "Prioritise functionality":
// fr-confirmation, fr-history). They are the project's decisions, stored like
// the others beside the fact reviews: an item being compared under `pri:`,
// with what a person entered for it; a confirmed order under `prc:`, with who
// confirmed it, when, the pull request and the order itself. Pure:
// priorities-screen.tsx loads and saves.

import { fnv64, type ReviewWrite, type SpecModelReview } from "./review-state";

export type { ReviewWrite };

/** What a person entered for one item. */
export interface Entry {
  impact?: number;
  confidence?: number;
  /** Person-weeks: "3", or a range "1.5-3". */
  effort?: string;
}

export interface WorkingSet {
  /** The items compared, in the order they were added. */
  items: string[];
  entries: Record<string, Entry>;
}

export const PRIORITY_PREFIX = "pri:";
export const CONFIRMED_PREFIX = "prc:";

/** A review key is at most 128 bytes; a longer identifier is hashed, and
 *  the note keeps it whole. */
export function itemKey(id: string): string {
  const key = `${PRIORITY_PREFIX}${id}`;
  return new TextEncoder().encode(key).length <= 128 ? key : `${PRIORITY_PREFIX}#${fnv64(id)}`;
}

const parse = <T>(note: string | null | undefined): T | null => {
  try {
    return note ? (JSON.parse(note) as T) : null;
  } catch {
    return null;
  }
};

/** The working set the project keeps: each item with what was entered. */
export function workingSet(reviews: SpecModelReview[]): WorkingSet {
  const rows = reviews
    .filter((r) => r.fact_key.startsWith(PRIORITY_PREFIX) && r.state === "scored")
    .map((r) => ({ r, e: parse<Entry & { id?: string }>(r.note) }))
    .filter((x): x is { r: SpecModelReview; e: Entry & { id: string } } => typeof x.e?.id === "string")
    .sort((a, b) => a.r.decided_at.localeCompare(b.r.decided_at) || a.e.id.localeCompare(b.e.id));
  const entries: Record<string, Entry> = {};
  for (const { e } of rows) {
    const { id, ...entry } = e;
    entries[id] = entry;
  }
  return { items: rows.map((x) => x.e.id), entries };
}

/** Keep an item in the comparison with what was entered for it. */
export function itemWrite(id: string, entry: Entry): ReviewWrite {
  return { fact_key: itemKey(id), state: "scored", path: "", revision: "", note: JSON.stringify({ id, ...entry }) };
}

/** Take an item out of the comparison. */
export function removeWrite(id: string): ReviewWrite {
  return { fact_key: itemKey(id), state: "proposed", path: "", revision: "" };
}

/** One line of a confirmed order: the item, its place and its score as
 *  confirmed ("6.33", "5–5.67", "incomplete"). */
export interface ConfirmedRow {
  id: string;
  rank: number;
  ice: string;
}

export interface Confirmation {
  key: string;
  at: string;
  by: string;
  prUrl: string | null;
  branch: string | null;
  rows: ConfirmedRow[];
  /** Lines past what the record holds: the document has them all. */
  more: number;
}

const NOTE_MAX = 2000;

/** A confirmed order as a record: the pull request, and as much of the
 *  order as fits, the rest counted. */
export function confirmationWrite(at: string, written: { pr_url?: string | null; branch?: string | null }, rows: ConfirmedRow[]): ReviewWrite {
  const note = (n: number) =>
    JSON.stringify({ at, pr_url: written.pr_url ?? null, branch: written.branch ?? null, rows: rows.slice(0, n), more: rows.length - n });
  let n = rows.length;
  while (n > 0 && new TextEncoder().encode(note(n)).length > NOTE_MAX) n--;
  return { fact_key: `${CONFIRMED_PREFIX}${at}`, state: "confirmed", path: "docs/priorities.md", revision: "", note: note(n) };
}

/** Every confirmed order, the latest first. */
export function confirmations(reviews: SpecModelReview[]): Confirmation[] {
  return reviews
    .filter((r) => r.fact_key.startsWith(CONFIRMED_PREFIX) && r.state === "confirmed")
    .map((r) => {
      const n = parse<{ at?: string; pr_url?: string | null; branch?: string | null; rows?: ConfirmedRow[]; more?: number }>(r.note) ?? {};
      return {
        key: r.fact_key,
        at: n.at ?? r.decided_at,
        by: r.decided_by,
        prUrl: n.pr_url ?? null,
        branch: n.branch ?? null,
        rows: Array.isArray(n.rows) ? n.rows : [],
        more: n.more ?? 0,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Whether the order now differs from the one confirmed last: another item,
 *  another place or another score among the lines the record holds. */
export function changedSince(last: Confirmation | undefined, now: ConfirmedRow[]): boolean {
  if (!last) return now.length > 0;
  if (last.rows.length + last.more !== now.length) return true;
  return last.rows.some((r, i) => now[i]?.id !== r.id || now[i]?.ice !== r.ice);
}
