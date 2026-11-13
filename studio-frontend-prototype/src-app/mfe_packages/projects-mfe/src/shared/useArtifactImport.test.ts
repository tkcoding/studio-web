import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSource } from '@constructor-studio/mfe-shared';
import type { ProjectImport } from '../slices/artifactSyncSlice';

/** A first import waits for the gear's syncs in flight (algo `...-first-import`, `inst-10`). */

const { entry } = vi.hoisted(() => ({ entry: { current: null as ProjectImport | null } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: (select: (state: unknown) => unknown) =>
    select({ 'projects/artifact-sync': { byProject: entry.current ? { 'p-1': entry.current } : {} } }),
  eventBus: { emit: vi.fn() },
}));
vi.mock('./useConnections', () => ({
  useSourceConnections: () => ({ connections: [], byId: new Map(), loading: false, failed: false }),
}));

import { useArtifactImport } from './useArtifactImport';

const SOURCE: ProjectSource = {
  connection_id: 'c-1',
  full_path: 'acme/api',
  clone_url: 'https://github.com/acme/api.git',
};

const imported = (overrides: Partial<ProjectImport>): ProjectImport => ({
  phase: 'idle',
  attempted: false,
  lookedUp: false,
  repos: [],
  ...overrides,
});

function isFirstImport(): boolean {
  const { result } = renderHook(() =>
    useArtifactImport({
      projectId: 'p-1',
      workspaceId: 'ws-1',
      orgId: 'org-1',
      sources: [SOURCE],
      artifactCount: 0,
      artifactsRead: true,
    })
  );
  return result.current.isFirstImport;
}

beforeEach(() => {
  window.sessionStorage.clear();
  entry.current = null;
});

describe('a first import', () => {
  it('is not decided while the gear has not said which syncs are in flight', () => {
    expect(isFirstImport()).toBe(false);

    entry.current = imported({ lookedUp: false });
    expect(isFirstImport()).toBe(false);

    entry.current = imported({ lookedUp: true });
    expect(isFirstImport()).toBe(true);
  });

  it("is not started again once the lookup found another tab's runs", () => {
    entry.current = imported({ lookedUp: true, attempted: true, phase: 'running' });

    expect(isFirstImport()).toBe(false);
  });
});
