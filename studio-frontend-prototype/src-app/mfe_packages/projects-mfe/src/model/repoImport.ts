import {
  runUpdateFromRun,
  type RunUpdate,
  type StudioRun,
  type StudioRunState,
} from '@constructor-studio/mfe-shared';

/** `TASK_TYPE` in `studio-backend/src/artifact_ingest/ingest_task.rs`. */
export const INGEST_TASK_TYPE = 'artifact.ingest';

export interface ResumedRun {
  repo: string;
  update: RunUpdate;
}

/**
 * The project's syncs among the listed runs, one per repository: a running run
 * over a queued one, else the first listed (the gear lists newest first).
 */
export function projectRuns(runs: readonly StudioRun[], projectId: string): ResumedRun[] {
  const byRepo = new Map<string, StudioRun>();
  for (const run of runs) {
    const payload = run.payload as { project_id?: unknown; repo_full_path?: unknown } | null;
    if (payload?.project_id !== projectId || typeof payload.repo_full_path !== 'string') continue;
    const kept = byRepo.get(payload.repo_full_path);
    if (!kept || (kept.state !== 'running' && run.state === 'running')) {
      byRepo.set(payload.repo_full_path, run);
    }
  }
  return [...byRepo].map(([repo, run]) => ({ repo, update: runUpdateFromRun(run) }));
}

export type RepoImportStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'lost'
  | 'unsyncable';

/**
 * The phase an ingest reports while it waits for the one ingest slot
 * (`studio-backend/src/artifact_ingest/ingest_task.rs`).
 */
const WAITING_FOR_SLOT = 'waiting for another repository';

/** A run's state as its repository's line says it. */
export function repoStatusOf(state: StudioRunState, phase: string | null): RepoImportStatus {
  return state === 'running' && phase?.startsWith(WAITING_FOR_SLOT) ? 'queued' : state;
}

export function inFlight(status: RepoImportStatus): boolean {
  return status === 'queued' || status === 'running';
}

interface RepoRun {
  runId: string | null;
  status: RepoImportStatus;
}

export function canCancel(row: RepoRun): boolean {
  return row.runId !== null && inFlight(row.status);
}

export function canRetry(row: RepoRun): boolean {
  return row.runId !== null && (row.status === 'failed' || row.status === 'cancelled');
}
