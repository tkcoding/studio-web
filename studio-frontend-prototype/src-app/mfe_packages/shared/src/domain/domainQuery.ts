/**
 * `POST /studio-domain-model/v1/query` and `/mutate` as the generic screens
 * write them (ADR-0066): the request and answer shapes the gear documents
 * (`QueryObjectsRequest`, `QueryObjectsResponse`, `MutateObjectsRequest`), and
 * the few requests the screens build from the live model — pure, so they are
 * tested without a server.
 */

import { fieldsOfModel, type DomainModel, type ModelField } from './runtime';

export type SortDirection = 'asc' | 'desc';

export interface DomainOrderBy {
  field: string;
  direction?: SortDirection;
}

/** What to read of one type, or of one relation of it under `include`. */
export interface DomainSelection {
  where?: Record<string, unknown>;
  order_by?: DomainOrderBy[];
  fields?: string[];
  include?: Record<string, DomainSelection>;
  /** 1..=200, default 50; per parent under `include`. */
  limit?: number;
}

export interface DomainQueryRequest extends DomainSelection {
  /** An ontology id (`project`), a node type id or its leaf. */
  type: string;
  /** The workspace or project the objects were created in (its tenant id). */
  project_id?: string;
  offset?: number;
}

/** One object of an answer: `{id, entity, value, relations}`. */
export interface DomainQueryRow {
  id: string;
  entity: string;
  value: Record<string, unknown>;
  relations?: Record<string, DomainRowSet>;
}

export interface DomainRowSet {
  items: DomainQueryRow[];
  /** Matches across every page. */
  total: number;
  /** False when the graph answered and stopped at its read limit. */
  complete: boolean;
}

export interface DomainQueryResult extends DomainRowSet {
  warnings?: string[];
  /** `read_model` (Postgres) or `graph`. */
  source?: string;
  next_cursor?: string | null;
}

export type DomainOperation =
  | { op: 'patch'; id: string; set?: Record<string, unknown>; unset?: string[] }
  | {
      op: 'upsert';
      type: string;
      key: string;
      value: Record<string, unknown>;
      project_id?: string;
    };

export interface DomainMutation {
  operations: DomainOperation[];
  validate?: 'strict' | 'warn' | 'off';
}

export interface DomainMutationResult {
  results: { op: string; id: string; violations?: unknown[] }[];
}

/** The gear's page ceiling. */
export const QUERY_MAX_LIMIT = 200;
/** A generic tab's page. */
export const LIST_PAGE = 50;

export interface SortState {
  field: string;
  direction: SortDirection;
}

/** A column header clicked: ascending, then descending, then the gear's own order. */
export function nextSort(current: SortState | null, field: string): SortState | null {
  if (!current || current.field !== field) return { field, direction: 'asc' };
  if (current.direction === 'asc') return { field, direction: 'desc' };
  return null;
}

/** The objects of `type` in a level: the workspace or project scope they were
 *  created in, or the whole organization when `scope` is null. */
export function listQuery({
  type,
  scope,
  sort,
  limit = LIST_PAGE,
  offset = 0,
}: {
  type: string;
  scope: string | null;
  sort?: SortState | null;
  limit?: number;
  offset?: number;
}): DomainQueryRequest {
  const q: DomainQueryRequest = { type, limit: Math.min(Math.max(1, limit), QUERY_MAX_LIMIT) };
  if (scope) q.project_id = scope;
  if (sort) q.order_by = [{ field: sort.field, direction: sort.direction }];
  if (offset > 0) q.offset = offset;
  return q;
}

/** One object by its id, with one relation followed when `relation` is named. */
export function objectQuery({
  type,
  id,
  relation,
  limit = 20,
}: {
  type: string;
  id: string;
  relation?: string;
  limit?: number;
}): DomainQueryRequest {
  const q: DomainQueryRequest = { type, where: { id: { _eq: id } }, limit: 1 };
  if (relation) q.include = { [relation]: { limit: Math.min(Math.max(1, limit), QUERY_MAX_LIMIT) } };
  return q;
}

/**
 * The object that describes a tenant (an organization, a workspace, a
 * project): the type's object keyed `self` in the tenant's own scope, found by
 * the tenant's id in `tenant_id`, a field every model type inherits — as the
 * prototype's `ObjectAttributes` read and wrote it.
 */
export function selfQuery(type: string, tenantId: string): DomainQueryRequest {
  return { type, project_id: tenantId, where: { tenant_id: { _eq: tenantId } }, limit: 1 };
}

/** The key of the object that describes a tenant. */
export const SELF_KEY = 'self';

/** The model's primitives: fields every object has for the store, not for people. */
export const SYSTEM_BUCKET = 'system-primitives';

/** The fields of `type` a person reads: every own and inherited one but the
 *  model's system fields and the id. */
export function readableFields(model: DomainModel, type: string): ModelField[] {
  if (!model.byId.has(type)) return [];
  const system = new Set(model.entities.filter((e) => e.bucket === SYSTEM_BUCKET).map((e) => e.id));
  return fieldsOfModel(model, type).filter((f) => !system.has(f.declaredBy) && f.name !== 'id');
}

const NAMING = ['name', 'title'];

/** A generic table's columns: the naming fields first, then what the type
 *  itself declares, then what its bases do; fields of no kind a cell can show
 *  are left out, and at most `max`. */
export function tableColumns(model: DomainModel, type: string, max = 6): ModelField[] {
  const fields = readableFields(model, type).filter((f) => f.kind.kind !== 'unknown');
  const rank = (f: ModelField) => (NAMING.includes(f.name) ? 0 : f.declaredBy === type ? 1 : 2);
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => f)
    .slice(0, max);
}

/** What a person filled in, as the value each field's kind stores; null clears it. */
export function parsedValue(field: ModelField, raw: string | boolean): unknown {
  if (typeof raw === 'boolean') return raw;
  const v = raw.trim();
  if (v === '') return null;
  switch (field.kind.kind) {
    case 'number':
      return Number.isNaN(Number(v)) ? v : Number(v);
    case 'list':
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    case 'unknown':
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return v;
      }
    default:
      return v;
  }
}

/** A stored value as an input holds it. */
export function inputValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * The one write that saves an Attributes card: a patch of the object when it
 * exists, else an upsert of the tenant's `self` object carrying `tenant_id`
 * and the facts the tenant already says about itself (its name). Null when
 * nothing changed.
 */
export function attributesWrite({
  type,
  tenantId,
  objectId,
  fields,
  before,
  draft,
  facts = {},
}: {
  type: string;
  tenantId: string;
  objectId: string | null;
  fields: readonly ModelField[];
  before: Record<string, unknown>;
  draft: Record<string, string | boolean>;
  facts?: Record<string, unknown>;
}): DomainOperation | null {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const f of fields) {
    if (!(f.name in draft) || f.heldBy) continue;
    const next = parsedValue(f, draft[f.name] ?? '');
    const prior = before[f.name] ?? null;
    if (JSON.stringify(next) === JSON.stringify(prior)) continue;
    if (next === null) unset.push(f.name);
    else set[f.name] = next;
  }
  if (objectId) {
    if (Object.keys(set).length === 0 && unset.length === 0) return null;
    return { op: 'patch', id: objectId, set, unset };
  }
  const value: Record<string, unknown> = { ...facts, ...set, tenant_id: tenantId };
  return { op: 'upsert', type, key: SELF_KEY, project_id: tenantId, value };
}

/** A stored value as text, for reading. */
export function shownValue(v: unknown, yes = 'yes', no = 'no'): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => shownValue(x, yes, no)).join(', ');
  if (typeof v === 'boolean') return v ? yes : no;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
