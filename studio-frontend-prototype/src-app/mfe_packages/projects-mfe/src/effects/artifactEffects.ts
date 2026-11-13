// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-sync-unit:p1
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-sync:p2
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-run-control:p2
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-sync-add:p2
// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-sync-join:p1
// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-sync-resume:p1
// @cpt-algo:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2
import {
  apiRegistry,
  eventBus,
  type AppDispatch,
  type FrontXApp,
  type RootState,
} from '@gears-frontx/react';
import {
  StudioEventsApiService,
  StudioTasksApiService,
  createRunFollower,
  readCursor,
  refusalFrom,
  violationOfType,
  type RunFollower,
  type StudioRun,
} from '@constructor-studio/mfe-shared';
import { ArtifactIngestApiService } from '../api/ArtifactIngestApiService';
import {
  ARTIFACT_SYNC_SLICE_KEY,
  importAbandoned,
  importLookedUp,
  importResumed,
  importStarted,
  lookupStarted,
  projectImport,
  reposAdded,
  repoCancelling,
  repoControlRefused,
  repoEnqueued,
  repoProgressed,
  repoRetried,
  repoUpdated,
} from '../slices/artifactSyncSlice';
import { NAV_SLICE_KEY } from '../slices/navSlice';
import { INGEST_TASK_TYPE, canCancel, canRetry, inFlight, projectRuns } from '../model/repoImport';
import { recordAttempt, recordRequests } from '../shared/importAttempts';
import type { RepoRef, SyncRepo, SyncRequest } from '../events/artifactEvents';
import '../events/artifactEvents';

const CONCURRENCY = 3;

/** The gear's ceiling for one page of runs. */
const RUNS_PAGE = 200;

/** The gear's answer to a cancel of a run that has already ended. */
const CANCEL_REFUSED = 'TASK_CANCEL_REFUSED';

/** One project's import, watched until the project in scope changes. */
interface Watch {
  follower: RunFollower;
  /** The repository each run syncs. */
  repos: Map<string, string>;
  ended: boolean;
  end: () => void;
}

async function bounded<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item);
    }
  });
  await Promise.all(runners);
}

export function initArtifactEffects(dispatch: AppDispatch, app: FrontXApp): void {
  const watches = new Map<string, Watch>();
  const events = () => apiRegistry.getService(StudioEventsApiService);
  const tasks = () => apiRegistry.getService(StudioTasksApiService);

  const openProjectId = (): string | null =>
    (app.store.getState() as RootState)[NAV_SLICE_KEY].projectId;

  const rowOf = (projectId: string, repo: string) =>
    projectImport((app.store.getState() as RootState)[ARTIFACT_SYNC_SLICE_KEY], projectId).repos.find(
      (row) => row.repo === repo
    );

  const watch = (projectId: string): Watch => {
    const current = watches.get(projectId);
    if (current) return current;

    const repos = new Map<string, string>();
    const follower = createRunFollower({
      events: events(),
      tasks: tasks(),
      onRun: (update) => {
        const repo = repos.get(update.runId);
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-10
        if (repo) dispatch(repoUpdated({ projectId, repo, update }));
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-10
      },
      onLost: (runId, error) => {
        const repo = repos.get(runId);
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-12
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-13
        if (repo) {
          dispatch(
            repoProgressed({
              projectId,
              repo,
              status: 'lost',
              reason: refusalFrom(error, 'artifacts_reason_task_lost'),
            })
          );
        }
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-12
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-13
      },
    });

    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-16
    const unsubscribe = app.store.subscribe(() => {
      if (openProjectId() === projectId) return;
      const state = (app.store.getState() as RootState)[ARTIFACT_SYNC_SLICE_KEY];
      const running = projectImport(state, projectId).phase === 'running';
      next.end();
      if (running) dispatch(importAbandoned(projectId));
    });
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-16

    const next: Watch = {
      follower,
      repos,
      ended: false,
      end: () => {
        if (next.ended) return;
        next.ended = true;
        follower.stop();
        unsubscribe();
        if (watches.get(projectId) === next) watches.delete(projectId);
      },
    };
    watches.set(projectId, next);
    return next;
  };

  const requestAndFollow = (
    mine: Watch,
    projectId: string,
    workspaceId: string | null,
    repos: readonly SyncRepo[]
  ): void => {
    const ingest = apiRegistry.getService(ArtifactIngestApiService);
    void (async () => {
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-4
      const cursor = await readCursor(events(), 'artifacts');
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-4

      await bounded(repos, CONCURRENCY, async (entry) => {
        if (mine.ended) return;
        let runId: string;
        try {
          // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-5
          const enqueued = await ingest.sync.fetch({
            provider: entry.provider,
            base_url: entry.baseUrl,
            secret_ref: entry.secretRef,
            repo_full_path: entry.repo,
            project_id: projectId,
            workspace_id: workspaceId ?? undefined,
          });
          // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-5
          runId = enqueued.run_id;
        } catch (error) {
          if (!mine.ended) {
            dispatch(
              repoProgressed({
                projectId,
                repo: entry.repo,
                status: 'failed',
                reason: refusalFrom(error, 'artifacts_reason_request_failed'),
              })
            );
          }
          return;
        }
        if (mine.ended) return;
        mine.repos.set(runId, entry.repo);
        dispatch(repoEnqueued({ projectId, repo: entry.repo, runId }));
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-6
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-7
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-8
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-9
        mine.follower.follow([runId], cursor);
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-6
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-7
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-8
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-9
      });
    })();
  };

  /** A sync the store has lost track of — after leaving the project, a reload, or another tab — is still the gear's. */
  const resume = (projectId: string): void => {
    const lookedUp = (): void => {
      if (openProjectId() === projectId) dispatch(importLookedUp(projectId));
    };
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-1
    if (watches.has(projectId)) {
      lookedUp();
      return;
    }
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-1
    void (async () => {
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-2
      const cursor = await readCursor(events(), 'artifacts');
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-2
      let listed: StudioRun[];
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-3
        const pages = await Promise.all(
          (['running', 'queued'] as const).map((state) =>
            tasks()
              .runs({ taskType: INGEST_TASK_TYPE, state, limit: RUNS_PAGE })
              .fetch({ staleTime: 0 })
          )
        );
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-3
        listed = pages.flatMap((page) => page.items);
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-8
        console.warn('[artifacts] could not list the syncs in flight:', error);
        lookedUp();
        return;
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-8
      }
      // A sync asked for meanwhile follows its own runs; a closed project needs none.
      if (watches.has(projectId) || openProjectId() !== projectId) {
        lookedUp();
        return;
      }

      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-4
      const runs = projectRuns(listed, projectId);
      if (runs.length === 0) {
        lookedUp();
        return;
      }
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-4

      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-5
      recordAttempt(projectId);
      recordRequests(projectId, runs.map((entry) => entry.repo));
      dispatch(importResumed({ projectId, runs }));
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-5

      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-6
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-7
      const mine = watch(projectId);
      for (const { repo, update } of runs) mine.repos.set(update.runId, repo);
      mine.follower.follow(
        runs.map((entry) => entry.update.runId),
        cursor
      );
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-6
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-resume:p2:inst-7
    })();
  };

  let opened: string | null = null;
  const onNavigation = (): void => {
    const projectId = openProjectId();
    if (projectId === opened) return;
    opened = projectId;
    if (!projectId) return;
    dispatch(lookupStarted(projectId));
    resume(projectId);
  };
  app.store.subscribe(onNavigation);
  onNavigation();

  const requested = (request: Pick<SyncRequest, 'repos' | 'unsyncable'>): string[] => [
    ...request.repos.map((entry) => entry.repo),
    ...request.unsyncable.map((entry) => entry.repo),
  ];

  eventBus.on('mfe/artifacts/sync-requested', (request: SyncRequest) => {
    const { projectId, workspaceId, repos, unsyncable } = request;

    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-3
    recordAttempt(projectId);
    recordRequests(projectId, requested(request));
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-3
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-2
    watches.get(projectId)?.end();
    dispatch(importStarted({ projectId, repos: repos.map((r) => r.repo), unsyncable }));
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync:p2:inst-2

    if (repos.length === 0) return;
    requestAndFollow(watch(projectId), projectId, workspaceId, repos);
  });

  eventBus.on('mfe/artifacts/repos-added', (request: SyncRequest) => {
    const { projectId, workspaceId } = request;
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-1
    const idle = (entry: { repo: string }): boolean => {
      const line = rowOf(projectId, entry.repo);
      return !line || !inFlight(line.status);
    };
    const repos = request.repos.filter(idle);
    const unsyncable = request.unsyncable.filter(idle);
    if (repos.length === 0 && unsyncable.length === 0) return;
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-1

    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-3
    recordAttempt(projectId);
    recordRequests(projectId, requested({ repos, unsyncable }));
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-3
    dispatch(reposAdded({ projectId, repos: repos.map((r) => r.repo), unsyncable }));

    if (repos.length === 0) return;
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-4
    const mine = watch(projectId);
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-4
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-5
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-6
    requestAndFollow(mine, projectId, workspaceId, repos);
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-5
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-sync-add:p2:inst-6
  });

  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-1
  eventBus.on('mfe/artifacts/cancel-requested', ({ projectId, repo }: RepoRef) => {
    const row = rowOf(projectId, repo);
    if (!row?.runId || !canCancel(row)) return;
    const runId = row.runId;
    // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-3
    dispatch(repoCancelling({ projectId, repo }));
    // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-3
    void (async () => {
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-2
        await tasks().cancel(runId).fetch(undefined);
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-2
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-4
        // It ended meanwhile; its terminal event says how.
        if (violationOfType(error, CANCEL_REFUSED)) return;
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-4
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-8
        const refusal = refusalFrom(error, 'artifacts_reason_cancel_refused');
        dispatch(repoControlRefused({ projectId, repo, refusal }));
        eventBus.emit('mfe/artifacts/cancel-refused', { projectId, repo, refusal });
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-8
      }
    })();
  });
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-1

  // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-5
  eventBus.on('mfe/artifacts/retry-requested', ({ projectId, repo }: RepoRef) => {
    const row = rowOf(projectId, repo);
    if (!row?.runId || !canRetry(row)) return;
    const runId = row.runId;
    const mine = watch(projectId);
    mine.repos.set(runId, repo);
    void (async () => {
      const cursor = await readCursor(events(), 'artifacts');
      if (mine.ended) return;
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-6
        await tasks().retry(runId).fetch(undefined);
        // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-6
      } catch (error) {
        if (!mine.ended) {
          const refusal = refusalFrom(error, 'artifacts_reason_retry_refused');
          dispatch(repoControlRefused({ projectId, repo, refusal }));
          eventBus.emit('mfe/artifacts/retry-refused', { projectId, repo, refusal });
        }
        return;
      }
      if (mine.ended) return;
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-7
      // @cpt-begin:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-9
      dispatch(repoRetried({ projectId, repo }));
      mine.follower.follow([runId], cursor);
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-7
      // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-9
    })();
  });
  // @cpt-end:cpt-studiofrontend-algo-project-artifacts-run-control:p2:inst-5
}
