import { describe, expect, it } from 'vitest';
import { allPages, bareSource, entryPath, orgScoped } from './ComponentsApiService';

describe('the catalogue routes', () => {
  it('name the organization on screen, once', () => {
    expect(orgScoped('/studio-components-catalog/v1/registry?limit=500', 'o 1')).toBe(
      '/studio-components-catalog/v1/registry?limit=500&organization_id=o%201'
    );
    expect(orgScoped('/studio-components-catalog/v1/components', 'o1')).toBe('/studio-components-catalog/v1/components?organization_id=o1');
    expect(orgScoped('/x?organization_id=a', 'b')).toBe('/x?organization_id=a');
    // No organization in scope: the caller's home tenant answers.
    expect(orgScoped('/studio-components-catalog/v1/components', null)).toBe('/studio-components-catalog/v1/components');
  });

  it('address an entry by its encoded name', () => {
    expect(entryPath('@acme/ui kit', '/decisions')).toBe('/studio-components-catalog/v1/registry/%40acme%2Fui%20kit/decisions');
  });

  it('send a source without the marks the server answers with', () => {
    expect(
      bareSource({ tenant: 't', connection_id: null, repo: 'a/b', git_ref: null, mode: 'gears', shadowed_by_platform: true })
    ).toEqual({ tenant: 't', connection_id: null, repo: 'a/b', git_ref: null, mode: 'gears' });
  });

  it('read every page, and stop on an empty one', async () => {
    const pages = [{ items: [1, 2], total: 3 }, { items: [3], total: 3 }];
    const offsets: number[] = [];
    expect(await allPages(async (offset) => (offsets.push(offset), pages[offsets.length - 1]))).toEqual([1, 2, 3]);
    expect(offsets).toEqual([0, 200]);
    expect(await allPages(async () => ({ items: [] as number[], total: 10 }))).toEqual([]);
  });
});
