// @cpt-flow:cpt-studiofrontend-flow-project-sources-row-menu:p1
// @cpt-flow:cpt-studiofrontend-flow-project-specs-from-source:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-menu-sync:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-menu-specs:p1
import { useCallback, useMemo } from 'react';
import { eventBus, useAppDispatch, useMfeBridge } from '@gears-frontx/react';
import { announceSection } from '../actions/projectsActions';
import type { ShareMode } from '../model/projectSources';
import type { SourceRow } from '../model/sourceRows';
import { syncPlan } from '../model/syncRequest';
import { showSourceSpecs } from '../slices/specsFilterSlice';
import { cancelRepoSync, retryRepoSync } from './useArtifactImport';
import { useSourceConnections } from './useConnections';
import { useSourceDetach } from './useSourceDetach';
import '../events/artifactEvents';
import '../events/sourcesConnectEvents';

export interface SourceRowActions {
  connectionsRead: boolean;
  providerName: (provider: string) => string;
  syncNow: (row: SourceRow, retry: boolean) => void;
  cancelSync: (row: SourceRow) => void;
  openSpecs: (row: SourceRow) => void;
  openUploads: () => void;
  /** Write how "Share with the team" lands edits in the row's repository. */
  changeShareMode: (row: SourceRow, mode: ShareMode) => void;
  /** Detach the row's repository from the project, as one backend run (#1042). */
  detach: (row: SourceRow) => void;
  /** Rows whose detach is running, by row id. */
  detaching: ReadonlySet<string>;
}

export function useSourceRowActions(
  projectId: string,
  workspaceId: string | null,
  orgId: string
): SourceRowActions {
  const dispatch = useAppDispatch();
  const bridge = useMfeBridge();
  const { byId, loading, failed, providerName } = useSourceConnections(orgId, projectId);
  const { detach, detaching } = useSourceDetach(projectId);

  const syncNow = useCallback(
    (row: SourceRow, retry: boolean) => {
      if (retry) {
        retryRepoSync(projectId, row.fullPath);
        return;
      }
      const source = {
        connection_id: row.connectionId,
        full_path: row.fullPath,
        clone_url: row.cloneUrl,
      };
      eventBus.emit('mfe/artifacts/repos-added', {
        projectId,
        workspaceId,
        ...syncPlan([source], byId),
      });
    },
    [projectId, workspaceId, byId]
  );

  const cancelSync = useCallback(
    (row: SourceRow) => cancelRepoSync(projectId, row.fullPath),
    [projectId]
  );

  const openSpecs = useCallback(
    (row: SourceRow) => {
      dispatch(showSourceSpecs(row.fullPath));
      announceSection(bridge, 'specs');
    },
    [dispatch, bridge]
  );

  const openUploads = useCallback(() => announceSection(bridge, 'artifacts'), [bridge]);

  const changeShareMode = useCallback(
    (row: SourceRow, mode: ShareMode) => {
      if (mode === row.shareMode) return;
      eventBus.emit('mfe/projects/source-share-mode-requested', {
        projectId,
        rowId: row.id,
        connectionId: row.connectionId,
        fullPath: row.fullPath,
        mode,
      });
    },
    [projectId]
  );

  const connectionsRead = !loading && !failed;
  return useMemo(
    () => ({
      connectionsRead,
      providerName,
      syncNow,
      cancelSync,
      openSpecs,
      openUploads,
      changeShareMode,
      detach,
      detaching,
    }),
    [
      connectionsRead,
      providerName,
      syncNow,
      cancelSync,
      openSpecs,
      openUploads,
      changeShareMode,
      detach,
      detaching,
    ]
  );
}
