import { describe, expect, it } from 'vitest';
import type { CatalogType } from '../api/types';
import { byComponentThenId, familyOf, inLens, shortName, titleize } from './objects';

const type = (leaf_id: string, patch: Partial<CatalogType> = {}): CatalogType => ({
  type_id: leaf_id,
  leaf_id,
  is_abstract: false,
  component: false,
  schema: 'none',
  ...patch,
});

describe('how a type reads', () => {
  it('groups by namespace and names it by its own segment', () => {
    expect(familyOf('gts.cf.studio.catalog.gear.v1~')).toBe('studio.catalog');
    expect(shortName('gts.cf.studio.catalog.gear_profile.v1~')).toBe('gear_profile');
    expect(titleize('gear_profile')).toBe('Gear Profile');
    expect(familyOf('x.y')).toBe('x.y');
  });

  it('filters by lens', () => {
    const t = type('a', { component: true, schema: 'tenant', is_abstract: false });
    expect(inLens(t, 'all')).toBe(true);
    expect(inLens(t, 'components')).toBe(true);
    expect(inLens(t, 'described')).toBe(true);
    expect(inLens(t, 'abstract')).toBe(false);
  });

  it('puts components first, then by id', () => {
    const list = [type('b'), type('c', { component: true }), type('a')].sort(byComponentThenId);
    expect(list.map((t) => t.leaf_id)).toEqual(['c', 'a', 'b']);
  });
});
