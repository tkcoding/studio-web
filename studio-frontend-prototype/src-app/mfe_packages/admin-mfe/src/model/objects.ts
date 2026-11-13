/**
 * How a graph type reads at a glance — the pure part of the prototype's
 * `object-types.tsx` at 00828880, lifted out of the screen so it is tested.
 */

import type { CatalogType } from '../api/types';

/** The namespace a type id groups under: `vendor.package.namespace.type.vN` → `package.namespace`. */
export function familyOf(leafId: string): string {
  const body = leafId.replace(/^gts\./, '').replace(/~$/, '');
  const tokens = body.split('.');
  return tokens.length >= 3 ? `${tokens[1]}.${tokens[2]}` : body;
}

/** The type's own name, without the ancestry or the version. */
export function shortName(leafId: string): string {
  const body = leafId.replace(/^gts\./, '').replace(/~$/, '');
  const tokens = body.split('.');
  return tokens.length >= 4 ? tokens[3] : body;
}

export function titleize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Lens = 'all' | 'components' | 'described' | 'abstract';

export const LENSES: Lens[] = ['all', 'components', 'described', 'abstract'];

/** The metadata Studio keeps beside a component, never a component of its own; the server refuses the mark. */
export const COMPANION_TYPES = new Set(['gts.cf.studio.catalog.gear_profile.v1~']);

export function inLens(t: CatalogType, lens: Lens): boolean {
  if (lens === 'components') return t.component;
  if (lens === 'described') return t.schema !== 'none';
  if (lens === 'abstract') return t.is_abstract;
  return true;
}

/** Components first — they are what somebody came to check — then by id. */
export function byComponentThenId(a: CatalogType, b: CatalogType): number {
  if (a.component !== b.component) return a.component ? -1 : 1;
  return a.leaf_id.localeCompare(b.leaf_id);
}
