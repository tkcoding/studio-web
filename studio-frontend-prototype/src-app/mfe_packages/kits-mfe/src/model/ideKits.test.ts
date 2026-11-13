import { describe, expect, it } from 'vitest';
import {
  reconcileKey,
  repositoryLabel,
  statusTone,
  targetRepository,
  toReconcile,
  type KitInstallation,
  type ProjectRepository,
} from './ideKits';

const installation = (over: Partial<KitInstallation> = {}): KitInstallation => ({
  kit_slug: 'sdlc',
  version: 'v1',
  source: 'github',
  repository_url: 'https://github.com/x/sdlc',
  install_mode: 'copy',
  status: 'installed',
  requested_by: 'u',
  requested_at: '2026-11-01T00:00:00Z',
  scope: 'project',
  ...over,
});

const repos: ProjectRepository[] = [
  { repository_id: 'src-a', label: 'a', kind: 'source' },
  { repository_id: 'proj', label: 'studio', kind: 'project' },
];

describe('statusTone', () => {
  it('reads each state honestly', () => {
    expect(statusTone('installed')).toBe('success');
    expect(statusTone('failed')).toBe('destructive');
    expect(statusTone('pending')).toBe('warning');
    expect(statusTone('installing')).toBe('warning');
    expect(statusTone('something-new')).toBe('secondary');
  });
});

describe('targetRepository', () => {
  it('prefers the pick, then where the kit already is, then the project repository', () => {
    expect(targetRepository('src-a', installation({ repository_id: 'proj' }), repos)).toBe('src-a');
    expect(targetRepository(undefined, installation({ repository_id: 'src-a' }), repos)).toBe('src-a');
    expect(targetRepository(undefined, undefined, repos)).toBe('proj');
    expect(targetRepository(undefined, undefined, [repos[0]])).toBe('src-a');
  });

  it('names none without a session, so the IDE picks the project repository itself', () => {
    expect(targetRepository(undefined, undefined, null)).toBeUndefined();
  });
});

describe('repositoryLabel', () => {
  const entry = { repository_id: 'proj', version: 'v1', status: 'installed', materialized_at: '' };
  it('keeps the label recorded when the kit landed, and marks the whole project', () => {
    expect(repositoryLabel({ ...entry, repository_label: 'kept' }, repos, 'whole project')).toBe('kept · whole project');
    expect(repositoryLabel(entry, repos, 'whole project')).toBe('studio · whole project');
  });

  it('falls back to the id with the IDE closed', () => {
    expect(repositoryLabel({ ...entry, repository_id: 'gone' }, null, 'whole project')).toBe('gone');
  });
});

describe('toReconcile', () => {
  it('rolls out only kits meant for every repository, not mid-install, once per version', () => {
    const every = installation({ kit_slug: 'a', scope: 'all-repositories' });
    const busy = installation({ kit_slug: 'b', scope: 'all-repositories', status: 'installing' });
    const one = installation({ kit_slug: 'c', scope: 'project' });
    const done = installation({ kit_slug: 'd', scope: 'all-repositories' });
    expect(toReconcile([every, busy, one, done], new Set([reconcileKey('d', 'v1')]))).toEqual([every]);
  });
});
