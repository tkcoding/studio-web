import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BusHandler = (payload?: unknown) => void | Promise<void>;

const { listeners, mockGetService } = vi.hoisted(() => ({
  listeners: new Map<string, BusHandler[]>(),
  mockGetService: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: {
    on: vi.fn((eventName: string, handler: BusHandler) => {
      listeners.set(eventName, [...(listeners.get(eventName) ?? []), handler]);
      return { unsubscribe: () => listeners.delete(eventName) };
    }),
    emit: vi.fn(),
  },
  apiRegistry: { getService: mockGetService },
}));

import { eventBus, type AppDispatch, type FrontXApp } from '@gears-frontx/react';
import {
  StudioEventsApiService,
  StudioTasksApiService,
  type StudioEvent,
  type StudioRun,
} from '@constructor-studio/mfe-shared';
import { initArtifactEffects } from './artifactEffects';
import { ArtifactIngestApiService } from '../api/ArtifactIngestApiService';
import {
  ARTIFACT_SYNC_SLICE_KEY,
  artifactSyncSlice,
  importAbandoned,
  importResumed,
  projectImport,
  repoCancelling,
  repoEnqueued,
  repoProgressed,
  repoRetried,
  type ArtifactSyncState,
} from '../slices/artifactSyncSlice';
import { NAV_SLICE_KEY } from '../slices/navSlice';

const PROJECT = 'p-1';
const REPOS = ['acme/api', 'acme/web', 'acme/docs'];
const MINUTE = 60_000;

function taskEvent(seq: number, runId: string, kind: string, payload: Record<string, unknown> = {}): StudioEvent {
  const state = kind === 'task.progress' ? 'running' : kind.slice('task.'.length);
  return {
    seq,
    at_ms: seq,
    kind,
    subject_type: 'task_run',
    subject_id: runId,
    source: 'studio-tasks',
    payload: { run_id: runId, state, ...payload },
  };
}

function run(id: string, state: StudioRun['state'], overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id,
    tenant_id: 't',
    task_type: 'artifact.ingest',
    state,
    payload: {},
    partition_key: null,
    attempts: 1,
    progress: null,
    summary: null,
    result: null,
    last_error: null,
    cancel_requested: false,
    requested_by: 'u',
    created_at: '',
    updated_at: '',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

/** A refusal that says nothing readable, so the line falls back to the portal's own words. */
function refusal(status: number, violationType?: string): Error {
  return Object.assign(new Error(), {
    response: {
      status,
      data: violationType ? { context: { violations: [{ type: violationType }] } } : {},
    },
  });
}

/** A sync the gear still has for a repository of a project. */
const inFlightRun = (id: string, state: StudioRun['state'], repo: string, projectId = PROJECT) =>
  run(id, state, { payload: { project_id: projectId, repo_full_path: repo } });

function harness(repos = REPOS, inFlight: StudioRun[] = []) {
  let state: ArtifactSyncState = artifactSyncSlice.reducer(undefined, { type: '@@init' });
  let openProject: string | null = PROJECT;
  const subscribers = new Set<() => void>();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    state = artifactSyncSlice.reducer(state, action as never);
    subscribers.forEach((listener) => listener());
    return action;
  });
  const app = {
    store: {
      getState: () => ({ [NAV_SLICE_KEY]: { projectId: openProject }, [ARTIFACT_SYNC_SLICE_KEY]: state }),
      subscribe: (listener: () => void) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    },
  } as unknown as FrontXApp;

  const stream: { onEvent: ((event: StudioEvent) => void) | null; onComplete: (() => void) | null } = {
    onEvent: null,
    onComplete: null,
  };
  const disconnect = vi.fn();
  const events = {
    cursor: { fetch: vi.fn().mockResolvedValue({ events: [], latest_seq: 7 }) },
    streamFrom: vi.fn((_cursor: number) => ({
      connect: (onEvent: (event: StudioEvent) => void, onComplete?: () => void) => {
        stream.onEvent = onEvent;
        stream.onComplete = onComplete ?? null;
        return Promise.resolve('connection-1');
      },
      disconnect,
    })),
  };
  let enqueued = 0;
  const syncFetch = vi.fn(() => Promise.resolve({ run_id: `r-${(enqueued += 1)}`, status: 'queued' }));
  const runRead = vi.fn(({ runId }: { runId: string }) => ({
    fetch: vi.fn().mockResolvedValue(inFlight.find((listed) => listed.id === runId) ?? run(runId, 'queued')),
  }));
  const runsList = vi.fn(({ state: listed }: { state: StudioRun['state'] }) => ({
    fetch: vi.fn().mockResolvedValue({
      items: inFlight.filter((entry) => entry.state === listed),
      total: inFlight.length,
    }),
  }));
  const cancelFetch = vi.fn().mockResolvedValue(run('r-1', 'running', { cancel_requested: true }));
  const retryFetch = vi.fn().mockResolvedValue(run('r-1', 'queued'));
  const tasks = {
    run: runRead,
    runs: runsList,
    cancel: vi.fn(() => ({ fetch: cancelFetch })),
    retry: vi.fn(() => ({ fetch: retryFetch })),
  };
  mockGetService.mockImplementation((service: unknown) => {
    if (service === ArtifactIngestApiService) return { sync: { fetch: syncFetch } };
    if (service === StudioTasksApiService) return tasks;
    if (service === StudioEventsApiService) return events;
    throw new Error('unexpected service');
  });
  initArtifactEffects(dispatch as unknown as AppDispatch, app);

  const emit = (name: string, payload: unknown): void => {
    for (const handler of listeners.get(name) ?? []) void handler(payload);
  };

  return {
    dispatch,
    events,
    stream,
    disconnect,
    syncFetch,
    tasks,
    cancelFetch,
    retryFetch,
    rows: () => projectImport(state, PROJECT).repos,
    phase: () => projectImport(state, PROJECT).phase,
    lookedUp: () => projectImport(state, PROJECT).lookedUp,
    leaveProject: () => {
      openProject = 'p-2';
      dispatch({ type: 'test/nav-changed' });
    },
    returnToProject: () => {
      openProject = PROJECT;
      dispatch({ type: 'test/nav-changed' });
    },
    requestSync: () =>
      emit('mfe/artifacts/sync-requested', {
        projectId: PROJECT,
        workspaceId: 'ws-1',
        repos: repos.map((repo) => ({ repo, provider: 'github', secretRef: 's' })),
        unsyncable: [],
      }),
    addRepos: (added: string[], unsyncable: string[] = []) =>
      emit('mfe/artifacts/repos-added', {
        projectId: PROJECT,
        workspaceId: 'ws-1',
        repos: added.map((repo) => ({ repo, provider: 'github', secretRef: 's' })),
        unsyncable: unsyncable.map((repo) => ({ repo, reason: { kind: 'i18n', key: 'k' } })),
      }),
    cancel: (repo: string) => emit('mfe/artifacts/cancel-requested', { projectId: PROJECT, repo }),
    retry: (repo: string) => emit('mfe/artifacts/retry-requested', { projectId: PROJECT, repo }),
  };
}

const actions = (h: ReturnType<typeof harness>, type: string) =>
  h.dispatch.mock.calls
    .map(([action]) => action as { type: string; payload: Record<string, unknown> })
    .filter((action) => action.type === type);

describe('a repository sync, followed on the event stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reads the cursor before the first sync and follows every run from it on one stream', async () => {
    const h = harness();
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.events.cursor.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      h.syncFetch.mock.invocationCallOrder[0] ?? 0
    );
    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.events.streamFrom).toHaveBeenCalledWith(7);
    expect(actions(h, repoEnqueued.type).map((action) => action.payload.runId)).toEqual(['r-1', 'r-2', 'r-3']);
  });

  it('shows a run waiting for the ingest slot as queued, and running once its sync starts', async () => {
    const h = harness();
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent(8, 'r-2', 'task.progress', { phase: "waiting for another repository's sync to finish…" }));
    expect(h.rows()[1]).toMatchObject({ status: 'queued' });

    h.stream.onEvent?.(taskEvent(9, 'r-2', 'task.progress', { phase: 'pulling issues…', result: { stored: 4 } }));
    expect(h.rows()[1]).toMatchObject({ status: 'running', phase: 'pulling issues…', stored: 4 });
  });

  it('keeps following a repository that starts after the first has run for more than twenty minutes', async () => {
    const h = harness();
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.running'));
    await vi.advanceTimersByTimeAsync(25 * MINUTE);
    h.stream.onEvent?.(taskEvent(9, 'r-1', 'task.succeeded', { summary: 'acme/api: done', result: { stored: 40 } }));
    h.stream.onEvent?.(taskEvent(10, 'r-2', 'task.progress', { phase: 'pulling issues…' }));

    expect(h.rows().map((row) => row.status)).toEqual(['succeeded', 'running', 'queued']);
    expect(h.rows()[0]).toMatchObject({ summary: 'acme/api: done', stored: 40 });
    expect(h.phase()).toBe('running');
    // The stream answered throughout: nothing was read on an interval.
    expect(h.tasks.run).toHaveBeenCalledTimes(2);
  });

  it('closes the stream once every run has settled', async () => {
    const h = harness(['acme/api']);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.failed', { error: 'rate limited' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.rows()[0]).toMatchObject({ status: 'failed', reason: { kind: 'provider', text: 'rate limited' } });
    expect(h.phase()).toBe('failed');
    expect(h.disconnect).toHaveBeenCalledWith('connection-1');
  });

  it('reads the runs on an interval once the stream ends', async () => {
    const h = harness(['acme/api']);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    h.tasks.run.mockReturnValue({ fetch: vi.fn().mockResolvedValue(run('r-1', 'succeeded', { summary: 'ok' })) });

    h.stream.onComplete?.();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(h.tasks.run).toHaveBeenCalledWith({ runId: 'r-1' });
    expect(h.rows()[0]).toMatchObject({ status: 'succeeded', summary: 'ok' });
  });

  it('calls a run the gear no longer has lost', async () => {
    const h = harness(['acme/api']);
    h.events.cursor.fetch.mockRejectedValue(refusal(500));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.tasks.run.mockReturnValue({ fetch: vi.fn().mockRejectedValue(refusal(404)) });
    h.requestSync();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(h.events.streamFrom).not.toHaveBeenCalled();
    const progressed = actions(h, repoProgressed.type);
    expect(progressed[progressed.length - 1]?.payload).toMatchObject({ repo: 'acme/api', status: 'lost' });
  });

  it('calls a repository whose sync request was refused failed, and follows no run for it', async () => {
    const h = harness(['acme/api']);
    h.syncFetch.mockRejectedValueOnce(refusal(500));
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.rows()[0]).toMatchObject({
      status: 'failed',
      runId: null,
      reason: { kind: 'i18n', key: 'artifacts_reason_request_failed' },
    });
    expect(h.phase()).toBe('failed');
    expect(h.events.streamFrom).not.toHaveBeenCalled();
  });

  it("ends the first import's stream when a sync is asked for again, and its late events change nothing", async () => {
    const h = harness(['acme/api']);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    const first = { ...h.stream };

    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    first.onEvent?.(taskEvent(8, 'r-1', 'task.succeeded', { summary: 'acme/api: done' }));

    expect(h.disconnect).toHaveBeenCalledWith('connection-1');
    expect(h.rows()[0]).toMatchObject({ runId: 'r-2', status: 'queued', summary: null });
  });

  it('stops watching when the project in scope changes; the runs go on', async () => {
    const h = harness();
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    h.leaveProject();
    await vi.advanceTimersByTimeAsync(0);

    expect(actions(h, importAbandoned.type)).toHaveLength(1);
    expect(h.disconnect).toHaveBeenCalled();
  });

  it('keeps a settled import as it is when the project in scope changes', async () => {
    const h = harness(['acme/api']);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.failed', { error: 'rate limited' }));

    h.leaveProject();
    await vi.advanceTimersByTimeAsync(0);

    expect(actions(h, importAbandoned.type)).toHaveLength(0);
    expect(h.rows()[0]).toMatchObject({ status: 'failed' });
  });

  describe('cancel', () => {
    it('asks the gear to stop the run and says cancelling until the run is recorded cancelled', async () => {
      const h = harness(['acme/api']);
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.progress', { phase: 'pulling issues…' }));

      h.cancel('acme/api');
      await vi.advanceTimersByTimeAsync(0);
      expect(h.tasks.cancel).toHaveBeenCalledWith('r-1');
      expect(actions(h, repoCancelling.type)).toHaveLength(1);
      expect(h.rows()[0]).toMatchObject({ status: 'running', cancelling: true });

      h.stream.onEvent?.(taskEvent(9, 'r-1', 'task.cancelled'));
      expect(h.rows()[0]).toMatchObject({ status: 'cancelled', cancelling: false });
    });

    it('takes a refusal for a run that already ended as no error', async () => {
      const h = harness(['acme/api']);
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.cancelFetch.mockRejectedValue(refusal(400, 'TASK_CANCEL_REFUSED'));

      h.cancel('acme/api');
      await vi.advanceTimersByTimeAsync(0);

      expect(h.rows()[0]).toMatchObject({ cancelling: true, refusal: null });
      expect(eventBus.emit).not.toHaveBeenCalledWith('mfe/artifacts/cancel-refused', expect.anything());
    });

    it('keeps the run going and says why when the gear refuses', async () => {
      const h = harness(['acme/api']);
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.cancelFetch.mockRejectedValue(refusal(400));

      h.cancel('acme/api');
      await vi.advanceTimersByTimeAsync(0);

      const said = { kind: 'i18n', key: 'artifacts_reason_cancel_refused' };
      expect(h.rows()[0]).toMatchObject({ cancelling: false, refusal: said });
      expect(eventBus.emit).toHaveBeenCalledWith('mfe/artifacts/cancel-refused', {
        projectId: PROJECT,
        repo: 'acme/api',
        refusal: said,
      });
    });

    it('sends nothing for a row it cannot cancel', async () => {
      const h = harness(['acme/api', 'acme/web']);
      h.syncFetch.mockRejectedValueOnce(refusal(500));
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.succeeded'));
      await vi.advanceTimersByTimeAsync(0);

      h.cancel('acme/api');
      h.cancel('acme/web');
      h.cancel('acme/other');
      await vi.advanceTimersByTimeAsync(0);

      expect(h.tasks.cancel).not.toHaveBeenCalled();
      expect(actions(h, repoCancelling.type)).toHaveLength(0);
    });
  });

  describe('retry', () => {
    it('puts a failed run back on the queue and follows the same run again', async () => {
      const h = harness(['acme/api']);
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.failed', { error: 'rate limited' }));
      await vi.advanceTimersByTimeAsync(0);
      h.events.cursor.fetch.mockResolvedValue({ events: [], latest_seq: 12 });

      h.retry('acme/api');
      await vi.advanceTimersByTimeAsync(0);

      expect(h.tasks.retry).toHaveBeenCalledWith('r-1');
      expect(actions(h, repoRetried.type)).toHaveLength(1);
      expect(h.rows()[0]).toMatchObject({ status: 'queued', reason: null });
      expect(h.events.streamFrom).toHaveBeenLastCalledWith(12);

      h.stream.onEvent?.(taskEvent(13, 'r-1', 'task.succeeded', { summary: 'acme/api: done' }));
      expect(h.rows()[0]).toMatchObject({ status: 'succeeded' });
      expect(h.phase()).toBe('settled');
    });

    it('keeps the row as it was and says why when the gear refuses', async () => {
      const h = harness(['acme/api']);
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.cancelled'));
      await vi.advanceTimersByTimeAsync(0);
      h.retryFetch.mockRejectedValue(refusal(400));

      h.retry('acme/api');
      await vi.advanceTimersByTimeAsync(0);

      const said = { kind: 'i18n', key: 'artifacts_reason_retry_refused' };
      expect(h.rows()[0]).toMatchObject({ status: 'cancelled', refusal: said });
      expect(eventBus.emit).toHaveBeenCalledWith('mfe/artifacts/retry-refused', {
        projectId: PROJECT,
        repo: 'acme/api',
        refusal: said,
      });
    });

    it('sends nothing for a row it cannot retry', async () => {
      const h = harness(['acme/api', 'acme/web', 'acme/docs']);
      h.syncFetch.mockRejectedValueOnce(refusal(500));
      h.requestSync();
      await vi.advanceTimersByTimeAsync(0);
      h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.running'));
      h.dispatch(repoProgressed({ projectId: PROJECT, repo: 'acme/docs', status: 'lost', reason: null }));

      h.retry('acme/api');
      h.retry('acme/web');
      h.retry('acme/docs');
      h.retry('acme/other');
      await vi.advanceTimersByTimeAsync(0);

      expect(h.tasks.retry).not.toHaveBeenCalled();
      expect(actions(h, repoRetried.type)).toHaveLength(0);
    });
  });
});

describe('repositories added to a running import', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('syncs only the added repository and keeps following the others', async () => {
    const h = harness(['acme/api', 'acme/web']);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    h.addRepos(['acme/new']);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.syncFetch).toHaveBeenCalledTimes(3);
    expect(h.syncFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ repo_full_path: 'acme/new', project_id: PROJECT })
    );
    expect(h.disconnect).not.toHaveBeenCalled();
    expect(h.rows().map((row) => [row.repo, row.runId])).toEqual([
      ['acme/api', 'r-1'],
      ['acme/web', 'r-2'],
      ['acme/new', 'r-3'],
    ]);

    h.stream.onEvent?.(taskEvent(8, 'r-1', 'task.running'));
    expect(h.rows()[0]).toMatchObject({ status: 'running' });
  });

  it('does not ask again for a repository whose sync is queued or running', async () => {
    const h = harness(['acme/api']);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    h.addRepos(['acme/api']);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.syncFetch).toHaveBeenCalledTimes(1);
  });

  it('gives an unsyncable repository its line and asks the gear nothing for it', async () => {
    const h = harness([]);
    h.addRepos([], ['acme/lab']);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.syncFetch).not.toHaveBeenCalled();
    expect(h.rows()).toEqual([expect.objectContaining({ repo: 'acme/lab', status: 'unsyncable' })]);
  });
});

describe('an import found again on the gear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("gives the project's syncs in flight their lines, and follows them from a cursor read before the listing", async () => {
    const h = harness(REPOS, [
      inFlightRun('r-9', 'running', 'acme/api'),
      inFlightRun('r-8', 'queued', 'acme/web'),
      inFlightRun('r-10', 'queued', 'acme/api'),
      inFlightRun('r-7', 'running', 'acme/other', 'p-2'),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.rows().map((row) => [row.repo, row.runId, row.status])).toEqual([
      ['acme/api', 'r-9', 'running'],
      ['acme/web', 'r-8', 'queued'],
    ]);
    expect(h.phase()).toBe('running');
    expect(h.events.cursor.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      h.tasks.runs.mock.invocationCallOrder[0] ?? 0
    );
    expect(h.events.streamFrom).toHaveBeenCalledWith(7);
    expect(h.syncFetch).not.toHaveBeenCalled();

    h.stream.onEvent?.(taskEvent(8, 'r-9', 'task.succeeded', { summary: 'acme/api: done', result: { stored: 3 } }));
    expect(h.rows()[0]).toMatchObject({ status: 'succeeded', stored: 3 });
  });

  it('shows the import again when the member comes back to the project', async () => {
    const h = harness(REPOS, [inFlightRun('r-9', 'running', 'acme/api')]);
    await vi.advanceTimersByTimeAsync(0);

    h.leaveProject();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.phase()).toBe('idle');

    h.returnToProject();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.phase()).toBe('running');
    expect(h.rows().map((row) => row.runId)).toEqual(['r-9']);
  });

  it('marks the project looked up only once the runs are listed, and again on each opening', async () => {
    // Nothing in flight, so leaving abandons no import and only the opening clears the mark.
    const h = harness(REPOS);
    expect(h.lookedUp()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lookedUp()).toBe(true);

    h.leaveProject();
    h.returnToProject();
    expect(h.lookedUp()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lookedUp()).toBe(true);
  });

  it('marks the project looked up when the gear has no sync for it', async () => {
    const h = harness(REPOS, [inFlightRun('r-7', 'running', 'acme/other', 'p-2')]);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.lookedUp()).toBe(true);
    expect(h.rows()).toEqual([]);
  });

  it('marks the project looked up when the runs cannot be listed, and follows nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness(REPOS, [inFlightRun('r-9', 'running', 'acme/api')]);
    h.tasks.runs.mockImplementation(() => ({ fetch: vi.fn().mockRejectedValue(new Error('503')) }));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.lookedUp()).toBe(true);
    expect(h.rows()).toEqual([]);
    expect(h.events.streamFrom).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('lists the runs once per opening, however much else is dispatched', async () => {
    const h = harness(REPOS);
    await vi.advanceTimersByTimeAsync(0);

    h.dispatch({ type: 'test/unrelated' });
    h.dispatch({ type: 'test/unrelated' });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.tasks.runs).toHaveBeenCalledTimes(2);
    expect(h.tasks.runs.mock.calls.map(([params]) => params.state).sort()).toEqual(['queued', 'running']);
  });

  it('leaves a sync asked for while the runs were being listed to its own runs', async () => {
    const h = harness(REPOS, [inFlightRun('r-9', 'running', 'acme/api')]);
    h.requestSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(actions(h, importResumed.type)).toHaveLength(0);
    expect(h.rows().map((row) => row.runId)).toEqual(['r-1', 'r-2', 'r-3']);
  });
});
