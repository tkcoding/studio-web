/* ── A list's state, in the address ──────────────────────────────────────────
 *
 * The prototype's `src/list-state.ts` (studio-frontend-poc/), shared by every
 * MFE that draws a list. Search, filters, sort and page of the list on screen,
 * read from and written to the query string, so a reload, a shared link or
 * Back puts the list back as it was (the prototype's docs/list-standard.md,
 * "The address").
 *
 *   ?ent.q=adr                 the search
 *   ?ent.f.review=needs-check  one filter, by name; absent means "all"
 *   ?ent.sort=updated          a column, ascending; `-updated` is descending
 *   ?ent.page=3                counted from 1; absent means the first page
 *
 * Two things differ from the prototype, both because the shell owns this
 * address (ADR-0028):
 *
 * - The shell's own entry (`screen=admin;org=…;section=…`) and anything else
 *   that is not this list's is kept **byte for byte**. `URLSearchParams` would
 *   re-encode the `;` the routing grammar splits on, so only this list's part
 *   goes through it.
 * - A list takes its part out of the address when it leaves the screen. The
 *   shell carries foreign query segments into the next place it opens, and
 *   "opening another place starts that place's list fresh". The history entry
 *   the list was on keeps its part, so Back still restores it.
 *
 * A screen's lists name themselves with a prefix ending in `.` (`ent.`,
 * `view.`). A bare `q=adr` would read to the routing grammar as an entry of a
 * domain called `q`; `ent.q` cannot, so it stays a foreign segment.
 *
 * Written with `replaceState`: a list refined is the same place, and pushing
 * every keystroke would turn Back into an undo for typing.
 *
 * The parsing, the writing and the client-side pipeline are plain functions,
 * tested on their own; the hook is the thin part that touches `window`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

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

export const EMPTY_LIST_STATE: ListState = { q: '', filters: {}, sort: null, page: 0 };

/** Fired by whoever rewrites the address for a new place without a
 *  `popstate`: a list that outlives a place change must not keep the old
 *  query. The prototype's shell fired it; any writer may. */
export const URL_CHANGE_EVENT = 'studio:urlchange';

const FILTER = 'f.';

/** The list state an address carries. `prefix` separates the lists of one
 *  screen (`conn.q`, `conn.f.kind`). */
export function readListState(search: string, prefix = ''): ListState {
  const params = new URLSearchParams(search);
  const name = (key: string) => `${prefix}${key}`;
  const filters: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key.startsWith(name(FILTER)) && value !== '') {
      filters[key.slice(name(FILTER).length)] = value;
    }
  }
  const rawSort = params.get(name('sort')) ?? '';
  const sort: SortState | null = rawSort
    ? rawSort.startsWith('-')
      ? { key: rawSort.slice(1), dir: 'desc' }
      : { key: rawSort, dir: 'asc' }
    : null;
  const page = Number.parseInt(params.get(name('page')) ?? '', 10);
  return {
    q: params.get(name('q')) ?? '',
    filters,
    sort: sort && sort.key ? sort : null,
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
  };
}

/** A segment's key as `URLSearchParams` would read it. */
function segmentKey(segment: string): string {
  const at = segment.indexOf('=');
  const raw = at === -1 ? segment : segment.slice(0, at);
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/** `search` with this list's part replaced by `state`. Defaults are left out,
 *  so an untouched list leaves the address as clean as it found it; what is
 *  not this list's is kept exactly as written. */
export function writeListState(search: string, state: ListState, prefix = ''): string {
  const name = (key: string) => `${prefix}${key}`;
  const ours = (key: string) =>
    key === name('q') || key === name('sort') || key === name('page') || key.startsWith(name(FILTER));
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const kept = raw.split('&').filter((segment) => segment !== '' && !ours(segmentKey(segment)));

  const params = new URLSearchParams();
  if (state.q.trim()) params.set(name('q'), state.q);
  for (const [filter, value] of Object.entries(state.filters)) {
    if (value !== '') params.set(name(FILTER + filter), value);
  }
  if (state.sort) params.set(name('sort'), `${state.sort.dir === 'desc' ? '-' : ''}${state.sort.key}`);
  if (state.page > 0) params.set(name('page'), String(state.page + 1));

  const out = [...kept, params.toString()].filter((part) => part !== '').join('&');
  return out ? `?${out}` : '';
}

/** A header clicked: ascending, then descending, then back to the default. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
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
      ? rows.filter((row) => spec.searchText!(row).some((field) => (field ?? '').toLowerCase().includes(needle)))
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
    const sign = state.sort!.dir === 'desc' ? -1 : 1;
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
  /** Everything back to the list's defaults: the same list now shows other rows (another saved view). */
  reset: () => void;
}

const hasWindow = () => typeof window !== 'undefined';

function replaceSearch(search: string): void {
  if (search === window.location.search) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
}

/** This list's state, kept in the address under `prefix`. A new search or
 *  filter goes back to page one — it is a new question. */
export function useListState(prefix = ''): [ListState, ListControls] {
  const [state, setState] = useState<ListState>(() =>
    hasWindow() ? readListState(window.location.search, prefix) : EMPTY_LIST_STATE
  );

  useEffect(() => {
    const reread = () => setState(readListState(window.location.search, prefix));
    window.addEventListener('popstate', reread);
    window.addEventListener(URL_CHANGE_EVENT, reread);
    return () => {
      window.removeEventListener('popstate', reread);
      window.removeEventListener(URL_CHANGE_EVENT, reread);
      // Leaving the screen: the next place starts its lists fresh.
      replaceSearch(writeListState(window.location.search, EMPTY_LIST_STATE, prefix));
    };
  }, [prefix]);

  const commit = useCallback(
    (next: ListState) => {
      setState(next);
      replaceSearch(writeListState(window.location.search, next, prefix));
    },
    [prefix]
  );

  const controls = useMemo<ListControls>(() => {
    // The address, which `commit` keeps in step with state, so two calls in
    // one event see each other's change.
    const current = () => readListState(window.location.search, prefix);
    return {
      setQ: (q) => commit({ ...current(), q, page: 0 }),
      setFilter: (id, value) => {
        const now = current();
        const filters = { ...now.filters };
        if (value === null || value === '') delete filters[id];
        else filters[id] = value;
        commit({ ...now, filters, page: 0 });
      },
      toggleSort: (key) => {
        const now = current();
        commit({ ...now, sort: nextSort(now.sort, key), page: 0 });
      },
      setPage: (page) => commit({ ...current(), page: Math.max(0, page) }),
      clearFilters: () => commit({ ...current(), q: '', filters: {}, page: 0 }),
      reset: () => commit(EMPTY_LIST_STATE),
    };
  }, [commit, prefix]);

  return [state, controls];
}
