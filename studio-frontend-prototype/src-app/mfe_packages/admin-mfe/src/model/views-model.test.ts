// The prototype's src/views-model.test.ts (studio-frontend-poc/), on an organization's model as
// `GET /studio-domain-model/v1/types` answers it instead of the build's seed; problems are keys.
import { describe, expect, it } from 'vitest';

import { modelOf } from './domain-runtime';
import {
  GRAPH_RELATED_LIMIT,
  LIST_VIEWS,
  PageCursors,
  blankView,
  canStoreViews,
  coerce,
  fromViewObject,
  graphQuery,
  labelField,
  pageQuery,
  problems,
  relationLabel,
  relationsOf,
  saveViewMutation,
  toGraph,
  toQuery,
  toViewObject,
  viewableTypes,
  type ViewSpec,
} from './views-model';

const edge = (name: string, type: string) => ({ name, type, extends: 'edge' });

const model = modelOf({
  can_edit_model: true,
  ontology: {
    buckets: [{ id: 'planning' }, { id: 'graph' }],
    entities: [
      { id: 'named', abstract: true, properties: [{ name: 'name', type: 'string' }] },
      {
        id: 'project',
        extends: 'named',
        bucket: 'planning',
        properties: [
          { name: 'title', type: 'string?' },
          { name: 'description', type: 'text' },
          { name: 'status', type: 'planned | active | archived' },
          { name: 'version', type: 'integer' },
          { name: 'archived', type: 'boolean' },
          { name: 'target_at', type: 'timestamp?' },
          edge('uses', 'repository'),
        ],
      },
      { id: 'repository', extends: 'named', bucket: 'graph', properties: [] },
      { id: 'team', extends: 'named', bucket: 'planning', properties: [edge('delivers', 'project')] },
      { id: 'note', properties: [{ name: 'body', type: 'text' }] },
      { id: 'view', properties: [{ name: 'name', type: 'string' }, { name: 'view_kind', type: 'object | graph' }] },
    ],
  },
});

const active: ViewSpec = {
  id: 'v1',
  name: 'Active projects',
  type: 'project',
  columns: ['name', 'status'],
  conditions: [{ field: 'status', op: '_eq', value: 'active' }],
  relations: ['uses'],
  sort: { field: 'name', direction: 'asc' },
  kind: 'table',
};

describe("a view compiles to the query endpoint's body", () => {
  it('columns, conditions, related objects and order', () => {
    expect(toQuery(model, active)).toEqual({
      type: 'project',
      fields: ['name', 'status'],
      where: { status: { _eq: 'active' } },
      order_by: [{ field: 'name', direction: 'asc' }],
      include: { uses: { fields: ['name'], order_by: [{ field: 'name' }], limit: 5 } },
    });
  });

  it("ANDs several conditions and coerces by the field's kind", () => {
    const q = toQuery(model, {
      ...active,
      relations: [],
      conditions: [
        { field: 'status', op: '_neq', value: 'archived' },
        { field: 'version', op: '_gt', value: ' 2 ' },
        { field: 'archived', op: '_eq', value: 'false' },
        { field: 'title', op: '_contains', value: ' apo ' },
        { field: 'target_at', op: '_is_null', value: '' },
        { field: 'description', op: '_not_null', value: 'ignored' },
      ],
    });
    expect(q.where).toEqual({
      _and: [
        { status: { _neq: 'archived' } },
        { version: { _gt: 2 } },
        { archived: { _eq: false } },
        { title: { _contains: 'apo' } },
        { target_at: { _is_null: true } },
        { description: { _is_null: false } },
      ],
    });
  });

  it('coerces a number, a yes/no and leaves the rest as typed', () => {
    expect(coerce({ kind: 'number' }, '42')).toBe(42);
    expect(coerce({ kind: 'boolean' }, 'true')).toBe(true);
    expect(coerce({ kind: 'boolean' }, 'yes')).toBe(false);
    expect(coerce({ kind: 'enum', values: ['a'] }, ' a ')).toBe('a');
    expect(coerce(undefined, ' x ')).toBe('x');
  });

  it("a page adds the reader's sort, search and window to the view's own", () => {
    const q = pageQuery(model, active, { q: 'apo', sort: { key: 'status', dir: 'desc' }, offset: 50, limit: 25 });
    expect(q.order_by).toEqual([{ field: 'status', direction: 'desc' }]);
    expect(q.offset).toBe(50);
    expect(q.limit).toBe(25);
    expect(q.where).toEqual({
      _and: [
        { status: { _eq: 'active' } },
        {
          _or: [
            { name: { _contains: 'apo' } },
            { title: { _contains: 'apo' } },
            { description: { _contains: 'apo' } },
          ],
        },
      ],
    });
  });

  it("a relation column's sort key is not a field, so the view's order stays", () => {
    const q = pageQuery(model, active, { q: '', sort: { key: 'rel:uses', dir: 'asc' }, offset: 0, limit: 10 });
    expect(q.order_by).toEqual([{ field: 'name', direction: 'asc' }]);
  });
});

describe('a view is stored as a `view` object and read back', () => {
  it('round-trips, with the compiled query beside what the editor needs', () => {
    const stored = toViewObject(model, active);
    expect(stored.query).toEqual(toQuery(model, active));
    expect(stored.view_kind).toBe('object');
    expect(fromViewObject(model, stored)).toEqual(active);
  });

  it('is written as one upsert by its stable key, payload checks off', () => {
    expect(saveViewMutation(model, active)).toEqual({
      validate: 'off',
      operations: [{ op: 'upsert', type: 'view', key: 'v1', value: toViewObject(model, active) }],
    });
    const retired = saveViewMutation(model, active, { valid_to: '2026-11-10T00:00:00.000Z' });
    expect(retired.operations[0]).toMatchObject({ key: 'v1', value: { name: 'Active projects', valid_to: '2026-11-10T00:00:00.000Z' } });
  });

  it('reopens a view another reader wrote from its query alone', () => {
    const spec = fromViewObject(model, {
      id: 'v9',
      name: 'Bare',
      view_kind: 'graph',
      query: { type: 'project', fields: ['name'], include: { uses: {} } },
    });
    expect(spec).toEqual({ id: 'v9', name: 'Bare', type: 'project', columns: ['name'], conditions: [], relations: ['uses'], sort: null, kind: 'graph' });
  });

  it('ignores a view this screen did not write', () => {
    expect(fromViewObject(model, { id: 'x', name: 'graph', query: { type: 'no-such-entity' } })).toBeNull();
    expect(fromViewObject(model, { name: 'no id', query: { type: 'project' } })).toBeNull();
  });

  it('lists live views only, by name', () => {
    expect(LIST_VIEWS).toMatchObject({ type: 'view', where: { valid_to: { _is_null: true } }, order_by: [{ field: 'name' }] });
  });
});

describe('the model a view is written against', () => {
  it('offers the concrete types and knows whether views can be stored', () => {
    expect(viewableTypes(model)).toEqual(['note', 'project', 'repository', 'team', 'view']);
    expect(canStoreViews(model)).toBe(true);
    expect(canStoreViews(modelOf({ can_edit_model: false, ontology: { entities: [{ id: 'project' }] } }))).toBe(false);
  });

  it("a type's label is its name, then its title, then its id", () => {
    expect(labelField(model, 'project')).toBe('name');
    expect(labelField(model, 'note')).toBe('id');
    expect(blankView(model, 'note', 'v3').columns).toEqual(['id']);
  });
});

describe('what the editor refuses to save', () => {
  it('names what is missing or wrong', () => {
    const blank = blankView(model, 'project', 'v2');
    expect(problems(model, blank)).toEqual([{ key: 'vw_problem_name' }]);
    expect(problems(model, { ...blank, name: 'x', columns: [] })).toEqual([{ key: 'vw_problem_columns' }]);
    expect(
      problems(model, {
        ...blank,
        name: 'x',
        columns: ['colour'],
        relations: ['members'],
        conditions: [
          { field: 'version', op: '_eq', value: 'two' },
          { field: 'status', op: '_eq', value: ' ' },
          { field: 'id', op: '_eq', value: 'p1' },
          { field: 'nope', op: '_is_null', value: '' },
        ],
      })
    ).toEqual([
      { key: 'vw_problem_not_field', params: { field: 'colour', type: 'project' } },
      { key: 'vw_problem_not_relation', params: { relation: 'members', type: 'project' } },
      { key: 'vw_problem_number', params: { field: 'version' } },
      { key: 'vw_problem_value', params: { field: 'status' } },
      { key: 'vw_problem_not_field', params: { field: 'nope', type: 'project' } },
    ]);
  });
});

describe('a graph view', () => {
  const graph: ViewSpec = { ...active, kind: 'graph' };

  it("is stored as the model's graph kind and read back as one", () => {
    const stored = toViewObject(model, graph);
    expect(stored.view_kind).toBe('graph');
    expect(fromViewObject(model, stored)?.kind).toBe('graph');
  });

  it('asks for more related objects than a table shows', () => {
    expect(graphQuery(model, graph).include?.uses.limit).toBe(GRAPH_RELATED_LIMIT);
  });

  it('draws each object once and each included relation as an edge', () => {
    const repo = { id: 'r1', entity: 'repository', value: { name: 'web-portal' }, relations: {} };
    const g = toGraph(model, graph, {
      items: [
        { id: 'p1', entity: 'project', value: { name: 'Apollo' }, relations: { uses: { items: [repo], total: 1, complete: true } } },
        { id: 'p2', entity: 'project', value: { name: 'Mercury' }, relations: { uses: { items: [repo], total: 1, complete: true } } },
      ],
      total: 2,
      complete: true,
      warnings: [],
    });
    expect(g.nodes.map((n) => n.name)).toEqual(['Apollo', 'web-portal', 'Mercury']);
    expect(g.nodes[0].bucket).toBe('planning');
    expect(g.edges.map((e) => `${e.from}->${e.to}:${e.type_id}`)).toEqual(['p1->r1:uses', 'p2->r1:uses']);
  });
});

describe('a view can follow a relation backwards', () => {
  it('offers the relations other entities declare towards its type', () => {
    expect(relationsOf(model, 'project')['~team.delivers']).toBe('team');
    expect(relationsOf(model, 'project').uses).toBe('repository');
  });

  it('includes them under their reverse name, labelled by the source', () => {
    const q = toQuery(model, { ...active, relations: ['~team.delivers'] });
    expect(q.include).toEqual({
      '~team.delivers': { fields: ['name'], order_by: [{ field: 'name' }], limit: 5 },
    });
    expect(problems(model, { ...active, relations: ['~team.delivers'] })).toEqual([]);
  });
});

describe('a relation reads as words', () => {
  it('forwards by its name and target, backwards by who points here', () => {
    expect(relationLabel('delivers', 'project')).toBe('delivers → project');
    expect(relationLabel('has_members', 'person')).toBe('has members → person');
    expect(relationLabel('~team.delivers', 'team')).toBe('team · delivers this');
    expect(relationLabel('~project.includes_2', 'project')).toBe('project · includes this');
  });
});

describe('PageCursors', () => {
  const page = (offset: number) => pageQuery(model, active, { q: '', sort: null, offset, limit: 25 });

  it('asks a page that follows one already read by its cursor', () => {
    const cursors = new PageCursors();
    expect(cursors.place(page(0))).toEqual(page(0));
    cursors.note(page(0), 25, 'c25');
    const next = cursors.place(page(25));
    expect(next.cursor).toBe('c25');
    expect(next.offset).toBeUndefined();
    expect(next.limit).toBe(25);
  });

  it('jumps by offset to a page nobody has read, and forgets nothing on the last page', () => {
    const cursors = new PageCursors();
    cursors.note(page(0), 25, 'c25');
    expect(cursors.place(page(50)).offset).toBe(50);
    cursors.note(page(50), 3, undefined);
    expect(cursors.place(page(53)).cursor).toBeUndefined();
  });

  it('keeps cursors apart per search and sort', () => {
    const cursors = new PageCursors();
    cursors.note(page(0), 25, 'c25');
    const searched = pageQuery(model, active, { q: 'apo', sort: null, offset: 25, limit: 25 });
    expect(cursors.place(searched).cursor).toBeUndefined();
  });
});
