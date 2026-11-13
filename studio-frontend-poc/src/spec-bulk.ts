/** Typing many documents at once, and telling apart two rows with one path.
 *
 *  The Specs list asks a person to type every file the classifier could not
 *  settle. One select per row is right for one file and wrong for forty kit
 *  examples or a folder of ADRs: those want one decision applied to a
 *  selection. There is no bulk route; the per-row decision is the only write,
 *  so a bulk decision is that call in a loop, a few at a time. */

/** One decision for every selected row. */
export type BulkDecision =
  | { action: "confirm" }
  | { action: "set"; type_key: string }
  | { action: "reject" };

/** What the bulk decision needs to know about a row's binding. */
export interface BulkTarget {
  id: string;
  state: string;
  type_key?: string | null;
}

/** Whether `decision` would change anything for `b`, and is allowed to.
 *
 *  Confirm takes only a proposal (`detected` with a type): the server refuses
 *  to confirm a binding with no type, and confirming what a person already
 *  settled changes nothing. Set and Not-a-document skip the rows already in
 *  that state, so a re-run after a partial failure only sends the rest. */
export function applies(b: BulkTarget, decision: BulkDecision): boolean {
  switch (decision.action) {
    case "confirm":
      return b.state === "detected" && !!b.type_key;
    case "set":
      return !(b.state === "manual" && b.type_key === decision.type_key);
    case "reject":
      return b.state !== "not_a_document";
  }
}

/** The request body the per-row decision route takes for `decision`. */
export function bodyOf(decision: BulkDecision): { action: "confirm" | "set" | "reject"; type_key?: string } {
  return decision.action === "set" ? { action: "set", type_key: decision.type_key } : { action: decision.action };
}

/** A selection after the list under it changed: only the ids still offered. */
export function pruneSelection(selected: ReadonlySet<string>, offered: readonly string[]): Set<string> {
  const keep = new Set(offered);
  return new Set([...selected].filter((id) => keep.has(id)));
}

/** "Select all in this queue": every offered id selected, or none when they
 *  all already are. */
export function toggleAll(selected: ReadonlySet<string>, offered: readonly string[]): Set<string> {
  const all = offered.length > 0 && offered.every((id) => selected.has(id));
  if (all) {
    const next = new Set(selected);
    for (const id of offered) next.delete(id);
    return next;
  }
  return new Set([...selected, ...offered]);
}

export interface BulkProgress {
  done: number;
  failed: number;
  total: number;
}

/** The progress line: "Typing 12 of 40…", and what failed once it is over. */
export function progressLine(p: BulkProgress, finished: boolean): string {
  const handled = p.done + p.failed;
  if (!finished) return `Applying to ${handled} of ${p.total}…`;
  const ok = `${p.done} of ${p.total} updated`;
  return p.failed > 0 ? `${ok}; ${p.failed} failed.` : `${ok}.`;
}

/** Run `work` over `items`, at most `limit` at a time, reporting after each.
 *
 *  A failure is counted and the rest carry on: one file the server refuses
 *  must not leave thirty untouched. Stops taking new items once `signal`
 *  aborts; the ones already sent finish. */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  onProgress: (p: BulkProgress) => void,
  signal?: AbortSignal,
): Promise<BulkProgress & { errors: string[] }> {
  const p = { done: 0, failed: 0, total: items.length };
  const errors: string[] = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++];
      try {
        await work(item);
        p.done += 1;
      } catch (e) {
        p.failed += 1;
        errors.push(e instanceof Error ? e.message : String(e));
      }
      onProgress({ ...p });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return { ...p, errors };
}

// ── one path, several rows ──────────────────────────────────────────────────

/** What a path-sharing row needs. */
export interface PathRow {
  id: string;
  origin: "repository" | "authored";
  path: string;
  repo: string;
  repo_full_path: string;
  state?: string | null;
}

/** A repository named the way a reader knows it: the last part of its full
 *  path, or the start of its id when the graph no longer has the path. */
export function repoShortName(row: Pick<PathRow, "repo" | "repo_full_path">): string {
  const full = row.repo_full_path.replace(/[\\/]+$/, "");
  if (full) return full.split(/[\\/]/).pop() || full;
  return row.repo ? row.repo.slice(0, 8) : "";
}

/** How a row stands among the rows that share its path. */
export interface PathPlace {
  /** More than one row has this path: show which repository each is from. */
  shared: boolean;
  /** The row this one is a stale copy of: the same file in the same
   *  repository, left over beside the one somebody decided. Shown under it
   *  rather than as a row of its own. */
  staleOf?: string;
}

const decided = (r: PathRow) => r.state != null;

/** Place every row among the others with its path.
 *
 *  Two repositories of one project may both have `docs/prd.md`; those are two
 *  files and both stay rows, told apart by a repository chip. A row that is
 *  the same path in the SAME repository (or one whose repository is not
 *  known) and was never scanned, beside one that was, is a leftover -- a node
 *  from an earlier sync -- and folds under the decided row. */
export function placeByPath(rows: readonly PathRow[]): Map<string, PathPlace> {
  const byPath = new Map<string, PathRow[]>();
  for (const r of rows) {
    if (r.origin !== "repository" || !r.path) continue;
    const list = byPath.get(r.path) ?? [];
    list.push(r);
    byPath.set(r.path, list);
  }
  const out = new Map<string, PathPlace>();
  for (const list of byPath.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      let staleOf: string | undefined;
      if (!decided(r)) {
        const keeper = list.find(
          (o) => o.id !== r.id && decided(o) && (!r.repo || !o.repo || o.repo === r.repo),
        );
        staleOf = keeper?.id;
      }
      out.set(r.id, { shared: true, ...(staleOf ? { staleOf } : {}) });
    }
  }
  return out;
}

/** The list with every stale copy taken out of its own place: folded away
 *  under its decided row, or listed right after it when that row's copies are
 *  `open`. */
export function foldStale<R extends { id: string }>(
  rows: readonly R[],
  places: ReadonlyMap<string, PathPlace>,
  open: ReadonlySet<string>,
): R[] {
  const copies = new Map<string, R[]>();
  for (const r of rows) {
    const keeper = places.get(r.id)?.staleOf;
    if (keeper) copies.set(keeper, [...(copies.get(keeper) ?? []), r]);
  }
  const out: R[] = [];
  for (const r of rows) {
    if (places.get(r.id)?.staleOf) continue;
    out.push(r);
    if (open.has(r.id)) out.push(...(copies.get(r.id) ?? []));
  }
  return out;
}

/** How many stale copies fold under each decided row. */
export function staleCounts(places: ReadonlyMap<string, PathPlace>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of places.values()) if (p.staleOf) out.set(p.staleOf, (out.get(p.staleOf) ?? 0) + 1);
  return out;
}
