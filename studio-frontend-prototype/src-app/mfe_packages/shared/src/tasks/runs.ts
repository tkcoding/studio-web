/** One `studio-tasks` run as the stream and the reads both describe it. */

import type { StudioEvent, StudioRunEvent } from './StudioEventsApiService';
import type { StudioRun, StudioRunState } from './StudioTasksApiService';

/** What is known about a run now. A field left out did not change. */
export interface RunUpdate {
  runId: string;
  state: StudioRunState;
  /** The phase the handler last reported. */
  phase?: string | null;
  summary?: string | null;
  error?: string | null;
  /** The handler's counts; its shape belongs to the task type. */
  result?: Record<string, unknown> | null;
}

const SETTLED: ReadonlySet<StudioRunState> = new Set(['succeeded', 'failed', 'cancelled']);

export function isRunSettled(state: StudioRunState): boolean {
  return SETTLED.has(state);
}

/** A `task.*` event as an update; `null` for anything else on the stream. */
export function runUpdateFromEvent(event: StudioEvent): RunUpdate | null {
  if (!event.kind.startsWith('task.')) return null;
  const payload = event.payload as StudioRunEvent;
  const update: RunUpdate = { runId: event.subject_id, state: payload.state };
  if ('phase' in payload) update.phase = payload.phase;
  if ('summary' in payload) update.summary = payload.summary;
  if ('error' in payload) update.error = payload.error;
  if ('result' in payload) update.result = payload.result;
  return update;
}

/** A read of the run as an update: every field is said. */
export function runUpdateFromRun(run: StudioRun): RunUpdate {
  return {
    runId: run.id,
    state: run.state,
    phase: run.progress,
    summary: run.summary,
    error: run.last_error,
    result: run.result,
  };
}

/** One count from a run's `result`, `0` when it is not there. */
export function runCount(result: Record<string, unknown> | null | undefined, key: string): number {
  const value = result?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
