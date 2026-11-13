/**
 * Scenario: switching the organization or the project leaves nothing of the
 * place before. The installed kits are read per scope; an answer still on
 * hand for the scope left is not this one's, and until this one's arrives
 * nothing is hidden — unknown never hides.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { InstalledKitsSummary } from '@/app/api/InstalledKitsApiService';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';

const { state, queries } = vi.hoisted(() => ({
  state: {
    org: 'o-1' as string | null,
    project: null as string | null,
    answer: null as InstalledKitsSummary | null,
    types: null as { ontology: { entities: { id: string }[] } } | null,
  },
  queries: [] as { key: unknown; enabled: unknown }[],
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      'app/context': {
        org: state.org ? { id: state.org } : null,
        project: state.project ? { id: state.project } : null,
      },
    }),
  apiRegistry: {
    getService: () => ({
      installed: (scope: unknown) => ({ key: ['installed', scope] }),
      types: (scope: unknown) => ({ key: ['types', scope] }),
    }),
  },
  useApiQuery: (descriptor: { key: unknown[] }, options: { enabled?: boolean }) => {
    queries.push({ key: descriptor.key, enabled: options?.enabled });
    return { data: descriptor.key[0] === 'installed' ? state.answer : state.types };
  },
}));

import { screenShows, useInstalledKits, useInstalledTypes } from './useInstalledKits';

const answer = (organization_id: string, project_id: string | null, kits: string[]): InstalledKitsSummary => ({
  organization_id,
  project_id,
  effective: kits.map((kit_slug) => ({ kit_slug, version: '1' })),
});

const lastQuery = () => queries[queries.length - 1];

const kitScreen = (kit: string, needs?: string[]) =>
  ({ id: kit, entry: 'e', presentation: { label: kit, route: `/${kit}`, level: 'project', kit, ...(needs && { needs }) } }) as unknown as StudioScreenExtension;

afterEach(() => {
  state.org = 'o-1';
  state.project = null;
  state.answer = null;
  state.types = null;
  queries.length = 0;
});

describe('useInstalledKits across a switch', () => {
  it('reads the organization’s kits, then the project’s once one is open', () => {
    state.answer = answer('o-1', null, ['org-costs']);
    const { result, rerender } = renderHook(() => useInstalledKits());
    expect([...(result.current ?? [])]).toEqual(['org-costs']);
    expect(lastQuery()?.key).toEqual(['installed', { organizationId: 'o-1' }]);
    state.project = 'p-1';
    rerender();
    expect(lastQuery()?.key).toEqual(['installed', { projectId: 'p-1' }]);
  });

  it('does not take the organization left’s answer for the new one’s', () => {
    state.answer = answer('o-1', null, ['org-costs']);
    const { result, rerender } = renderHook(() => useInstalledKits());
    expect(result.current).not.toBeNull();
    state.org = 'o-2';
    rerender();
    expect(result.current).toBeNull();
    state.answer = answer('o-2', null, []);
    rerender();
    expect([...(result.current ?? [])]).toEqual([]);
  });

  it('does not take the project left’s answer for the next project’s', () => {
    state.project = 'p-1';
    state.answer = answer('o-1', 'p-1', ['project-team']);
    const { result, rerender } = renderHook(() => useInstalledKits());
    expect(result.current?.has('project-team')).toBe(true);
    state.project = 'p-2';
    rerender();
    expect(result.current).toBeNull();
  });

  it('reads nothing with no organization and no project', () => {
    state.org = null;
    renderHook(() => useInstalledKits());
    expect(lastQuery()?.enabled).toBe(false);
  });
});

describe('screenShows while the new scope is unknown', () => {
  it('hides a kit’s screen only once the kits are known, and a needing screen only once the types are', () => {
    expect(screenShows(kitScreen('project-team'), null)).toBe(true);
    expect(screenShows(kitScreen('project-team'), new Set())).toBe(false);
    expect(screenShows(kitScreen('project-activity', ['milestone']), new Set(['project-activity']), null)).toBe(true);
    expect(screenShows(kitScreen('project-activity', ['milestone']), new Set(['project-activity']), new Set())).toBe(false);
  });
});

describe('useInstalledTypes across a switch', () => {
  it('asks for the organization in scope, and only when a screen needs a type', () => {
    renderHook(({ wanted }) => useInstalledTypes(wanted), { initialProps: { wanted: false } });
    expect(lastQuery()).toEqual({ key: ['types', { organizationId: 'o-1' }], enabled: false });
    state.org = 'o-2';
    renderHook(() => useInstalledTypes(true));
    expect(lastQuery()).toEqual({ key: ['types', { organizationId: 'o-2' }], enabled: true });
  });
});
