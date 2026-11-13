import { act, render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConnectionDto } from '@constructor-studio/mfe-shared';

type Query = { data?: unknown; isLoading: boolean; isError: boolean };

const { connections, providers, org, invalidate, triggerLoad } = vi.hoisted(() => ({
  connections: { current: {} as Query },
  providers: { current: {} as Query },
  org: { current: { id: 'org-1', name: 'Fabric' } as { id: string; name: string } | null },
  invalidate: vi.fn(),
  triggerLoad: vi.fn(() => ({ promise: Promise.resolve() })),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => connections.current,
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({
      providers: { key: ['providers'] },
      connections: ({ tenantId }: { tenantId: string }) => ({
        key: ['connections', tenantId],
        fetch: vi.fn(),
      }),
    }),
  },
  useApiQuery: () => providers.current,
  useQueryCache: () => ({ invalidate }),
}));
vi.mock('@gears-frontx/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/ui-kit')>()),
  useDataGrid: () => ({ triggerLoad, getPlugin: () => undefined }),
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.current, loading: false }),
}));

import { useConnectionList } from './useConnectionList';

const answered = (data: unknown): Query => ({ data, isLoading: false, isError: false });

const dto = (id: string, label: string, provider = 'github'): ConnectionDto => ({
  id,
  owner_tenant_id: 'org-1',
  provider,
  label,
  account: 'constructorfabric',
  base_url: 'https://api.github.com',
  scope: 'organization',
  secret_ref: 'ref',
  created_at_epoch_secs: 1_700_000_000,
});

const ITEMS = [dto('c-1', 'Platform GitHub'), dto('c-2', 'Docs GitHub'), dto('c-3', 'Lab', 'gitlab')];

/** The hook, and its bridge rendered as the grid would. */
function mount() {
  const hook = renderHook(() => useConnectionList());
  const grid = render(hook.result.current.rowsBridge);
  return {
    get view() {
      return hook.result.current;
    },
    rerender() {
      hook.rerender();
      grid.rerender(hook.result.current.rowsBridge);
    },
  };
}

describe('useConnectionList', () => {
  beforeEach(() => {
    org.current = { id: 'org-1', name: 'Fabric' };
    providers.current = answered({ items: [{ provider: 'github', display_name: 'GitHub' }] });
    connections.current = answered({ items: ITEMS });
    invalidate.mockReset();
    triggerLoad.mockClear();
  });

  it("names a row's provider by its display name, or by its key when it has none", async () => {
    const list = mount();

    const all = await act(() => list.view.load({}));
    expect(all.results.map((row) => row.providerName)).toEqual(['GitHub', 'GitHub', 'gitlab']);
    expect(list.view.total).toBe(3);
  });

  it('searches and pages the rows in memory, and counts what the search found', async () => {
    const list = mount();
    expect(list.view.found).toBeNull();

    let searched = await act(() => list.view.load({ filters: { textSearch: { value: 'github' } } }));
    expect(searched.results.map((row) => row.id)).toEqual(['c-1', 'c-2']);
    expect(searched.total).toBe(2);
    expect(list.view.found).toBe(2);

    searched = await act(() => list.view.load({ filters: { textSearch: { value: 'lab' } } }));
    expect(searched.results.map((row) => row.providerName)).toEqual(['gitlab']);

    const second = await act(() => list.view.load({ pagination: { page: 2, limit: 2 } }));
    expect(second.results.map((row) => row.id)).toEqual(['c-3']);
    expect(second.total).toBe(3);
    expect(list.view.found).toBe(3);
  });

  it("reads the organization's connections again on retry", () => {
    const { view } = mount();

    view.retry();
    expect(invalidate.mock.calls.map(([query]) => query.key)).toEqual([['connections', 'org-1']]);
  });

  it('loads the grid again when the rows change, but not for its first load', () => {
    const list = mount();
    expect(triggerLoad).not.toHaveBeenCalled();

    list.rerender();
    expect(triggerLoad).not.toHaveBeenCalled();

    connections.current = answered({ items: [...ITEMS, dto('c-4', 'New GitLab', 'gitlab')] });
    list.rerender();
    expect(triggerLoad).toHaveBeenCalledTimes(1);
    expect(list.view.total).toBe(4);
  });

  it('fails when the connections cannot be read, and keeps the rows it has', () => {
    connections.current = { data: { items: ITEMS }, isLoading: false, isError: true };
    const { view } = mount();

    expect(view.failed).toBe(true);
    expect(view.total).toBe(3);
  });
});
