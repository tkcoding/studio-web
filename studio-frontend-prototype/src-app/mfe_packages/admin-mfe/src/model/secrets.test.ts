import { describe, expect, it } from 'vitest';
import type { ProjectSource } from '@constructor-studio/mfe-shared';
import { knownSecretRefs, named } from './secrets';

const source = (full_path: string, connection_id = 'c1'): ProjectSource =>
  ({ connection_id, full_path, clone_url: `https://git.example/${full_path}.git` }) as ProjectSource;

describe('the directory each source is cloned into', () => {
  it('is the last path segment, suffixed when taken, and skips sources with nothing to clone', () => {
    expect(
      named([source('a/web'), source('b/web'), { ...source('c/x'), clone_url: ' ' }]).map((n) => n.dir)
    ).toEqual(['web', 'web-2']);
  });
});

describe('the secret references the portal knows about', () => {
  it('collects the project root token and each source connection’s, by reference', () => {
    expect(
      knownSecretRefs([
        {
          name: 'Alpha',
          rootTokenRef: 'pat-root',
          sources: [source('org/web', 'c1'), source('org/api', 'c2')],
          connections: [
            { id: 'c1', secret_ref: 'gh-token' },
            { id: 'c2', secret_ref: null },
          ],
        },
        { name: 'Beta', sources: [source('org/docs', 'c1')], connections: [{ id: 'c1', secret_ref: 'gh-token' }] },
      ])
    ).toEqual([
      { ref: 'gh-token', usedBy: ['Alpha / web', 'Beta / docs'] },
      { ref: 'pat-root', usedBy: ['Alpha (project root)'] },
    ]);
  });

  it('is empty when no workspace names one', () => {
    expect(knownSecretRefs([{ name: 'Alpha', connections: [] }])).toEqual([]);
  });
});
