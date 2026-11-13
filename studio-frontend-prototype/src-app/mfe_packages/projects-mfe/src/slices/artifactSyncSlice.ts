/** Where a project's import stands */

import { createSlice, type ReducerPayload } from '@gears-frontx/react';
import { runCount, type Refusal, type RunUpdate } from '@constructor-studio/mfe-shared';
import { inFlight, repoStatusOf, type RepoImportStatus } from '../model/repoImport';

export type { RepoImportStatus } from '../model/repoImport';

export interface RepoImport {
  repo: string;
  runId: string | null;
  status: RepoImportStatus;
  /** The phase the gear last reported, while it runs. */
  phase: string | null;
  /** The gear's one line about what it did, once it succeeded. */
  summary: string | null;
  /** Why it stopped. */
  reason: Refusal | null;
  /** Nodes the sync has flushed so far. */
  stored: number;
  /** Cancel was asked for and the gear has not recorded it yet. */
  cancelling: boolean;
  /** The gear refused the last cancel or retry. */
  refusal: Refusal | null;
}

export type ImportPhase = 'idle' | 'running' | 'settled' | 'failed';

export interface ProjectImport {
  phase: ImportPhase;
  attempted: boolean;
  /** The gear was asked for the project's syncs in flight since it opened. */
  lookedUp: boolean;
  repos: RepoImport[];
}

export interface ArtifactSyncState {
  byProject: Record<string, ProjectImport>;
}

const SLICE_KEY = 'projects/artifact-sync' as const;

const initialState: ArtifactSyncState = { byProject: {} };

const EMPTY: ProjectImport = { phase: 'idle', attempted: false, lookedUp: false, repos: [] };

// @cpt-state:cpt-studiofrontend-state-project-artifacts-import:p2
function settle(repos: readonly RepoImport[]): ImportPhase {
  if (repos.length === 0) return 'settled';
  if (repos.some((r) => inFlight(r.status))) return 'running';
  return repos.some((r) => r.status === 'succeeded') ? 'settled' : 'failed';
}

function row(repo: string, status: RepoImportStatus, reason: Refusal | null): RepoImport {
  return {
    repo,
    runId: null,
    status,
    phase: null,
    summary: null,
    reason,
    stored: 0,
    cancelling: false,
    refusal: null,
  };
}

function wasLookedUp(state: ArtifactSyncState, projectId: string): boolean {
  return state.byProject[projectId]?.lookedUp ?? false;
}

function repoOf(state: ArtifactSyncState, projectId: string, repo: string) {
  const entry = state.byProject[projectId];
  const found = entry?.repos.find((r) => r.repo === repo);
  return entry && found ? { entry, row: found } : null;
}

function applyUpdate(target: RepoImport, update: RunUpdate): void {
  if (update.phase !== undefined) target.phase = update.phase;
  if (update.result) target.stored = runCount(update.result, 'stored');
  target.status = repoStatusOf(update.state, target.phase);
  if (target.status === 'succeeded') target.summary = update.summary ?? target.summary;
  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-14
  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-15
  if (target.status === 'failed' || target.status === 'cancelled') {
    const said = update.error ?? null;
    target.reason = said ? { kind: 'provider', text: said } : null;
  }
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-14
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-15
  if (!inFlight(target.status)) target.cancelling = false;
}

const {
  slice,
  importStarted,
  reposAdded,
  repoEnqueued,
  repoUpdated,
  importResumed,
  lookupStarted,
  importLookedUp,
  repoProgressed,
  repoCancelling,
  repoRetried,
  repoControlRefused,
  importAbandoned,
} = createSlice({
  name: SLICE_KEY,
  initialState,
  reducers: {
    importStarted: (
      state: ArtifactSyncState,
      action: ReducerPayload<{
        projectId: string;
        repos: string[];
        unsyncable: { repo: string; reason: Refusal }[];
      }>
    ) => {
      const { projectId, repos, unsyncable } = action.payload;
      const rows: RepoImport[] = [
        ...repos.map((repo) => row(repo, 'queued', null)),
        ...unsyncable.map(({ repo, reason }) => row(repo, 'unsyncable', reason)),
      ];
      state.byProject[projectId] = {
        phase: settle(rows),
        attempted: true,
        lookedUp: wasLookedUp(state, projectId),
        repos: rows,
      };
    },

    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-2
    reposAdded: (
      state: ArtifactSyncState,
      action: ReducerPayload<{
        projectId: string;
        repos: string[];
        unsyncable: { repo: string; reason: Refusal }[];
      }>
    ) => {
      const { projectId, repos, unsyncable } = action.payload;
      const added = [
        ...repos.map((repo) => row(repo, 'queued', null)),
        ...unsyncable.map(({ repo, reason }) => row(repo, 'unsyncable', reason)),
      ];
      const kept = (state.byProject[projectId]?.repos ?? []).filter(
        (line) => !added.some((next) => next.repo === line.repo) || inFlight(line.status)
      );
      const fresh = added.filter(
        (next) => !kept.some((line) => line.repo === next.repo)
      );
      const rows = [...kept, ...fresh];
      state.byProject[projectId] = {
        phase: settle(rows),
        attempted: true,
        lookedUp: wasLookedUp(state, projectId),
        repos: rows,
      };
    },
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-2

    repoEnqueued: (
      state: ArtifactSyncState,
      action: ReducerPayload<{ projectId: string; repo: string; runId: string }>
    ) => {
      const found = repoOf(state, action.payload.projectId, action.payload.repo);
      if (found) found.row.runId = action.payload.runId;
    },

    repoUpdated: (
      state: ArtifactSyncState,
      action: ReducerPayload<{ projectId: string; repo: string; update: RunUpdate }>
    ) => {
      const { projectId, repo, update } = action.payload;
      const found = repoOf(state, projectId, repo);
      if (!found) return;
      applyUpdate(found.row, update);
      found.entry.phase = settle(found.entry.repos);
    },

    /** The gear's syncs for the project, found again: each gets its line with its run; every other line is kept. */
    importResumed: (
      state: ArtifactSyncState,
      action: ReducerPayload<{ projectId: string; runs: { repo: string; update: RunUpdate }[] }>
    ) => {
      const { projectId, runs } = action.payload;
      const resumed = runs.map(({ repo, update }) => {
        const line = row(repo, 'queued', null);
        line.runId = update.runId;
        applyUpdate(line, update);
        return line;
      });
      const kept = (state.byProject[projectId]?.repos ?? []).filter(
        (line) => !resumed.some((next) => next.repo === line.repo)
      );
      const rows = [...kept, ...resumed];
      state.byProject[projectId] = {
        phase: settle(rows),
        attempted: true,
        lookedUp: true,
        repos: rows,
      };
    },

    /** The project opened: until the gear answers, nothing may start a sync on its own. */
    lookupStarted: (state: ArtifactSyncState, action: ReducerPayload<string>) => {
      state.byProject[action.payload] = { ...projectImport(state, action.payload), lookedUp: false };
    },

    importLookedUp: (state: ArtifactSyncState, action: ReducerPayload<string>) => {
      state.byProject[action.payload] = { ...projectImport(state, action.payload), lookedUp: true };
    },

    /** The portal's own verdict: the request was refused, or the run is gone. */
    repoProgressed: (
      state: ArtifactSyncState,
      action: ReducerPayload<{
        projectId: string;
        repo: string;
        status: RepoImportStatus;
        reason: Refusal | null;
      }>
    ) => {
      const { projectId, repo, status, reason } = action.payload;
      const found = repoOf(state, projectId, repo);
      if (!found) return;
      found.row.status = status;
      found.row.reason = reason;
      found.row.cancelling = false;
      found.entry.phase = settle(found.entry.repos);
    },

    repoCancelling: (
      state: ArtifactSyncState,
      action: ReducerPayload<{ projectId: string; repo: string }>
    ) => {
      const found = repoOf(state, action.payload.projectId, action.payload.repo);
      if (!found) return;
      found.row.cancelling = true;
      found.row.refusal = null;
    },

    /** Back on the queue, the same run: what it said last time no longer stands. */
    repoRetried: (
      state: ArtifactSyncState,
      action: ReducerPayload<{ projectId: string; repo: string }>
    ) => {
      const found = repoOf(state, action.payload.projectId, action.payload.repo);
      if (!found) return;
      Object.assign(found.row, {
        status: 'queued',
        phase: null,
        summary: null,
        reason: null,
        stored: 0,
        cancelling: false,
        refusal: null,
      });
      found.entry.phase = settle(found.entry.repos);
    },

    repoControlRefused: (
      state: ArtifactSyncState,
      action: ReducerPayload<{ projectId: string; repo: string; refusal: Refusal }>
    ) => {
      const found = repoOf(state, action.payload.projectId, action.payload.repo);
      if (!found) return;
      found.row.cancelling = false;
      found.row.refusal = action.payload.refusal;
    },

    importAbandoned: (state: ArtifactSyncState, action: ReducerPayload<string>) => {
      const entry = state.byProject[action.payload];
      if (entry) state.byProject[action.payload] = { ...EMPTY, attempted: entry.attempted };
    },
  },
});

export const artifactSyncSlice = slice;
export {
  importStarted,
  reposAdded,
  repoEnqueued,
  repoUpdated,
  importResumed,
  lookupStarted,
  importLookedUp,
  repoProgressed,
  repoCancelling,
  repoRetried,
  repoControlRefused,
  importAbandoned,
};
export const ARTIFACT_SYNC_SLICE_KEY = SLICE_KEY;

export function projectImport(state: ArtifactSyncState, projectId: string): ProjectImport {
  return state.byProject[projectId] ?? EMPTY;
}

declare module '@gears-frontx/react' {
  interface RootState {
    'projects/artifact-sync': ArtifactSyncState;
  }
}

export default slice.reducer;
