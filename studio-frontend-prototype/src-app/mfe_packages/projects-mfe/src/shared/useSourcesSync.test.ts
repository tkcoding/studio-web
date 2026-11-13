import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionDto, ProjectSource } from '@constructor-studio/mfe-shared';
import { ARTIFACT_NODE_TYPES } from '../api/artifactTypes';

/** The project screen syncs the sources the dialog attached (DoD `...-sources-sync-missing`). */

const { nodes, connections, lines, lookedUp, emit } = vi.hoisted(() => ({
  nodes: { current: { data: undefined as unknown, isError: false } },
  connections: {
    current: {
      connections: [] as ConnectionDto[],
      byId: new Map<string, ConnectionDto>(),
      loading: false,
      failed: false,
    },
  },
  lines: { current: [] as { repo: string; status: string }[] },
  lookedUp: { current: true },
  emit: vi.fn(),
}));

vi.mock('@gears-frontx/react', () => ({
  apiRegistry: { getService: () => ({ nodes: (params: unknown) => ({ params }) }) },
  useApiQuery: () => nodes.current,
  eventBus: { emit },
}));
vi.mock('../api/ArtifactIngestApiService', () => ({ ArtifactIngestApiService: class {} }));
vi.mock('./useArtifacts', () => ({
  repositoryNodesParams: (scope: string) => ({ scope, type: 'repo', limit: 200 }),
}));
vi.mock('./useConnections', () => ({ useSourceConnections: () => connections.current }));
vi.mock('./useArtifactImport', () => ({
  useProjectImport: () => ({ repos: lines.current, lookedUp: lookedUp.current }),
}));

import { useSourcesSync } from './useSourcesSync';
import { recordRequests } from './importAttempts';

const PROJECT = 'p-1';

const source = (full_path: string, connection_id = 'c-github'): ProjectSource => ({
  connection_id,
  full_path,
  clone_url: `https://example.test/${full_path}.git`,
});

const connection = (id: string, provider: string): ConnectionDto =>
  ({ id, provider, label: id, base_url: '', secret_ref: `ref-${id}` }) as ConnectionDto;

const repoNodes = (...paths: string[]) => ({
  data: {
    nodes: paths.map((full_path, index) => ({
      type_id: ARTIFACT_NODE_TYPES.repo,
      instance_id: `n-${index}`,
      value: { full_path },
    })),
    total: paths.length,
  },
  isError: false,
});

const SOURCES = [source('acme/api'), source('acme/web'), source('lab/tool', 'c-gitlab')];

function render(overrides: { sources?: ProjectSource[]; isFirstImport?: boolean } = {}) {
  return renderHook(() =>
    useSourcesSync({
      projectId: PROJECT,
      workspaceId: 'ws-1',
      orgId: 'org-1',
      sources: overrides.sources ?? SOURCES,
      sourcesRead: true,
      isFirstImport: overrides.isFirstImport ?? false,
    })
  );
}

beforeEach(() => {
  emit.mockClear();
  window.sessionStorage.clear();
  nodes.current = repoNodes('acme/api');
  const list = [connection('c-github', 'github'), connection('c-gitlab', 'gitlab')];
  connections.current = {
    connections: list,
    byId: new Map(list.map((entry) => [entry.id, entry])),
    loading: false,
    failed: false,
  };
  lines.current = [];
  lookedUp.current = true;
});

describe('the sources nothing has pulled in', () => {
  it('get a sync added to the import: GitHub ones pulled, the rest unsyncable', () => {
    render();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('mfe/artifacts/repos-added', {
      projectId: PROJECT,
      workspaceId: 'ws-1',
      repos: [{ repo: 'acme/web', provider: 'github', baseUrl: undefined, secretRef: 'ref-c-github' }],
      unsyncable: [
        { repo: 'lab/tool', reason: { kind: 'i18n', key: 'artifacts_reason_provider_cannot_sync' } },
      ],
    });
  });

  it("wait until the gear has said which syncs are in flight, so another tab's queued run is not asked for again", () => {
    lookedUp.current = false;
    const { rerender } = render();
    expect(emit).not.toHaveBeenCalled();

    lines.current = [{ repo: 'acme/web', status: 'queued' }];
    lookedUp.current = true;
    rerender();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'mfe/artifacts/repos-added',
      expect.objectContaining({ repos: [] })
    );
  });

  it('are left to the first import while it starts', () => {
    render({ isFirstImport: true });

    expect(emit).not.toHaveBeenCalled();
  });

  it('wait until the repository nodes and the connections are read', () => {
    nodes.current = { data: undefined, isError: false };
    render();
    expect(emit).not.toHaveBeenCalled();

    nodes.current = repoNodes('acme/api');
    connections.current = { ...connections.current, loading: true };
    render();
    expect(emit).not.toHaveBeenCalled();
  });

  it('are not asked for while the nodes cannot be read', () => {
    nodes.current = { data: repoNodes().data, isError: true };
    render();

    expect(emit).not.toHaveBeenCalled();
  });

  it('leave out what this tab asked for already', () => {
    recordRequests(PROJECT, ['acme/web', 'lab/tool']);
    render();

    expect(emit).not.toHaveBeenCalled();
  });
});
