import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RuntimeKitFailure } from '@/app/mfe/runtimeKits';
import type { StudioEvent } from '@constructor-studio/mfe-shared';

const { state, dispatch, kits, fetchManifests, refetch, live } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let failures: RuntimeKitFailure[] = [];
  return {
    state: {
      bootstrap: 'ready' as 'pending' | 'ready',
      installed: null as null | { organization_id: string; project_id: string | null; effective: { kit_slug: string; version: string }[] },
      installedError: false,
      project: 'p-1' as string | null,
    },
    dispatch: vi.fn(),
    fetchManifests: vi.fn(),
    refetch: vi.fn(async () => undefined),
    live: { listener: null as null | ((event: StudioEvent) => void) },
    kits: {
      sync: vi.fn(async () => undefined),
      begin: vi.fn(),
      settle: vi.fn(),
      dismiss: vi.fn((key: string) => {
        failures = failures.filter((f) => f.key !== key);
        for (const l of listeners) l();
      }),
      failures: () => failures,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      setFailures(next: RuntimeKitFailure[]) {
        failures = next;
        for (const l of listeners) l();
      },
    },
  };
});

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ mfeRegistry: {}, store: { dispatch } }),
  useAppSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      'app/mfe-bootstrap': { status: state.bootstrap },
      'app/context': { org: { id: 'o-1' }, project: state.project ? { id: state.project } : null },
    }),
  useApiQuery: () => ({ data: state.installed, isError: state.installedError, refetch }),
  apiRegistry: {
    getService: () => ({
      installed: () => ({}),
      mfeManifests: (scope: unknown) => ({ fetch: () => fetchManifests(scope) }),
    }),
  },
}));
vi.mock('@/app/mfe/runtimeKits', () => ({
  runtimeKitsOf: () => kits,
  runtimeScopeKey: ({ project, org }: { project?: string | null; org?: string | null }) =>
    project ? `project:${project}` : org ? `organization:${org}` : null,
}));
vi.mock('@/app/live/useLiveChannel', () => ({
  useStudioEvents: (listener: (event: StudioEvent) => void) => {
    live.listener = listener;
  },
}));
vi.mock('@/app/i18n/shellTranslations', () => ({
  useShellText: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

import { RuntimeKits, mayChangeInstalledKits } from './RuntimeKits';

const item = { kit_slug: 'hello-kit', version: '0.1.0', package: 'hello', base_path: '/cf/x/', config: {} };
const event = (kind: string, subject_type = 'x') => ({ seq: 1, at_ms: 0, kind, subject_type, subject_id: 's', source: 'g', payload: null });

describe('RuntimeKits', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    kits.setFailures([]);
    state.installed = null;
    state.installedError = false;
    state.bootstrap = 'ready';
    state.project = 'p-1';
  });

  it('loads the micro-frontends of the kits installed where the person is, then settles the scope and wakes the tabs', async () => {
    state.installed = { organization_id: 'o-1', project_id: 'p-1', effective: [{ kit_slug: 'hello-kit', version: '0.1.0' }] };
    fetchManifests.mockResolvedValue({ items: [item] });
    render(<RuntimeKits />);
    await waitFor(() => expect(kits.sync).toHaveBeenCalledWith([item], window.location.origin));
    expect(fetchManifests).toHaveBeenCalledWith({ projectId: 'p-1' });
    expect(kits.begin).toHaveBeenCalledWith('project:p-1');
    await waitFor(() => expect(kits.settle).toHaveBeenCalledWith('project:p-1'));
    // Settled only once the packages are registered: routing must not call a kit's address unknown before.
    expect(kits.sync.mock.invocationCallOrder[0]).toBeLessThan(kits.settle.mock.invocationCallOrder[0]);
    await waitFor(() => expect(dispatch).toHaveBeenCalled());
  });

  it('syncs an empty list too, so the kits uninstalled here are unloaded', async () => {
    state.installed = { organization_id: 'o-1', project_id: 'p-1', effective: [] };
    fetchManifests.mockResolvedValue({ items: [] });
    render(<RuntimeKits />);
    await waitFor(() => expect(kits.sync).toHaveBeenCalledWith([], window.location.origin));
    await waitFor(() => expect(kits.settle).toHaveBeenCalledWith('project:p-1'));
  });

  it('begins the scope at once, before the installed kits are known', () => {
    render(<RuntimeKits />);
    expect(kits.begin).toHaveBeenCalledWith('project:p-1');
    expect(kits.settle).not.toHaveBeenCalled();
    expect(fetchManifests).not.toHaveBeenCalled();
  });

  it('waits for the shell’s own screens, and for an answer about this scope', async () => {
    state.bootstrap = 'pending';
    state.installed = { organization_id: 'o-1', project_id: 'p-1', effective: [] };
    const { rerender } = render(<RuntimeKits />);
    // An answer for another project is not this one's.
    state.bootstrap = 'ready';
    state.installed = { organization_id: 'o-1', project_id: 'p-2', effective: [] };
    rerender(<RuntimeKits />);
    await act(async () => undefined);
    expect(fetchManifests).not.toHaveBeenCalled();
    expect(kits.settle).not.toHaveBeenCalled();
  });

  it('settles the scope when the installed kits cannot be read: nothing to wait for', () => {
    state.installedError = true;
    render(<RuntimeKits />);
    expect(kits.settle).toHaveBeenCalledWith('project:p-1');
  });

  it('unloads the kits of the scope left when the new scope’s kits cannot be read', async () => {
    // Project p-1's kits were loaded; the person moves to p-2, whose read fails.
    state.installed = { organization_id: 'o-1', project_id: 'p-1', effective: [{ kit_slug: 'hello-kit', version: '0.1.0' }] };
    fetchManifests.mockResolvedValue({ items: [item] });
    const { rerender } = render(<RuntimeKits />);
    await waitFor(() => expect(kits.sync).toHaveBeenCalledWith([item], window.location.origin));
    kits.sync.mockClear();
    state.project = 'p-2';
    state.installedError = true;
    rerender(<RuntimeKits />);
    await waitFor(() => expect(kits.sync).toHaveBeenCalledWith([], window.location.origin));
    expect(kits.settle).toHaveBeenCalledWith('project:p-2');
  });

  it('keeps what is loaded when a read again of the same scope fails', async () => {
    state.installed = { organization_id: 'o-1', project_id: 'p-1', effective: [{ kit_slug: 'hello-kit', version: '0.1.0' }] };
    fetchManifests.mockResolvedValue({ items: [item] });
    const { rerender } = render(<RuntimeKits />);
    await waitFor(() => expect(kits.sync).toHaveBeenCalledWith([item], window.location.origin));
    kits.sync.mockClear();
    // A refetch that failed keeps its last answer: still this scope's.
    state.installedError = true;
    rerender(<RuntimeKits />);
    await act(async () => undefined);
    expect(kits.sync).not.toHaveBeenCalledWith([], expect.anything());
  });

  it('keeps the shell going when the list cannot be read, and settles the scope', async () => {
    state.installed = { organization_id: 'o-1', project_id: 'p-1', effective: [{ kit_slug: 'hello-kit', version: '0.1.0' }] };
    fetchManifests.mockRejectedValue(new Error('404'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<RuntimeKits />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(kits.sync).not.toHaveBeenCalled();
    expect(kits.settle).toHaveBeenCalledWith('project:p-1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads the installed kits again when the live channel says kits or the model changed', () => {
    render(<RuntimeKits />);
    act(() => live.listener?.(event('task.succeeded', 'task_run')));
    expect(refetch).not.toHaveBeenCalled();
    act(() => live.listener?.(event('kit.installed', 'kit')));
    act(() => live.listener?.(event('domain.model_changed')));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('draws a tile per package that did not come up, which the person can dismiss', () => {
    kits.setFailures([
      { key: 'hello-kit/hello', kit: 'hello-kit', version: '0.1.0', package: 'hello', reason: 'not built' },
      { key: 'other/x', kit: 'other', version: '1', package: 'x', label: 'Other', reason: 'HTTP 404' },
    ]);
    render(<RuntimeKits />);
    const tiles = screen.getAllByRole('alert');
    expect(tiles.map((t) => t.textContent)).toEqual([
      'runtime_kit_failed:hello-kit,0.1.0not built',
      'runtime_kit_screen_failed:Other,otherHTTP 404',
    ]);
    fireEvent.click(screen.getAllByLabelText('runtime_kit_dismiss')[0]);
    expect(kits.dismiss).toHaveBeenCalledWith('hello-kit/hello');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('mayChangeInstalledKits', () => {
  it('hears kit events and model changes, nothing else', () => {
    expect(mayChangeInstalledKits({ kind: 'kit.uninstalled', subject_type: 'kit' })).toBe(true);
    expect(mayChangeInstalledKits({ kind: 'anything', subject_type: 'kit' })).toBe(true);
    expect(mayChangeInstalledKits({ kind: 'domain.model_changed', subject_type: 'model' })).toBe(true);
    expect(mayChangeInstalledKits({ kind: 'task.running', subject_type: 'task_run' })).toBe(false);
  });
});
