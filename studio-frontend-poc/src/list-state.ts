/* ── A list's state, in the address ──────────────────────────────────────────
 *
 * Search, filters, sort and page of the list on screen, read from and written
 * to the query string, so a reload, a shared link or Back puts the list back
 * as it was (docs/list-standard.md, "The address").
 *
 *   ?q=adr                 the search
 *   ?f.review=needs-check  one filter, by name; absent means "all"
 *   ?sort=updated          a column, ascending; `-updated` is descending
 *   ?page=3                counted from 1; absent means the first page
 *
 * Written with `replaceState`: a list refined is the same place, and pushing
 * every keystroke would turn Back into an undo for typing. Parameters that are
 * not a list's — `?org=` — are left exactly as they were.
 *
 * The parsing, the writing and the client-side pipeline are plain functions,
 * tested on their own; the hook is the thin part that touches `window`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export interface ListState {
  q: string;
  /** Filter name → the one value chosen. A filter left at "all" is absent. */
  filters: Record<string, string>;
  /** `null` is the list's own default order. */
  sort: SortState | null;
  /** Zero-based. */
  page: number;
}

export const EMPTY_LIST_STATE: ListState = { q: "", filters: {}, sort: null, page: 0 };

/** The event the shell fires after it rewrites the address for a new place.
 *  `pushState` fires nothing on its own, and a list that outlives a place
 *  change (the same table, another workspace) must not keep the old query. */
export const URL_CHANGE_EVENT = "studio:urlchange";

const FILTER = "f.";

/** The list state an address carries. `prefix` separates two lists on one
 *  screen (`conn.q`, `conn.f.kind`); most screens have one list and none. */
export function readListState(search: string, prefix = ""): ListState {
  const params = new URLSearchParams(search);
  const name = (key: string) => `${prefix}${key}`;
  const filters: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key.startsWith(name(FILTER)) && value !== "") {
      filters[key.slice(name(FILTER).length)] = value;
    }
  }
  const rawSort = params.get(name("sort")) ?? "";
  const sort: SortState | null = rawSort
    ? rawSort.startsWith("-")
      ? { key: rawSort.slice(1), dir: "desc" }
      : { key: rawSort, dir: "asc" }
    : null;
  const page = Number.parseInt(params.get(name("page")) ?? "", 10);
  return {
    q: params.get(name("q")) ?? "",
    filters,
    sort: sort && sort.key ? sort : null,
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
  };
}

/** `search` with this list's part replaced by `state`. Defaults are left out,
 *  so an untouched list leaves the address as clean as it found it. */
export function writeListState(search: string, state: ListState, prefix = ""): string {
  const params = new URLSearchParams(search);
  const name = (key: string) => `${prefix}${key}`;
  for (const key of [...params.keys()]) {
    if (
      key === name("q") ||
      key === name("sort") ||
      key === name("page") ||
      key.startsWith(name(FILTER))
    ) {
      params.delete(key);
    }
  }
  if (state.q.trim()) params.set(name("q"), state.q);
  for (const [filter, value] of Object.entries(state.filters)) {
    if (value !== "") params.set(name(FILTER + filter), value);
  }
  if (state.sort) params.set(name("sort"), `${state.sort.dir === "desc" ? "-" : ""}${state.sort.key}`);
  if (state.page > 0) params.set(name("page"), String(state.page + 1));
  const out = params.toString();
  return out ? `?${out}` : "";
}

/** A header clicked: ascending, then descending, then back to the default. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/* ── The pipeline a whole list goes through in the browser ───────────────── */

export interface ClientFilter<T> {
  id: string;
  /** Whether `row` belongs under `value`. */
  match: (row: T, value: string) => boolean;
  options: readonly { value: string }[];
}

export interface ClientSpec<T> {
  /** The text a search looks in. Omitted, the list has no search. */
  searchText?: (row: T) => readonly (string | null | undefined)[];
  filters?: readonly ClientFilter<T>[];
  /** Column id → comparator, for the columns that sort. */
  comparators?: Readonly<Record<string, (a: T, b: T) => number>>;
}

export interface ClientResult<T> {
  /** Every row that passes the search and the filters, in order. */
  matched: T[];
  /** Filter id → option value → how many rows that option would show, under
   *  the search and every OTHER filter. What a chip's count means. */
  counts: Record<string, Record<string, number>>;
}

const passes = <T,>(row: T, filters: readonly ClientFilter<T>[], chosen: Record<string, string>, skip?: string) =>
  filters.every((f) => f.id === skip || !chosen[f.id] || f.match(row, chosen[f.id]));

/** Search, filter and sort a whole list, and count what each filter option
 *  would show. Stable: rows that compare equal keep the order they came in. */
export function applyClient<T>(rows: readonly T[], state: ListState, spec: ClientSpec<T>): ClientResult<T> {
  const needle = state.q.trim().toLowerCase();
  const searched =
    needle && spec.searchText
      ? rows.filter((row) =>
          spec.searchText!(row).some((field) => (field ?? "").toLowerCase().includes(needle)),
        )
      : [...rows];
  const filters = spec.filters ?? [];
  const matched = searched.filter((row) => passes(row, filters, state.filters));

  const counts: Record<string, Record<string, number>> = {};
  for (const filter of filters) {
    const pool = searched.filter((row) => passes(row, filters, state.filters, filter.id));
    const byValue: Record<string, number> = {};
    for (const option of filter.options) {
      byValue[option.value] = pool.filter((row) => filter.match(row, option.value)).length;
    }
    counts[filter.id] = byValue;
  }

  const compare = state.sort ? spec.comparators?.[state.sort.key] : undefined;
  if (compare) {
    const sign = state.sort!.dir === "desc" ? -1 : 1;
    const indexed = matched.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => sign * compare(a.row, b.row) || a.i - b.i);
    return { matched: indexed.map((x) => x.row), counts };
  }
  return { matched, counts };
}

/* ── The hook ────────────────────────────────────────────────────────────── */

export interface ListControls {
  setQ: (q: string) => void;
  setFilter: (id: string, value: string | null) => void;
  toggleSort: (key: string) => void;
  setPage: (page: number) => void;
  /** Search and filters back to nothing; sort is kept, it is not a filter. */
  clearFilters: () => void;
}

/** This list's state, kept in the address. A new search or filter goes back
 *  to page one — it is a new question. */
export function useListState(prefix = ""): [ListState, ListControls] {
  const [state, setState] = useState<ListState>(() =>
    typeof window === "undefined" ? EMPTY_LIST_STATE : readListState(window.location.search, prefix),
  );

  useEffect(() => {
    const reread = () => setState(readListState(window.location.search, prefix));
    window.addEventListener("popstate", reread);
    window.addEventListener(URL_CHANGE_EVENT, reread);
    return () => {
      window.removeEventListener("popstate", reread);
      window.removeEventListener(URL_CHANGE_EVENT, reread);
    };
  }, [prefix]);

  const commit = useCallback(
    (next: ListState) => {
      setState(next);
      const search = writeListState(window.location.search, next, prefix);
      if (search !== window.location.search) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
      }
    },
    [prefix],
  );

  const controls = useMemo<ListControls>(
    () => ({
      setQ: (q) => commit({ ...readCurrent(), q, page: 0 }),
      setFilter: (id, value) => {
        const current = readCurrent();
        const filters = { ...current.filters };
        if (value === null || value === "") delete filters[id];
        else filters[id] = value;
        commit({ ...current, filters, page: 0 });
      },
      toggleSort: (key) => {
        const current = readCurrent();
        commit({ ...current, sort: nextSort(current.sort, key), page: 0 });
      },
      setPage: (page) => commit({ ...readCurrent(), page: Math.max(0, page) }),
      clearFilters: () => commit({ ...readCurrent(), q: "", filters: {}, page: 0 }),
    }),
    // `readCurrent` reads the address, which `commit` keeps in step with state,
    // so two calls in one event see each other's change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, prefix],
  );

  function readCurrent(): ListState {
    return readListState(window.location.search, prefix);
  }

  return [state, controls];
}
