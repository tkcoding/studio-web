import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { services, calls, context, events } = vi.hoisted(() => ({
  services: { domain: {} as Record<string, unknown>, accounts: {} as Record<string, unknown> },
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
  context: { value: {} as Record<string, unknown> },
  events: { listener: null as null | ((event: { kind: string }) => void) },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) => selector({ 'app/context': context.value }),
  apiRegistry: {
    getService: (service: { name: string }) =>
      service.name === 'DomainModelApiService' ? services.domain : services.accounts,
  },
}));
vi.mock('@/app/live/useLiveChannel', () => ({
  useStudioEvents: (listener: (event: { kind: string }) => void) => {
    events.listener = listener;
  },
}));

import { WORKSPACE_SETTINGS_TYPE } from '@constructor-studio/mfe-shared';
import { useHiddenTabs, useLevelModelTabs, useLevelTenant } from './useModelTabs';

const reply = (what: string, answer: unknown) => (arg?: unknown) => ({
  fetch: (body?: unknown) => {
    calls.push({ what, arg, body });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  },
});

const ontology = {
  entities: [
    {
      id: 'organization',
      properties: [
        { name: 'org', type: 'Organization', relation: 'organization', extends: 'edge', relationType: 'shows', relationLabel: 'Overview' },
        { name: 'vendors', type: 'Vendor', relation: 'vendor', extends: 'edge', relationType: 'shows', relationLabel: 'Vendors' },
      ],
    },
    { id: 'vendor' },
  ],
};

beforeEach(() => {
  calls.length = 0;
  context.value = { org: { id: 'o1', name: 'Acme' }, workspace: { id: 'w1', name: 'Platform' }, project: null };
  services.domain = { types: reply('types', { ontology, can_edit_model: false }) };
  services.accounts = {
    getTenantMetadata: reply('read', { value: { icon: 'rocket', hidden_tabs: ['vendors'] } }),
    putTenantMetadata: (tenantId: string, type: string) => reply('write', null)({ tenantId, type }),
  };
});
afterEach(() => cleanup());

describe('the model’s tabs of a level', () => {
  it('are the shows relations of the level’s type in the organization’s model', async () => {
    const { result } = renderHook(() => useLevelModelTabs('organization'));
    await waitFor(() => expect(result.current.map((t) => t.name)).toEqual(['org', 'vendors']));
    expect(calls[0]).toEqual({ what: 'types', arg: { orgId: 'o1' }, body: { staleTime: 0 } });
  });

  it('are read again when the model changes, and not for anything else', async () => {
    renderHook(() => useLevelModelTabs('organization'));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => events.listener?.({ kind: 'tasks.run_updated' }));
    act(() => events.listener?.({ kind: 'domain.model_changed' }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('are none above or beside the three levels, and none while the model will not answer', async () => {
    const admin = renderHook(() => useLevelModelTabs('admin'));
    expect(admin.result.current).toEqual([]);
    expect(calls).toEqual([]);
    services.domain = { types: reply('types', new Error('down')) };
    const { result } = renderHook(() => useLevelModelTabs('organization'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current).toEqual([]);
  });
});

describe('the tenant whose document hides a level’s tabs', () => {
  it('is the organization, the workspace or the project in scope', () => {
    context.value = { ...context.value, project: { id: 'p1', name: 'Apollo' } };
    expect(renderHook(() => useLevelTenant('organization')).result.current).toBe('o1');
    expect(renderHook(() => useLevelTenant('workspace')).result.current).toBe('w1');
    expect(renderHook(() => useLevelTenant('project')).result.current).toBe('p1');
    expect(renderHook(() => useLevelTenant('admin')).result.current).toBeNull();
  });
});

describe('hidden tabs', () => {
  it('are read from the level’s settings document', async () => {
    const { result } = renderHook(() => useHiddenTabs('workspace', 'w1'));
    await waitFor(() => expect(result.current.hidden).toEqual(['vendors']));
    expect(calls[0]).toMatchObject({ what: 'read', arg: { tenantId: 'w1', metadataType: WORKSPACE_SETTINGS_TYPE } });
  });

  it('hide nothing when the document will not answer', async () => {
    services.accounts = { ...services.accounts, getTenantMetadata: reply('read', new Error('403')) };
    const { result } = renderHook(() => useHiddenTabs('workspace', 'w1'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current.hidden).toEqual([]);
  });

  it('are saved into the document read again, every other field kept', async () => {
    const { result } = renderHook(() => useHiddenTabs('workspace', 'w1'));
    await waitFor(() => expect(result.current.hidden).toEqual(['vendors']));
    await act(() => result.current.save!(['org']));
    const write = calls.find((c) => c.what === 'write');
    expect(write).toEqual({
      what: 'write',
      arg: { tenantId: 'w1', type: WORKSPACE_SETTINGS_TYPE },
      body: { icon: 'rocket', hidden_tabs: ['org'] },
    });
    expect(result.current.hidden).toEqual(['org']);
  });

  it('cannot be saved where no place is open', () => {
    expect(renderHook(() => useHiddenTabs('project', null)).result.current.save).toBeNull();
    expect(renderHook(() => useHiddenTabs('admin', 'x')).result.current.save).toBeNull();
  });
});
