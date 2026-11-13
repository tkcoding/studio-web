import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Detach asks the backend once and follows the run it answers with (#1042). */

const { detachFetch, invalidate, notify, follow, captured } = vi.hoisted(() => ({
  detachFetch: vi.fn(),
  invalidate: vi.fn(() => Promise.resolve()),
  notify: vi.fn(),
  follow: vi.fn(),
  captured: { options: null as null | { onRun: (u: unknown) => void; onLost: (id: string, e: unknown) => void } },
}));

vi.mock('@gears-frontx/react', () => ({
  apiRegistry: {
    getService: (service: { name?: string }) =>
      service?.name === 'ArtifactIngestApiService'
        ? { detachSource: (projectId: string) => ({ fetch: (body: unknown) => detachFetch(projectId, body) }) }
        : { getTenantMetadata: (params: unknown) => ({ key: 'config', params }) },
  },
  useQueryCache: () => ({ invalidate }),
  useApiQuery: vi.fn(),
}));
vi.mock('@constructor-studio/mfe-shared', () => ({
  AccountsApiService: class AccountsApiService {},
  StudioEventsApiService: class StudioEventsApiService {},
  StudioTasksApiService: class StudioTasksApiService {},
  PROJECT_CONFIG_TYPE: 'project-config',
  createRunFollower: (options: never) => {
    captured.options = options;
    return { follow, stop: vi.fn() };
  },
  readCursor: () => Promise.resolve(7),
  isRunSettled: (state: string) => ['succeeded', 'failed', 'cancelled'].includes(state),
  refusalText: () => null,
  errorMessage: (e: unknown) => String(e),
  useNotify: () => notify,
}));
vi.mock('../api/ArtifactIngestApiService', () => ({
  ArtifactIngestApiService: class ArtifactIngestApiService {},
}));
vi.mock('../i18n', () => {
  const t = (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key;
  return { useSourcesText: () => t };
});

import { sourceRow } from '../model/sourceRows.fixture';
import { useSourceDetach } from './useSourceDetach';

const ROW = sourceRow();

beforeEach(() => {
  vi.clearAllMocks();
  captured.options = null;
});

describe('useSourceDetach', () => {
  it('asks once, follows the run, and reads the config again when it succeeds', async () => {
    detachFetch.mockResolvedValue({ run_id: 'r-1', status: 'queued' });
    const hook = renderHook(() => useSourceDetach('p-1'));
    act(() => hook.result.current.detach(ROW));
    expect(hook.result.current.detaching.has(ROW.id)).toBe(true);
    await waitFor(() => expect(follow).toHaveBeenCalledWith(['r-1'], 7));
    expect(detachFetch).toHaveBeenCalledWith('p-1', { clone_url: ROW.cloneUrl });

    act(() => captured.options?.onRun({ runId: 'r-1', state: 'running' }));
    expect(hook.result.current.detaching.has(ROW.id)).toBe(true);
    act(() => captured.options?.onRun({ runId: 'r-1', state: 'succeeded' }));
    expect(hook.result.current.detaching.has(ROW.id)).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('says why when the run fails, and lets it be asked again', async () => {
    detachFetch.mockResolvedValue({ run_id: 'r-2', status: 'queued' });
    const hook = renderHook(() => useSourceDetach('p-1'));
    act(() => hook.result.current.detach(ROW));
    await waitFor(() => expect(follow).toHaveBeenCalled());
    act(() => captured.options?.onRun({ runId: 'r-2', state: 'failed', error: 'the graph is down' }));
    expect(hook.result.current.detaching.has(ROW.id)).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', text: expect.stringContaining('the graph is down') })
    );
  });

  it('a refused request follows nothing', async () => {
    detachFetch.mockRejectedValue(new Error('404'));
    const hook = renderHook(() => useSourceDetach('p-1'));
    act(() => hook.result.current.detach(ROW));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(follow).not.toHaveBeenCalled();
    expect(hook.result.current.detaching.has(ROW.id)).toBe(false);
  });
});
