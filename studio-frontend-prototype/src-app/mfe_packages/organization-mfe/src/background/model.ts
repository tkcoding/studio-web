/**
 * Background work, the list's rules — carried over unchanged from the
 * prototype (src/tasks.tsx at 00828880). Pure: BackgroundScreen draws it.
 */

import type { TaskRun } from './types';

export const STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/** The list's default: what wants a look — what failed and what is running. */
export const ATTENTION_STATES = ['failed', 'running'] as const;
/** The filter value for every state (no filter is the default, failed + running). */
export const EVERY_STATE = 'all';

export type Tone = 'ok' | 'running' | 'danger' | 'warn' | 'neutral';

/** Run state → a chip's tone. */
export function stateTone(state: string): Tone {
  switch (state) {
    case 'succeeded':
      return 'ok';
    case 'running':
      return 'running';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** A run the list shows, with how many earlier runs of the same schedule it stands for. */
export type ShownRun = TaskRun & { folded?: number };

/**
 * A recurring task's succeeded runs, folded into one row: the newest stands
 * for the rest of them on the page. Every other run is its own row. A session
 * reaper firing every few minutes otherwise fills the list with "nothing
 * expired" and buries what failed.
 */
export function foldRecurring(runs: TaskRun[], recurring: ReadonlySet<string>): ShownRun[] {
  const out: ShownRun[] = [];
  const head = new Map<string, ShownRun>();
  for (const run of runs) {
    if (run.state === 'succeeded' && recurring.has(run.task_type)) {
      const first = head.get(run.task_type);
      if (first) {
        first.folded = (first.folded ?? 0) + 1;
        continue;
      }
      const row: ShownRun = { ...run, folded: 0 };
      head.set(run.task_type, row);
      out.push(row);
      continue;
    }
    out.push(run);
  }
  return out;
}

/** Runs of several states as one page, newest first: one request per state,
 *  each as deep as the page's end, merged and cut. */
export function mergePages(pages: TaskRun[][], offset: number, limit: number): TaskRun[] {
  return pages
    .flat()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(offset, offset + limit);
}

/** How long a run took, or has been going (`now` for a run still going). */
export function duration(run: TaskRun, now: number): string {
  if (!run.started_at) return '—';
  const from = new Date(run.started_at).getTime();
  const to = run.finished_at ? new Date(run.finished_at).getTime() : now;
  const ms = to - from;
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** The one line worth showing per run: what it did, why it stopped, or where
 *  it has got to — in that order. Same rule the backend's own poll endpoint uses. */
export function headline(run: TaskRun): string {
  return run.summary || run.last_error || run.progress || '—';
}

export function finished(run: TaskRun): boolean {
  return run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled';
}
