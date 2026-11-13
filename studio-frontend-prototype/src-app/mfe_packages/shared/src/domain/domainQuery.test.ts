import { describe, expect, it } from 'vitest';
import {
  QUERY_MAX_LIMIT,
  attributesWrite,
  listQuery,
  nextSort,
  objectQuery,
  parsedValue,
  readableFields,
  selfQuery,
  shownValue,
  tableColumns,
} from './domainQuery';
import { fieldsOfModel, modelOf, relationsOfModel } from './runtime';

const model = modelOf({
  can_edit_model: true,
  ontology: {
    entities: [
      { id: 'system-object', bucket: 'system-primitives', properties: [{ name: 'tenant_id', type: 'TenantId' }] },
      { id: 'entity', extends: 'system-object', properties: [{ name: 'id', type: 'EntityId' }, { name: 'created_at', type: 'timestamp' }] },
      {
        id: 'cost-centre',
        name: 'Cost centre',
        extends: 'entity',
        properties: [
          { name: 'code', type: 'string' },
          { name: 'budget', type: 'number' },
          { name: 'payload', type: 'Map<string, JsonValue>' },
          { name: 'name', type: 'string' },
          { name: 'owner', type: 'Person', relation: 'person', extends: 'edge', relationType: 'owns', relationLabel: 'Owner' },
          { name: 'ghost', type: 'Nothing', extends: 'edge', relationType: 'references' },
        ],
      },
      { id: 'person', name: 'Person', extends: 'entity' },
      {
        id: 'project',
        extends: 'entity',
        properties: [
          { name: 'stage', type: 'planned | active' },
          { name: 'tags', type: 'string[]' },
          { name: 'sha', type: 'string', held_by: 'studio-artifact-ingest' },
          { name: 'name', type: 'string' },
        ],
      },
    ],
  },
});

describe('the generic list of a type', () => {
  it('reads one page of the type in the place, sorted when a column is', () => {
    expect(listQuery({ type: 'cost-centre', scope: 'ws-1' })).toEqual({ type: 'cost-centre', project_id: 'ws-1', limit: 50 });
    expect(
      listQuery({ type: 'cost-centre', scope: null, sort: { field: 'code', direction: 'desc' }, offset: 50 })
    ).toEqual({ type: 'cost-centre', limit: 50, order_by: [{ field: 'code', direction: 'desc' }], offset: 50 });
  });

  it('never asks past the gear’s page ceiling', () => {
    expect(listQuery({ type: 't', scope: null, limit: 1000 }).limit).toBe(QUERY_MAX_LIMIT);
    expect(listQuery({ type: 't', scope: null, limit: 0 }).limit).toBe(1);
  });

  it('sorts a column ascending, then descending, then back to the gear’s order', () => {
    const asc = nextSort(null, 'code');
    expect(asc).toEqual({ field: 'code', direction: 'asc' });
    const desc = nextSort(asc, 'code');
    expect(desc).toEqual({ field: 'code', direction: 'desc' });
    expect(nextSort(desc, 'code')).toBeNull();
    expect(nextSort(desc, 'budget')).toEqual({ field: 'budget', direction: 'asc' });
  });

  it('shows the naming field first, then the type’s own, then the bases’, never system fields or shapeless ones', () => {
    expect(tableColumns(model, 'cost-centre').map((f) => f.name)).toEqual(['name', 'code', 'budget', 'created_at']);
    expect(tableColumns(model, 'cost-centre', 2).map((f) => f.name)).toEqual(['name', 'code']);
    expect(tableColumns(model, 'missing')).toEqual([]);
  });
});

describe('one object’s card', () => {
  it('reads the object by id, and one relation only when asked', () => {
    expect(objectQuery({ type: 'cost-centre', id: 'o1' })).toEqual({
      type: 'cost-centre',
      where: { id: { _eq: 'o1' } },
      limit: 1,
    });
    expect(objectQuery({ type: 'cost-centre', id: 'o1', relation: 'owner' }).include).toEqual({ owner: { limit: 20 } });
  });

  it('lists the relations to types the model has, with their labels', () => {
    expect(relationsOfModel(model, 'cost-centre')).toEqual([{ name: 'owner', label: 'Owner', target: 'person', kind: 'owns' }]);
  });

  it('shows every field a person reads, not the id or the system ones', () => {
    expect(readableFields(model, 'cost-centre').map((f) => f.name)).toEqual(['created_at', 'code', 'budget', 'payload', 'name']);
  });

  it('shows a stored value as text', () => {
    expect(shownValue(null)).toBe('—');
    expect(shownValue(['a', 2])).toBe('a, 2');
    expect(shownValue(true, 'да', 'нет')).toBe('да');
    expect(shownValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('the Attributes card', () => {
  const fields = fieldsOfModel(model, 'project').filter((f) => f.name !== 'id');
  const stage = fields.find((f) => f.name === 'stage')!;
  const tags = fields.find((f) => f.name === 'tags')!;

  it('finds the object describing the tenant by its id, in its own scope', () => {
    expect(selfQuery('project', 'p1')).toEqual({ type: 'project', project_id: 'p1', where: { tenant_id: { _eq: 'p1' } }, limit: 1 });
  });

  it('parses what was typed as the field’s kind stores it', () => {
    expect(parsedValue(tags, 'a, b ,')).toEqual(['a', 'b']);
    expect(parsedValue(stage, ' active ')).toBe('active');
    expect(parsedValue(stage, '')).toBeNull();
  });

  it('patches the object it found with what changed, clearing what was emptied', () => {
    expect(
      attributesWrite({
        type: 'project',
        tenantId: 'p1',
        objectId: 'obj-1',
        fields,
        before: { stage: 'planned', tags: ['x'] },
        draft: { stage: 'active', tags: '', sha: 'abc' },
      })
    ).toEqual({ op: 'patch', id: 'obj-1', set: { stage: 'active' }, unset: ['tags'] });
  });

  it('writes nothing when nothing changed', () => {
    expect(
      attributesWrite({ type: 'project', tenantId: 'p1', objectId: 'obj-1', fields, before: { stage: 'planned' }, draft: { stage: 'planned' } })
    ).toBeNull();
  });

  it('creates the tenant’s self object the first time, with its id and what the tenant says about itself', () => {
    expect(
      attributesWrite({
        type: 'project',
        tenantId: 'p1',
        objectId: null,
        fields,
        before: {},
        draft: { stage: 'active' },
        facts: { name: 'Apollo' },
      })
    ).toEqual({
      op: 'upsert',
      type: 'project',
      key: 'self',
      project_id: 'p1',
      value: { name: 'Apollo', stage: 'active', tenant_id: 'p1' },
    });
  });
});
