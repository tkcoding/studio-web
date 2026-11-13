/**
 * What finished while you were working — the model behind the bell.
 * From the prototype's `work-inbox.tsx` (00828880), its pure half; the panel
 * is `layout/WorkInbox.tsx`.
 *
 * Background work already reports itself: `studio-tasks` publishes a `task.*`
 * event for every transition, and the shell's live channel carries them. The
 * Background work screen answers "what is running" for someone who went
 * looking; this answers "did my thing finish" for someone who did not.
 *
 * Deliberately only the ENDINGS. A run that is queued or half-way through is
 * not news — it is the Background work screen's subject, and putting every
 * transition here would make the count meaningless within a minute.
 *
 * Deliberately not persisted, either. This is "since you opened the portal",
 * which is a question the event cursor can answer honestly; "everything you
 * have ever been told" needs a read model with a per-person read marker, and
 * inventing one in browser storage would be a second source of truth that
 * disagrees with the gear the first time two tabs are open.
 */

import type { StudioEvent, StudioRunEvent } from '@constructor-studio/mfe-shared';

/** How many endings to keep. Older ones are answered by Background work. */
export const KEEP = 30;

export interface CompletedRun {
  runId: string;
  /** `<gear>.<verb>` — `artifact.ingest`, `connector.graph_sync`, … */
  taskType: string;
  state: 'succeeded' | 'failed' | 'cancelled';
  /** The handler's own line, or its reason for stopping. */
  line?: string;
  atMs: number;
}

export interface CompletedWork {
  runs: CompletedRun[];
  unread: number;
}

export const NO_COMPLETED_WORK: CompletedWork = { runs: [], unread: 0 };

const ENDINGS = new Set(['succeeded', 'failed', 'cancelled']);

/** A task type as a person would say it: `artifact.ingest` → "Artifact ingest". */
export function taskLabel(taskType: string): string {
  const words = taskType.replace(/[._]/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Background work';
}

export function runLine(payload: StudioRunEvent): string | undefined {
  const line = (payload.summary ?? payload.error ?? '').trim();
  return line || undefined;
}

/** The ending an event announces, or `null` when it is not news. */
export function completedRunOf(event: StudioEvent): CompletedRun | null {
  if (event.subject_type !== 'task_run') return null;
  const payload = (event.payload ?? {}) as StudioRunEvent;
  if (!ENDINGS.has(payload.state)) return null;
  // Studio's own work ends every few minutes; announcing it would bury the
  // import somebody is actually waiting for.
  if (payload.asked_by_person === false) return null;
  return {
    runId: payload.run_id ?? event.subject_id,
    taskType: payload.task_type ?? 'background work',
    state: payload.state as CompletedRun['state'],
    line: runLine(payload),
    atMs: event.at_ms,
  };
}

/**
 * The list with one more ending, newest first. The stream can replay across a
 * reconnect; the channel dedupes by sequence, but a run that ends twice in one
 * page is still one entry — and then not a second unread one.
 */
export function addCompleted(work: CompletedWork, run: CompletedRun): CompletedWork {
  if (work.runs.some((r) => r.runId === run.runId)) return work;
  return { runs: [run, ...work.runs].slice(0, KEEP), unread: work.unread + 1 };
}

export function markRead(work: CompletedWork): CompletedWork {
  return work.unread === 0 ? work : { ...work, unread: 0 };
}

/** How long ago, in the one unit that matters at this distance. */
export function ago(atMs: number, nowMs: number): { unit: 'now' | 'm' | 'h' | 'd'; count: number } {
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (seconds < 60) return { unit: 'now', count: 0 };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { unit: 'm', count: minutes };
  const hours = Math.round(minutes / 60);
  return hours < 24 ? { unit: 'h', count: hours } : { unit: 'd', count: Math.round(hours / 24) };
}
