import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, state } = vi.hoisted(() => {
  const state = {
    catalog: [] as unknown[],
    installations: [] as unknown[],
    repositories: null as unknown[] | null,
  };
  const unavailable = () => Object.assign(new Error('project repositories are unavailable'), { response: { status: 503 } });
  const api = {
    ideCatalog: { fetch: vi.fn(async () => ({ items: state.catalog, total: state.catalog.length })) },
    ideInstallations: vi.fn(() => ({ fetch: async () => ({ items: state.installations, total: 0 }) })),
    ideRepositories: vi.fn(() => ({
      fetch: async () => {
        if (!state.repositories) throw unavailable();
        return { items: state.repositories, total: state.repositories.length };
      },
    })),
    request: vi.fn(async (_body: unknown) => ({})),
    materialize: vi.fn(async (_body: unknown) => ({})),
    reconcile: vi.fn(async () => ({})),
    remove: vi.fn(async () => undefined),
    requestIdeInstallation: vi.fn(() => ({ fetch: (body: unknown) => api.request(body) })),
    materializeIdeInstallation: vi.fn(() => ({ fetch: (body: unknown) => api.materialize(body) })),
    reconcileIdeInstallation: vi.fn(() => ({ fetch: () => api.reconcile() })),
    removeIdeInstallation: vi.fn(() => ({ fetch: () => api.remove() })),
  };
  return { api, state };
});

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => api },
}));

import { IdeKits } from './IdeKits';

const t = Object.assign(
  (key: string, params?: Record<string, string | number | boolean>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
  { count: (key: string, count: number) => `${key}:${count}` }
);

const sdlc = {
  slug: 'sdlc',
  name: 'SDLC',
  description: 'From spec to release',
  publisher: 'Constructor Fabric',
  visibility: 'public',
  source: 'github',
  repository_url: 'https://github.com/x/sdlc',
  default_version: 'v1.2.0',
  manifest_path: '.cf-studio-kit.toml',
};

const installed = (over: Record<string, unknown> = {}) => ({
  kit_slug: 'sdlc',
  version: 'v1.2.0',
  source: 'github',
  repository_url: sdlc.repository_url,
  install_mode: 'copy',
  status: 'installed',
  requested_by: 'u',
  requested_at: '2026-11-01T00:00:00Z',
  scope: 'project',
  materializations: [],
  ...over,
});

describe('IdeKits', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.catalog = [];
    state.installations = [];
    state.repositories = null;
  });

  it('lists the official kits and says the IDE is not running, without an error', async () => {
    state.catalog = [sdlc];
    render(<IdeKits projectId="p-1" t={t} />);
    expect(await screen.findByText('SDLC')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-ide-no-session]')).toBeTruthy());
    expect(document.querySelector('[data-ide-error]')).toBeNull();
    expect(api.ideRepositories).toHaveBeenCalledWith({ projectId: 'p-1' });
  });

  it('shows what the project asked for and where it was written, a failed repository with its reason', async () => {
    state.catalog = [sdlc];
    state.repositories = [{ repository_id: 'proj', label: 'studio', kind: 'project' }];
    state.installations = [
      installed({
        status: 'failed',
        failure_reason: 'cfs exited 1',
        materializations: [
          { repository_id: 'proj', version: 'v1.2.0', status: 'failed', materialized_at: '2026-11-01T00:00:00Z', failure_reason: 'no space' },
        ],
      }),
    ];
    render(<IdeKits projectId="p-1" t={t} />);
    expect(await screen.findByText('cfs exited 1')).toBeTruthy();
    expect(document.querySelector('[data-ide-status="failed"]')).toBeTruthy();
    expect(screen.getByText(/no space/)).toBeTruthy();
    expect(screen.getByText(/studio · ide_whole_project/)).toBeTruthy();
    expect(screen.getByText('ide_failed_any')).toBeTruthy();
    expect(screen.getByText('ide_count:1,1')).toBeTruthy();
  });

  it('installs into the project repository: request, then materialize there', async () => {
    state.catalog = [sdlc];
    state.repositories = [{ repository_id: 'proj', label: 'studio', kind: 'project' }];
    render(<IdeKits projectId="p-1" t={t} />);
    fireEvent.click(await screen.findByText('ide_install'));
    await waitFor(() => expect(api.materialize).toHaveBeenCalledWith({ repository_id: 'proj' }));
    expect(api.request).toHaveBeenCalledWith({ kit_slug: 'sdlc', version: 'v1.2.0', install_mode: 'copy', scope: 'project' });
    expect(api.reconcile).not.toHaveBeenCalled();
  });

  it('a kit for every repository is reconciled, not materialized, and again for a repository added since', async () => {
    state.catalog = [sdlc];
    state.repositories = [
      { repository_id: 'proj', label: 'studio', kind: 'project' },
      { repository_id: 'src', label: 'lib', kind: 'source' },
    ];
    state.installations = [installed({ scope: 'all-repositories' })];
    render(<IdeKits projectId="p-1" t={t} />);
    // On arrival: one rollout for the installation meant for every repository.
    await waitFor(() => expect(api.reconcile).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('ide_reinstall'));
    await waitFor(() => expect(api.request).toHaveBeenCalled());
    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ scope: 'all-repositories' }));
    await waitFor(() => expect(api.reconcile).toHaveBeenCalledTimes(2));
    expect(api.materialize).not.toHaveBeenCalled();
  });

  it('without a session, an install is recorded and the failure to write it is said plainly', async () => {
    state.catalog = [sdlc];
    api.materialize.mockRejectedValueOnce(new Error('Theia control bridge is not enabled'));
    render(<IdeKits projectId="p-1" t={t} />);
    await waitFor(() => expect(document.querySelector('[data-ide-no-session]')).toBeTruthy());
    fireEvent.click(screen.getByText('ide_install'));
    // No repository is named: the IDE would pick the project's own.
    await waitFor(() => expect(api.materialize).toHaveBeenCalledWith({}));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'ide_install_no_session:Theia control bridge is not enabled'
    );
  });

  it('removes only after it is confirmed', async () => {
    state.catalog = [sdlc];
    state.installations = [installed()];
    render(<IdeKits projectId="p-1" t={t} />);
    fireEvent.click(await screen.findByText('ide_remove'));
    expect(api.remove).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ide-confirm]')).toBeTruthy();
    fireEvent.click(screen.getAllByText('ide_remove')[0]);
    await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(1));
  });
});
