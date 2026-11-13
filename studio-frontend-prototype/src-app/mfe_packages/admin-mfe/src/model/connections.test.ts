// The "picking repositories" cases are the prototype's (src/project-sources.test.ts at 00828880), unchanged.
import { describe, expect, it } from 'vitest';
import type { ProjectSource } from '@constructor-studio/mfe-shared';
import type { RemoteRepo, StoredConnection } from '../api/types';
import {
  environmentsByConnection,
  hasRepository,
  missingCategories,
  nonDefaultAddress,
  orgOnlyProvider,
  reachFor,
  sharedConnections,
  supportsPullRequests,
  withPicked,
} from './connections';

const connection = {
  id: 'c1',
  provider: 'github',
  secret_ref: 'studio-connection-c1',
} as StoredConnection;

const src = (full_path: string, clone_url = `https://github.com/${full_path}.git`): ProjectSource => ({
  connection_id: 'c1',
  full_path,
  clone_url,
});

describe('picking repositories', () => {
  const pick = (full_path: string, branch?: string): RemoteRepo => ({
    id: full_path,
    name: full_path.split('/')[1],
    full_path,
    clone_url: `https://github.com/${full_path}.git`,
    default_branch: branch,
  });

  it('adds each through its connection with its default branch, shared to that branch', () => {
    const got = withPicked([], connection, [pick('acme/api', 'main')]);
    expect(got.added).toBe(1);
    expect(got.sources).toEqual([
      {
        connection_id: 'c1',
        full_path: 'acme/api',
        clone_url: 'https://github.com/acme/api.git',
        branch: 'main',
        share_mode: 'branch',
      },
    ]);
  });

  it('records the share mode chosen for them, and leaves the listed ones as they are', () => {
    const listed: ProjectSource = { ...src('acme/web'), share_mode: 'branch' };
    const got = withPicked([listed], connection, [pick('acme/web'), pick('acme/api')], 'pull_request');
    expect(got.sources.map((s) => [s.full_path, s.share_mode])).toEqual([
      ['acme/web', 'branch'],
      ['acme/api', 'pull_request'],
    ]);
  });

  it('offer a pull request only through a GitHub connection', () => {
    expect(supportsPullRequests(connection)).toBe(true);
    expect(supportsPullRequests({ provider: 'bitbucket' })).toBe(false);
    expect(supportsPullRequests(null)).toBe(false);
  });

  it('does not add a repository the config already lists, however its URL is spelled', () => {
    const got = withPicked([src('acme/api', 'https://GitHub.com/Acme/api')], connection, [pick('acme/api')]);
    expect(got.added).toBe(0);
    expect(hasRepository(got.sources, 'https://github.com/acme/api.git')).toBe(true);
  });
});

describe('the organization page', () => {
  const providers = [
    { provider: 'github', category: 'source_code' },
    { provider: 'anthropic', category: 'ai' },
    { provider: 'kubernetes', category: 'cluster' },
  ];

  it('lists the shared connections, never a person’s own', () => {
    const rows = [
      { ...connection, id: 'a', scope: 'organization' },
      { ...connection, id: 'b', scope: 'personal' },
      { ...connection, id: 'c', scope: 'workspace' },
    ];
    expect(sharedConnections(rows).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('names the kinds offered that nothing is connected for, in the picker’s order', () => {
    expect(missingCategories(providers, [{ provider: 'github' }])).toEqual(['ai', 'cluster']);
    expect(missingCategories(providers, [])).toEqual(['source_code', 'ai', 'cluster']);
  });

  it('keeps a cluster or a registry to the organization and a signed-in account to the person', () => {
    expect(orgOnlyProvider({ provider: 'kubernetes' })).toBe(true);
    expect(orgOnlyProvider({ provider: 'x', category: 'registry' })).toBe(true);
    expect(orgOnlyProvider({ provider: 'github', category: 'source_code' })).toBe(false);
    expect(reachFor({ provider: 'kubernetes' }, 'personal')).toBe('organization');
    expect(reachFor({ provider: 'research', sign_in: true }, 'organization')).toBe('personal');
    expect(reachFor({ provider: 'github' }, 'personal')).toBe('personal');
  });

  it('shows an address only when it is not the provider’s default', () => {
    expect(nonDefaultAddress('https://github.com/', 'https://github.com')).toBeNull();
    expect(nonDefaultAddress('https://git.acme.dev', 'https://gitlab.com')).toBe('git.acme.dev');
    expect(nonDefaultAddress('', 'https://gitlab.com')).toBeNull();
  });

  it('says which environments deploy with each cluster and registry', () => {
    const uses = environmentsByConnection([
      { name: 'dev', connection_id: 'k1', registry_connection_id: 'r1' },
      { name: 'prod', connection_id: 'k1' },
    ]);
    expect(uses.get('k1')).toEqual(['dev', 'prod']);
    expect(uses.get('r1')).toEqual(['dev']);
  });
});
