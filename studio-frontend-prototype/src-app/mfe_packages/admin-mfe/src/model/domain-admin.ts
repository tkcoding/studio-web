/**
 * The pure part of the prototype's Administration › Domain model
 * (`studio-frontend-poc/src/domain-model-admin.tsx`), lifted out of the screen
 * so it is tested: the field kinds offered by name, the type list grouped by
 * bucket under the search and the origin filter, the count per origin, and the
 * slug a new type's id is made from. The words are the screen's (i18n keys).
 */

import { ancestorsOf, type DomainModel } from './domain-runtime';
import { originOf, type OriginKey } from './domain-origin';

/** The type expressions most fields need, offered by name; anything else can be typed. */
export const COMMON_TYPES: { key: string; type: string }[] = [
  { key: 'dm_kind_text', type: 'string' },
  { key: 'dm_kind_number', type: 'decimal' },
  { key: 'dm_kind_integer', type: 'integer' },
  { key: 'dm_kind_boolean', type: 'boolean' },
  { key: 'dm_kind_timestamp', type: 'timestamp' },
  { key: 'dm_kind_texts', type: 'string[]' },
  { key: 'dm_kind_link', type: 'url' },
];

/** How a field's type reads: a common kind's name, "One of: …", or the expression itself. */
export type TypeLabel = { key: string } | { choices: string[] } | { raw: string };

export function typeLabel(type: string): TypeLabel {
  const bare = type.replace(/\?$/, '');
  const known = COMMON_TYPES.find((t) => t.type === bare);
  if (known) return { key: known.key };
  if (bare.includes('|')) return { choices: bare.split('|').map((s) => s.trim()) };
  return { raw: bare || '—' };
}

/** A field name the server takes: lower-case words joined by underscores. */
export const validFieldName = (name: string): boolean => /^[a-z][a-z0-9_]*$/.test(name);

/** A type id the server takes: lower-case words joined by hyphens. */
export const validTypeId = (id: string): boolean => /^[a-z][a-z0-9-]*$/.test(id) && !id.endsWith('-');

/** A new type's id, made from its name. */
export function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface TypeRow {
  id: string;
  name: string;
  abstract: boolean;
  origin: OriginKey;
}

/**
 * The types by bucket (the bucket's name; "Other" for none), each list by
 * name, buckets by name — under the search (id or name), the origin filter
 * and, among the kits' types, the one kit chosen (`null`: every kit).
 */
export function groupTypes(
  model: DomainModel,
  query: string,
  originFilter: OriginKey | 'all',
  kit: string | null = null,
  other = 'Other'
): [string, TypeRow[]][] {
  const term = query.trim().toLowerCase();
  const names = new Map(model.buckets.map((b) => [b.id, b.name]));
  const out = new Map<string, TypeRow[]>();
  for (const e of model.entities) {
    const name = e.name ?? e.id;
    if (term && !`${e.id} ${name}`.toLowerCase().includes(term)) continue;
    const origin = originOf(model, e).key;
    if (originFilter !== 'all' && origin !== originFilter) continue;
    if (kit !== null && (origin !== 'kit' || e.meta?.kit !== kit)) continue;
    const bucket = names.get(e.bucket ?? '') ?? e.bucket ?? other;
    const list = out.get(bucket) ?? [];
    list.push({ id: e.id, name, abstract: !!e.abstract, origin });
    out.set(bucket, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return [...out].sort(([a], [b]) => a.localeCompare(b));
}

/** How many types came from each source. */
export function countByOrigin(model: DomainModel): Map<OriginKey, number> {
  const n = new Map<OriginKey, number>();
  for (const e of model.entities) {
    const k = originOf(model, e).key;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return n;
}

/** The kits that brought types, with how many each: what the origin column's kit chips name. */
export function countByKit(model: DomainModel): [string, number][] {
  const n = new Map<string, number>();
  for (const e of model.entities) {
    if (e.meta?.origin !== 'kit' || !e.meta.kit) continue;
    n.set(e.meta.kit, (n.get(e.meta.kit) ?? 0) + 1);
  }
  return [...n].sort(([a], [b]) => a.localeCompare(b));
}

/** The bases a type extends, nearest first, without the type itself. */
export const basesOf = (model: DomainModel, id: string): string[] => ancestorsOf(model, id).slice(1);

/** What a field edit sends: only what changed. */
export function fieldEdit(
  before: { name: string; type: string; required: boolean; description: string },
  after: { name: string; type: string; required: boolean; description: string }
): { rename_to?: string; type?: string; required?: boolean; description?: string } {
  const edit: { rename_to?: string; type?: string; required?: boolean; description?: string } = {};
  if (after.name !== before.name) edit.rename_to = after.name;
  if (after.type !== before.type) edit.type = after.type;
  if (after.required !== before.required) edit.required = after.required;
  if (after.description !== before.description) edit.description = after.description;
  return edit;
}
