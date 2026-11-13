/**
 * The prototype's `activity-filter.ts` (studio-frontend-poc/), carried with
 * what `activity-view.tsx` decided inline: which kind a visit opens on, the
 * counts in the header, and the order of the Recorded column.
 */

import type { ActivityEvent, ActivityEventKind } from '../api/types';

/** A row of the Activity table: one event, or a run of the same event one
 *  after another ("220 documents checked"), which opens to its events. */
export interface ActivityRow extends ActivityEvent {
  /** The events a collapsed run stands for, in the feed's order; absent for one. */
  items?: ActivityEvent[];
}

/** Runs shorter than this stay as they are: two of a kind read fine. */
export const RUN_MIN = 3;

/** How many of a run's events its opened row lists before "and N more". */
export const RUN_SHOWN = 100;

/** Which events the table shows: one kind, or everything. */
export type KindChoice = ActivityEventKind | 'all';

export const KIND_CHOICES: readonly KindChoice[] = ['comment', 'check', 'all'];

export function isKindChoice(value: unknown): value is KindChoice {
  return value === 'comment' || value === 'check' || value === 'all';
}

/** Folds runs of the same check in a row -- a sync that checked every
 *  document leaves hundreds of "Document checked" -- into one row each. The
 *  feed's order is kept; a run is dated by its newest event. Comments stay
 *  one per row: each is something a person said. `subject` stays empty for a
 *  run: the screen writes "N documents" in the reader's language. */
export function collapseRuns(events: readonly ActivityEvent[], min = RUN_MIN): ActivityRow[] {
  const out: ActivityRow[] = [];
  let i = 0;
  while (i < events.length) {
    let j = i + 1;
    while (j < events.length && events[j].event === events[i].event && events[j].kind === events[i].kind) j++;
    const run = events.slice(i, j);
    if (run.length < min || run[0].kind === 'comment') out.push(...run);
    else {
      const by = [...new Set(run.map((e) => e.by))];
      const newest = run.reduce((a, e) => ((e.recorded ?? '') > (a.recorded ?? '') ? e : a), run[0]);
      out.push({
        id: `run:${run[0].id}`,
        kind: run[0].kind,
        event: run[0].event,
        subject: '',
        by: by.length <= 3 ? by.join(', ') : `${by.slice(0, 3).join(', ')} +${by.length - 3}`,
        recorded: newest.recorded ?? null,
        severity: run.some((e) => e.severity === 'high') ? 'high' : null,
        items: run,
      });
    }
    i = j;
  }
  return out;
}

export function countOf(events: readonly ActivityEvent[], kind: ActivityEventKind): number {
  return events.filter((e) => e.kind === kind).length;
}

/** The kind on screen: the one chosen, else Comments when there are any --
 *  what people said is what a visit is for -- else everything. */
export function shownKind(chosen: string | undefined, events: readonly ActivityEvent[]): KindChoice {
  if (isKindChoice(chosen)) return chosen;
  return countOf(events, 'comment') > 0 ? 'comment' : 'all';
}

/** The rows the table holds for a kind, before the search. */
export function rowsFor(events: readonly ActivityEvent[], kind: KindChoice): ActivityRow[] {
  return collapseRuns(kind === 'all' ? events : events.filter((e) => e.kind === kind));
}

/** A row's time for sorting, as the prototype had it: an undated row counts as the oldest. */
export function recordedAt(e: Pick<ActivityEvent, 'recorded'>): number {
  const t = Date.parse(e.recorded ?? '');
  return Number.isNaN(t) ? -Infinity : t;
}

/** What the search looks in: every column, and a run's documents. */
export function searchText(e: ActivityRow): string[] {
  return [e.event, e.subject, e.by, e.severity ?? '', e.recorded ?? '', ...(e.items ?? []).map((i) => i.subject)];
}
