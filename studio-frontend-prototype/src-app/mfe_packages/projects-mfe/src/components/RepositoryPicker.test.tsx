import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionDto, RemoteRepoDto } from '@constructor-studio/mfe-shared';

/** What the picker shows from its props and its reads (DoD `...-project-sources-picker`). */

const { data } = vi.hoisted(() => ({
  data: {
    connections: [] as ConnectionDto[],
    repositories: [] as RemoteRepoDto[],
    reposFailed: false,
  },
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: { id: 'org-1', name: 'Fabric' }, loading: false, failed: false }),
}));

vi.mock('../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n')>()),
  useProjectCreateText: () => (key: string) => key,
}));

vi.mock('../shared/useConnections', () => ({
  useSourceConnections: () => ({
    providers: [
      { provider: 'github', displayName: 'GitHub' },
      { provider: 'gitlab', displayName: 'GitLab' },
    ],
    connections: data.connections,
    loading: false,
    failed: false,
    providerName: (provider: string) => provider,
  }),
}));

vi.mock('../shared/useRepositories', () => ({
  useRepositories: () => ({
    repositories: data.repositories,
    loading: false,
    failed: data.reposFailed,
  }),
}));

import { RepositoryPicker, type RepositoryPickerProps } from './RepositoryPicker';

const connection = (id: string, provider: string): ConnectionDto =>
  ({ id, provider, label: id, base_url: '', secret_ref: `ref-${id}` }) as ConnectionDto;

const repo = (full_path: string): RemoteRepoDto => ({
  id: full_path,
  name: full_path.split('/')[1]!,
  full_path,
  clone_url: `https://example.test/${full_path}.git`,
  default_branch: null,
  visibility: 'private',
});

function renderPicker(props: Partial<RepositoryPickerProps> = {}) {
  const handlers = {
    onProviderChange: vi.fn(),
    onConnectionChange: vi.fn(),
    onSearchChange: vi.fn(),
    onToggle: vi.fn(),
  };
  render(
    <RepositoryPicker
      providerId="github"
      connectionId={null}
      search=""
      picks={[]}
      atCap={false}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

beforeEach(() => {
  data.connections = [connection('c-github', 'github')];
  data.repositories = [repo('acme/api')];
  data.reposFailed = false;
});

describe('the repository picker', () => {
  it('offers a chip only for a provider the organization has a connection to', () => {
    renderPicker({ providerId: null });

    expect(screen.getByRole('button', { name: 'GitHub' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'GitLab' })).toBeNull();
  });

  it('says when the search matches nothing, and Clear search empties it', () => {
    data.repositories = [];
    const { onSearchChange } = renderPicker({ search: 'zzz' });

    expect(screen.getByText('repos_no_match')).toBeTruthy();
    expect(screen.queryByText('repos_empty_title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'clear_search' }));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('makes the unpicked rows inert at the ceiling, and still lets a pick be taken back', () => {
    data.repositories = [repo('acme/api'), repo('acme/web')];
    const picked = {
      id: 'acme/api',
      fullPath: 'acme/api',
      cloneUrl: 'https://example.test/acme/api.git',
      connectionId: 'c-github',
    };
    const { onToggle } = renderPicker({ picks: [picked], atCap: true });

    const web = screen.getByRole('checkbox', { name: 'acme/web' }).closest('tr')!;
    expect(web.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(web);
    expect(onToggle).not.toHaveBeenCalled();

    const api = screen.getByRole('checkbox', { name: 'acme/api' }).closest('tr')!;
    expect(api.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(api);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'acme/api' }));
  });

  it("says when the connection's repositories cannot be read, with no table", () => {
    data.reposFailed = true;
    renderPicker();

    expect(screen.getByText('repos_error')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
