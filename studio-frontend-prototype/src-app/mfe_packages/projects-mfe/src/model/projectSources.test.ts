import { describe, expect, it } from 'vitest';
import type { ProjectSource } from '@constructor-studio/mfe-shared';
import {
  repositoryKey,
  repositoryWebUrl,
  supportsPullRequests,
  withShareMode,
  withSources,
  withoutSource,
} from './projectSources';

const source = (connection: string, fullPath: string): ProjectSource => ({
  connection_id: connection,
  full_path: fullPath,
  clone_url: `https://github.com/${fullPath}.git`,
});

const API = source('c-1', 'acme/api');
const WEB = { ...source('c-1', 'acme/web'), branch: 'main', share_mode: 'pull_request' } as const;
const DOCS = source('c-2', 'acme/docs');

describe('repositoryKey', () => {
  it('names a repository however its URL is spelled', () => {
    expect(repositoryKey(' https://user:token@GitHub.com/Acme/API.git/ ')).toBe('github.com/acme/api');
    expect(repositoryKey('https://github.com/acme/api')).toBe('github.com/acme/api');
    expect(repositoryKey('https://github.com/acme/api/.git')).toBe('github.com/acme/api');
  });

  it('names nothing without a scheme, a host or a path', () => {
    expect(repositoryKey('git@github.com:acme/api.git')).toBeNull();
    expect(repositoryKey('https://github.com/')).toBeNull();
  });
});

describe('repositoryWebUrl', () => {
  it.each([
    ['https://github.com/acme/api.git', 'https://github.com/acme/api'],
    ['https://jdoe@bitbucket.org/acme/api.git', 'https://bitbucket.org/acme/api'],
    ['https://x-access-token:secret@github.com/acme/api.git', 'https://github.com/acme/api'],
    ['http://git.internal:8443/acme/api.git', 'http://git.internal:8443/acme/api'],
    ['https://gitlab.com/group/sub/api/', 'https://gitlab.com/group/sub/api'],
    ['https://github.com/acme/api.github.io.git', 'https://github.com/acme/api.github.io'],
  ])('%s opens %s', (cloneUrl, page) => {
    expect(repositoryWebUrl(cloneUrl)).toBe(page);
  });

  it.each([
    'git@github.com:acme/api.git',
    'ssh://git@github.com/acme/api.git',
    'git://github.com/acme/api.git',
    'https://github.com/',
    '',
  ])('%s gives none', (cloneUrl) => {
    expect(repositoryWebUrl(cloneUrl)).toBeNull();
  });
});

describe('withSources', () => {
  it('appends after the sources there are, and says what it appended', () => {
    const { sources, added } = withSources([API, WEB], [DOCS]);
    expect(sources).toEqual([API, WEB, DOCS]);
    expect(added).toEqual([DOCS]);
  });

  it('skips a repository already attached, through any connection', () => {
    const again = { ...source('c-2', 'Acme/API'), clone_url: 'https://github.com/Acme/API' };
    const { sources, added } = withSources([API], [again, DOCS, DOCS]);
    expect(sources).toEqual([API, DOCS]);
    expect(added).toEqual([DOCS]);
  });
});

describe('withoutSource', () => {
  it('removes the one entry and keeps the others as they were', () => {
    expect(withoutSource([API, WEB, DOCS], { connection_id: 'c-1', full_path: 'acme/web' })).toEqual([
      API,
      DOCS,
    ]);
  });

  it('matches the connection as well as the path', () => {
    expect(withoutSource([API], { connection_id: 'c-2', full_path: 'acme/api' })).toEqual([API]);
  });
});

describe('withShareMode', () => {
  it('changes the one entry and nothing else of it', () => {
    expect(
      withShareMode([API, WEB, DOCS], { connection_id: 'c-1', full_path: 'acme/api' }, 'pull_request')
    ).toEqual([{ ...API, share_mode: 'pull_request' }, WEB, DOCS]);
    expect(withShareMode([WEB], { connection_id: 'c-1', full_path: 'acme/web' }, 'branch')).toEqual([
      { ...WEB, share_mode: 'branch' },
    ]);
  });

  it('leaves the sources as they were when the entry is gone', () => {
    expect(
      withShareMode([API], { connection_id: 'c-2', full_path: 'acme/api' }, 'pull_request')
    ).toEqual([API]);
  });
});

describe('supportsPullRequests', () => {
  it('is GitHub only', () => {
    expect(supportsPullRequests('github')).toBe(true);
    expect(supportsPullRequests('gitlab')).toBe(false);
    expect(supportsPullRequests(null)).toBe(false);
  });
});
