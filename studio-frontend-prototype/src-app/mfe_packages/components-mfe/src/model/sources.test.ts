import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCES, SOURCES_KEY, loadSources, saveSources, syncBody } from './sources';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('catalogue sources', () => {
  it('default to crates.io alone, and keep what this browser chose', () => {
    const store = memory();
    expect(loadSources(store)).toEqual(DEFAULT_SOURCES);
    saveSources(store, { ...DEFAULT_SOURCES, keyword: 'acme' });
    expect(JSON.parse(store.data.get(SOURCES_KEY) ?? '{}').keyword).toBe('acme');
    expect(loadSources(store).keyword).toBe('acme');
    expect(loadSources(null)).toEqual(DEFAULT_SOURCES);
  });

  it('become the sync body, the kit repositories both in `kits` mode', () => {
    const body = syncBody(
      {
        ...DEFAULT_SOURCES,
        keyword: ' ',
        gears: { ...DEFAULT_SOURCES.gears, enabled: true, connectionId: 'c1' },
        kitsPm: { ...DEFAULT_SOURCES.kitsPm, enabled: true, gitRef: '' },
      },
      'org-1'
    );
    expect(body).toEqual({
      crates_io: 'constructorfabric',
      repositories: [
        { tenant: 'org-1', connection_id: 'c1', repo: 'constructorfabric/gears-rust', git_ref: 'HEAD', mode: 'gears' },
        { tenant: 'org-1', connection_id: null, repo: 'constructorfabric/studio-kits-pm', git_ref: null, mode: 'kits' },
      ],
    });
  });

  it('say why there is nothing to sync', () => {
    expect(syncBody({ ...DEFAULT_SOURCES, cratesIo: false }, 'org-1')).toBe('Enable at least one source.');
    expect(syncBody({ ...DEFAULT_SOURCES, gears: { ...DEFAULT_SOURCES.gears, enabled: true } }, null)).toMatch(/No workspace/);
    expect(syncBody({ ...DEFAULT_SOURCES, frontx: { ...DEFAULT_SOURCES.frontx, enabled: true, repo: '' } }, 'o')).toBe(
      'Enter the frontx repository (owner/name).'
    );
  });
});
