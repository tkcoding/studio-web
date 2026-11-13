/**
 * Detach on the Sources list (#1042): one request to the backend, which takes
 * the source out of the project's config and forgets what was synced from it
 * as one durable `artifact.source_detach` run. The browser only follows that
 * run, so a closed tab no longer leaves the repository's artifacts behind in a
 * project that does not name it: the run finishes without it.
 *
 * While the run goes, the row's Disconnect reads Detaching…; when it ends the
 * project's config is read again (the row leaves) and a notice says how it
 * went.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRegistry, useQueryCache } from '@gears-frontx/react';
import {
  AccountsApiService,
  StudioEventsApiService,
  StudioTasksApiService,
  createRunFollower,
  errorMessage,
  isRunSettled,
  readCursor,
  refusalText,
  useNotify,
  type RunFollower,
} from '@constructor-studio/mfe-shared';
import { ArtifactIngestApiService } from '../api/ArtifactIngestApiService';
import { useSourcesText } from '../i18n';
import type { SourceRow } from '../model/sourceRows';
import { projectConfigQuery } from './useProjectConfig';

export interface SourceDetach {
  /** Detach the row's repository from the project; asked for after the confirmation. */
  detach: (row: SourceRow) => void;
  /** Rows whose detach is running, by row id. */
  detaching: ReadonlySet<string>;
}

export function useSourceDetach(projectId: string): SourceDetach {
  const notify = useNotify();
  const t = useSourcesText();
  const cache = useQueryCache();
  const [detaching, setDetaching] = useState<ReadonlySet<string>>(new Set());
  const followers = useRef<RunFollower[]>([]);

  useEffect(
    () => () => {
      // The run goes on without this page; only the following stops.
      for (const follower of followers.current) follower.stop();
      followers.current = [];
    },
    []
  );

  const settle = useCallback((rowId: string) => {
    setDetaching((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
  }, []);

  const detach = useCallback(
    (row: SourceRow) => {
      const name = row.name;
      const failed = (reason: string) => {
        settle(row.id);
        notify({ kind: 'error', text: t('detach_failed', { name, reason }) });
      };
      setDetaching((current) => new Set(current).add(row.id));
      void (async () => {
        const events = apiRegistry.getService(StudioEventsApiService);
        const tasks = apiRegistry.getService(StudioTasksApiService);
        // Read before the run starts, so an end the stream carries is not missed.
        const cursor = await readCursor(events, 'projects');
        let runId: string;
        try {
          const queued = await apiRegistry
            .getService(ArtifactIngestApiService)
            .detachSource(projectId)
            .fetch({ clone_url: row.cloneUrl });
          runId = queued.run_id;
        } catch (error) {
          failed(refusalText(error) ?? errorMessage(error));
          return;
        }
        const follower = createRunFollower({
          events,
          tasks,
          onRun: (update) => {
            if (!isRunSettled(update.state)) return;
            follower.stop();
            if (update.state !== 'succeeded') {
              failed(update.error ?? update.state);
              return;
            }
            settle(row.id);
            notify({ kind: 'success', text: t('detach_done', { name }) });
            const accounts = apiRegistry.getService(AccountsApiService);
            void cache.invalidate(projectConfigQuery(accounts, projectId));
          },
          onLost: (_runId, error) => failed(refusalText(error) ?? errorMessage(error)),
        });
        followers.current.push(follower);
        follower.follow([runId], cursor);
      })();
    },
    [cache, notify, projectId, settle, t]
  );

  return { detach, detaching };
}
