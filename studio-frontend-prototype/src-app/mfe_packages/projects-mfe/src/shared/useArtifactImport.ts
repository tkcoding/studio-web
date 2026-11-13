import type { ProjectSource } from '@constructor-studio/mfe-shared';
import { useCallback } from 'react';
import { eventBus, useAppSelector } from '@gears-frontx/react';
import { useSourceConnections } from './useConnections';
import { attemptedInTab } from './importAttempts';
import { syncPlan } from '../model/syncRequest';
import {
  ARTIFACT_SYNC_SLICE_KEY,
  projectImport,
  type ProjectImport,
} from '../slices/artifactSyncSlice';
import type { SyncRequest } from '../events/artifactEvents';
import '../events/artifactEvents';

export function useProjectImport(projectId: string): ProjectImport {
  return useAppSelector((s) => projectImport(s[ARTIFACT_SYNC_SLICE_KEY], projectId));
}

export function cancelRepoSync(projectId: string, repo: string): void {
  eventBus.emit('mfe/artifacts/cancel-requested', { projectId, repo });
}

export function retryRepoSync(projectId: string, repo: string): void {
  eventBus.emit('mfe/artifacts/retry-requested', { projectId, repo });
}

export interface ArtifactImportView {
  isFirstImport: boolean;
  canSync: boolean;
  start: () => void;
}

interface Params {
  projectId: string;
  workspaceId: string | null;
  orgId: string;
  sources: readonly ProjectSource[];
  artifactCount: number;
  artifactsRead: boolean;
}

// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-import-detect:p1
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-first-import:p2
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-sync:p2
export function useArtifactImport({
  projectId,
  workspaceId,
  orgId,
  sources,
  artifactCount,
  artifactsRead,
}: Params): ArtifactImportView {
  const state = useProjectImport(projectId);
  const {
    byId,
    loading: connectionsLoading,
    failed: connectionsFailed,
  } = useSourceConnections(orgId, projectId);

  const connectionsRead = !connectionsLoading && !connectionsFailed;

  const isFirstImport =
    artifactsRead &&
    connectionsRead &&
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-1
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-2
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-3
    sources.length > 0 &&
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-1
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-2
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-3
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-4
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-5
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-6
    artifactCount === 0 &&
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-4
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-5
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-6
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-10
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-11
    state.lookedUp &&
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-10
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-11
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-7
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-8
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-9
    !state.attempted &&
    !attemptedInTab(projectId);
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-7
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-8
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-first-import:p2:inst-9

  const start = useCallback(() => {
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-1
    const request: SyncRequest = { projectId, workspaceId, ...syncPlan(sources, byId) };
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-1
    eventBus.emit('mfe/artifacts/sync-requested', request);
  }, [projectId, workspaceId, sources, byId]);

  return {
    isFirstImport,
    canSync: sources.length > 0 && connectionsRead,
    start,
  };
}
