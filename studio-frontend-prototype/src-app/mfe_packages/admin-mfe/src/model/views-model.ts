// Saved views: a screen that is data, not code. The prototype's src/views-model.ts (studio-frontend-poc/).
//
// A view is an object of the domain model's own `view` entity. Its `query` is
// exactly the body of `POST /studio-domain-model/v1/query`, and its
// `presentation` is what the editor needs to reopen it. So a new list of the
// model's objects is something a person writes, and neither the portal nor the
// backend changes for it (docs/domain-query-migration.md, step 6).
//
// This file is the part with no React: the shape of a view, what it compiles
// to, and how it is stored. `screens/admin/views/` is the screen.
//
// What differs from the prototype: there is no global model here (no build
// seed, no module-level loader), so every function that reads the model takes
// the organization's, as `GET /studio-domain-model/v1/types` answered it; and
// the editor's problems are message keys with their values, so they read in
// the person's language.

import { fieldsOfModel, includableRelations, type DomainFieldKind, type DomainModel } from './domain-runtime';
import type { RawEdge, RawObj } from '../screens/admin/domain-model/DomainModelGraph';

/** The model's entity a saved view is stored as. */
export const VIEW_TYPE = 'view';

/** One condition, as the editor holds it. Conditions are ANDed. */
export interface ViewCondition {
  field: string;
  op: ViewOp;
  /** As typed. Coerced by the field's kind when the query is built. */
  value: string;
}

export type ViewOp = '_eq' | '_neq' | '_contains' | '_gt' | '_lt' | '_is_null' | '_not_null';

/** The operators the editor offers, in its order; each one's label is `vw_op<op>`. */
export const VIEW_OPS: readonly ViewOp[] = ['_eq', '_neq', '_contains', '_gt', '_lt', '_is_null', '_not_null'];

export const needsValue = (op: ViewOp): boolean => op !== '_is_null' && op !== '_not_null';

/** A view as the screen works with it. */
export interface ViewSpec {
  /** Stable: the object's key, so saving again updates rather than duplicates. */
  id: string;
  name: string;
  type: string;
  columns: string[];
  conditions: ViewCondition[];
  /** Relations shown as columns of the related objects' names. */
  relations: string[];
  sort: { field: string; direction: 'asc' | 'desc' } | null;
  /** A table of the objects, or a graph of them and their related objects. */
  kind: ViewKind;
}

export type ViewKind = 'table' | 'graph';

/** A query as sent: a view's type is only known at runtime, so the screen
 *  speaks this loose shape. */
export interface LooseQuery {
  type: string;
  where?: Record<string, unknown>;
  order_by?: { field: string; direction?: 'asc' | 'desc' }[];
  fields?: string[];
  include?: Record<string, LooseSelection>;
  limit?: number;
  offset?: number;
  cursor?: string;
  project_id?: string;
}

export interface LooseSelection {
  where?: Record<string, unknown>;
  order_by?: { field: string; direction?: 'asc' | 'desc' }[];
  fields?: string[];
  include?: Record<string, LooseSelection>;
  limit?: number;
}

export interface LooseRow {
  id: string;
  entity: string;
  value: Record<string, unknown>;
  relations: Record<string, { items: LooseRow[]; total: number; complete: boolean } | undefined>;
}

export interface LooseResult {
  items: LooseRow[];
  total: number;
  complete: boolean;
  warnings: string[];
  /** `read_model` once the organization's read model answers, `graph` before. */
  source?: 'read_model' | 'graph';
  /** Where the next page starts; absent on the last one. */
  next_cursor?: string;
}

/** Where each page of a query starts, as the page before it said. The table
 *  pages by number; the server pages by cursor (the platform's only way), so a
 *  page that follows one already read is asked by cursor, and only a jump to a
 *  page nobody has read yet goes by offset. */
export class PageCursors {
  private readonly starts = new Map<string, Map<number, string>>();

  private static key(q: LooseQuery): string {
    return JSON.stringify({ ...q, offset: undefined, limit: undefined, cursor: undefined });
  }

  /** `q` as sent: by cursor when its offset is a known page start. */
  place(q: LooseQuery): LooseQuery {
    const at = q.offset ?? 0;
    const cursor = at > 0 ? this.starts.get(PageCursors.key(q))?.get(at) : undefined;
    if (!cursor) return q;
    const out: LooseQuery = { ...q, cursor };
    delete out.offset;
    return out;
  }

  /** What a page of `q` (as built, with its offset) said about the next one. */
  note(q: LooseQuery, rows: number, next: string | undefined): void {
    if (!next) return;
    const key = PageCursors.key(q);
    const starts = this.starts.get(key) ?? new Map<number, string>();
    starts.set((q.offset ?? 0) + rows, next);
    this.starts.set(key, starts);
  }
}

/** Per loaded model, what has been derived from it: a new model (an edit
 *  reloaded it) starts empty. */
const derived = new WeakMap<DomainModel, Map<string, unknown>>();
function memo<T>(model: DomainModel, key: string, make: () => T): T {
  let cache = derived.get(model);
  if (!cache) derived.set(model, (cache = new Map()));
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

/** Is `type` in the organization's model? */
export function isModelType(model: DomainModel, type: string): boolean {
  return model.byId.has(type);
}

/** Can this organization store views at all: its model has the `view` entity. */
export function canStoreViews(model: DomainModel): boolean {
  return model.byId.has(VIEW_TYPE);
}

/** The types a view can list: every concrete one, by id. */
export function viewableTypes(model: DomainModel): string[] {
  return model.entities
    .filter((e) => !e.abstract)
    .map((e) => e.id)
    .sort();
}

/** The fields of an entity and their kinds, from the live model: a field an
 *  administrator adds shows up without a release. */
export function fieldsOf(model: DomainModel, type: string): { readonly [field: string]: DomainFieldKind } {
  return memo(model, `fields:${type}`, () =>
    Object.fromEntries(fieldsOfModel(model, type).map((f) => [f.name, f.kind]))
  );
}

/** The entity's own relations (forwards). */
function forwardOf(model: DomainModel, type: string): { readonly [relation: string]: string } {
  return memo(model, `forward:${type}`, () => includableRelations(model, type));
}

/** The relations other entities declare towards `type`, each named for the
 *  query's reverse include and mapped to the entity it reaches back to. */
export function reverseRelationsOf(model: DomainModel, type: string): { readonly [relation: string]: string } {
  return memo(model, `reverse:${type}`, () => {
    const out: { [relation: string]: string } = {};
    for (const source of model.entities.map((e) => e.id)) {
      for (const [relation, target] of Object.entries(forwardOf(model, source))) {
        if (target === type) out[`~${source}.${relation}`] = source;
      }
    }
    return out;
  });
}

/** The relations of an entity and the entity each reaches: its own, and
 *  backwards those other entities declare towards it, as `~source.relation`
 *  (the query follows those from their target, ADR-0066). */
export function relationsOf(model: DomainModel, type: string): { readonly [relation: string]: string } {
  return memo(model, `relations:${type}`, () => ({ ...forwardOf(model, type), ...reverseRelationsOf(model, type) }));
}

/** How a relation reads in a column header or a picker: `delivers → project`
 *  forwards, and from the other end `team · delivers this`, which says who
 *  points here instead of spelling the query's `~team.delivers`. */
export function relationLabel(name: string, target: string | undefined): string {
  const words = (s: string) => s.replace(/_\d+$/, '').replace(/_/g, ' ');
  if (name.startsWith('~')) {
    const dot = name.indexOf('.');
    const relation = dot >= 0 ? name.slice(dot + 1) : name.slice(1);
    return `${target ?? name.slice(1, dot)} · ${words(relation)} this`;
  }
  return `${words(name)} → ${target ?? '?'}`;
}

/** The field that names an object of `type`: `name`, else `title`, else its id. */
export function labelField(model: DomainModel, type: string): string {
  const f = fieldsOf(model, type);
  if ('name' in f) return 'name';
  if ('title' in f) return 'title';
  return 'id';
}

/** A new view of `type`, with its label field as the one column. */
export function blankView(model: DomainModel, type: string, id: string): ViewSpec {
  return { id, name: '', type, columns: [labelField(model, type)], conditions: [], relations: [], sort: null, kind: 'table' };
}

/** One thing that stops a view being saved: a message key and its values. */
export interface ViewProblem {
  key: string;
  params?: Record<string, string>;
}

/** What is wrong with a view. Empty when it can be saved. */
export function problems(model: DomainModel, spec: ViewSpec): ViewProblem[] {
  const out: ViewProblem[] = [];
  const fields = fieldsOf(model, spec.type);
  const rels = relationsOf(model, spec.type);
  const type = spec.type;
  if (!spec.name.trim()) out.push({ key: 'vw_problem_name' });
  if (spec.columns.length === 0 && spec.relations.length === 0) out.push({ key: 'vw_problem_columns' });
  for (const c of spec.columns) if (!(c in fields)) out.push({ key: 'vw_problem_not_field', params: { field: c, type } });
  for (const r of spec.relations) {
    if (!(r in rels)) out.push({ key: 'vw_problem_not_relation', params: { relation: r, type } });
  }
  for (const c of spec.conditions) {
    if (!(c.field in fields) && c.field !== 'id') {
      out.push({ key: 'vw_problem_not_field', params: { field: c.field, type } });
    }
    const valued = needsValue(c.op);
    if (valued && !c.value.trim()) out.push({ key: 'vw_problem_value', params: { field: c.field } });
    if (valued && fields[c.field]?.kind === 'number' && Number.isNaN(Number(c.value))) {
      out.push({ key: 'vw_problem_number', params: { field: c.field } });
    }
  }
  return out;
}

/** A typed value as the field's kind wants it compared. */
export function coerce(kind: DomainFieldKind | undefined, raw: string): unknown {
  const v = raw.trim();
  if (kind?.kind === 'number') return Number(v);
  if (kind?.kind === 'boolean') return v === 'true';
  return v;
}

/** The conditions as a `where`, or nothing when there are none. */
export function toWhere(model: DomainModel, spec: ViewSpec): Record<string, unknown> | undefined {
  const fields = fieldsOf(model, spec.type);
  const parts = spec.conditions.map((c) => {
    switch (c.op) {
      case '_is_null':
        return { [c.field]: { _is_null: true } };
      case '_not_null':
        return { [c.field]: { _is_null: false } };
      default:
        return { [c.field]: { [c.op]: coerce(fields[c.field], c.value) } };
    }
  });
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : { _and: parts };
}

/** The view's query: the body `POST /query` takes, without paging. */
export function toQuery(model: DomainModel, spec: ViewSpec): LooseQuery {
  const rels = relationsOf(model, spec.type);
  const include: Record<string, LooseSelection> = {};
  for (const r of spec.relations) {
    const target = rels[r];
    if (!target) continue;
    const label = labelField(model, target);
    include[r] = { fields: [label], order_by: [{ field: label }], limit: 5 };
  }
  const q: LooseQuery = { type: spec.type, fields: spec.columns };
  const where = toWhere(model, spec);
  if (where) q.where = where;
  if (spec.sort) q.order_by = [{ field: spec.sort.field, direction: spec.sort.direction }];
  if (spec.relations.length) q.include = include;
  return q;
}

/** One page of the view: its query, the reader's sort and search, and the page. */
export function pageQuery(
  model: DomainModel,
  spec: ViewSpec,
  page: { q: string; sort: { key: string; dir: 'asc' | 'desc' } | null; offset: number; limit: number }
): LooseQuery {
  const q = toQuery(model, spec);
  const fields = fieldsOf(model, spec.type);
  if (page.sort && page.sort.key in fields) {
    q.order_by = [{ field: page.sort.key, direction: page.sort.dir }];
  }
  const term = page.q.trim();
  if (term) {
    const searchable = ['name', 'title', 'description'].filter((k) => k in fields);
    if (searchable.length) {
      const search = { _or: searchable.map((k) => ({ [k]: { _contains: term } })) };
      q.where = q.where ? { _and: [q.where, search] } : search;
    }
  }
  q.offset = page.offset;
  q.limit = page.limit;
  return q;
}

/** What the `view` object stores. `query` is the compiled query, so any reader
 *  of the model can run the view without this screen. */
export function toViewObject(model: DomainModel, spec: ViewSpec): Record<string, unknown> {
  return {
    id: spec.id,
    name: spec.name.trim(),
    // The model's own vocabulary: `object` is a list, `graph` a graph.
    view_kind: spec.kind === 'graph' ? 'graph' : 'object',
    query: toQuery(model, spec),
    presentation: {
      columns: spec.columns,
      relations: spec.relations,
      conditions: spec.conditions,
      sort: spec.sort,
      kind: spec.kind,
    },
  };
}

/** The one write that stores (or, with `extra`, retires) a view: an upsert by
 *  its stable key, so saving again updates rather than duplicates. The view's
 *  stored shape is the editor's, so payload checks are off, as in the prototype. */
export function saveViewMutation(
  model: DomainModel,
  spec: ViewSpec,
  extra?: Record<string, unknown>
): { validate: 'off'; operations: Record<string, unknown>[] } {
  return {
    validate: 'off',
    operations: [{ op: 'upsert', type: VIEW_TYPE, key: spec.id, value: { ...toViewObject(model, spec), ...extra } }],
  };
}

/** A stored `view` back as a spec, or `null` for one this screen did not write
 *  or whose type this organization's model no longer has. */
export function fromViewObject(model: DomainModel, value: Record<string, unknown>): ViewSpec | null {
  const query = value.query as LooseQuery | undefined;
  const p = value.presentation as Partial<ViewSpec> | undefined;
  const type = query?.type;
  if (!type || !isModelType(model, type) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    type,
    columns: Array.isArray(p?.columns) ? p.columns : (query?.fields ?? []),
    conditions: Array.isArray(p?.conditions) ? p.conditions : [],
    relations: Array.isArray(p?.relations) ? p.relations : Object.keys(query?.include ?? {}),
    sort: p?.sort ?? null,
    kind: p?.kind === 'graph' || value.view_kind === 'graph' ? 'graph' : 'table',
  };
}

/** The query that lists the saved views: live ones (no `valid_to`), by name. */
export const LIST_VIEWS: LooseQuery = {
  type: VIEW_TYPE,
  where: { valid_to: { _is_null: true } },
  fields: ['id', 'name', 'query', 'presentation'],
  order_by: [{ field: 'name' }],
  limit: 200,
};

/** How a cell shows a value of any kind. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(cellText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** How many objects a graph view draws, and how many of each one's related
 *  objects: a graph past a few hundred nodes is a hairball, not an answer. */
export const GRAPH_LIMIT = 150;
export const GRAPH_RELATED_LIMIT = 20;

/** The view's query for a graph: the first objects and more of their relations. */
export function graphQuery(model: DomainModel, spec: ViewSpec): LooseQuery {
  const q = toQuery(model, spec);
  q.limit = GRAPH_LIMIT;
  for (const sel of Object.values(q.include ?? {})) sel.limit = GRAPH_RELATED_LIMIT;
  return q;
}

/** A query's answer as the graph draws it: each object a node, each included
 *  relation an edge from the object to the one it reaches. An object reached
 *  twice is one node. */
export function toGraph(model: DomainModel, spec: ViewSpec, res: LooseResult): { nodes: RawObj[]; edges: RawEdge[] } {
  const nodes = new Map<string, RawObj>();
  const edges: RawEdge[] = [];
  const add = (r: LooseRow) => {
    if (nodes.has(r.id)) return;
    const label = isModelType(model, r.entity) ? labelField(model, r.entity) : 'name';
    nodes.set(r.id, {
      instance_id: r.id,
      entity: r.entity,
      bucket: model.byId.get(r.entity)?.bucket ?? '',
      name: cellText(r.value[label] ?? r.id),
      value: r.value,
    });
  };
  for (const r of res.items) {
    add(r);
    for (const name of spec.relations) {
      for (const child of r.relations[name]?.items ?? []) {
        add(child);
        edges.push({ type_id: name, from: r.id, to: child.id, payload: { relation: name } });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}
