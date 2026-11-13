import { describe, expect, it } from 'vitest';
import {
  basesOf,
  countByKit,
  countByOrigin,
  fieldEdit,
  groupTypes,
  slug,
  typeLabel,
  validFieldName,
  validTypeId,
} from './domain-admin';
import { modelOf, type ModelEntity } from './domain-runtime';

const entities: ModelEntity[] = [
  { id: 'node', abstract: true, bucket: 'system-primitives', meta: { origin: 'studio' } },
  { id: 'project', name: 'Project', extends: 'node', bucket: 'identity', meta: { origin: 'studio' } },
  { id: 'milestone', name: 'Milestone', extends: 'node', bucket: 'planning', meta: { origin: 'kit', kit: 'project-lifecycle' } },
  { id: 'risk', name: 'Risk', extends: 'node', bucket: 'planning', meta: { origin: 'kit', kit: 'project-lifecycle' } },
  { id: 'report', name: 'Report', bucket: 'governance', meta: { origin: 'kit', kit: 'org-reports' } },
  { id: 'cost-centre', name: 'Cost centre', meta: { origin: 'organization' } },
];

const model = modelOf({
  ontology: { entities, buckets: [{ id: 'planning', name: 'Planning' }, { id: 'identity' }] },
  can_edit_model: true,
});

describe('groupTypes', () => {
  it('groups by bucket name, unnamed buckets by id, none as Other, each list by name', () => {
    const groups = groupTypes(model, '', 'all');
    expect(groups.map(([b, list]) => [b, list.map((r) => r.id)])).toEqual([
      ['governance', ['report']],
      ['identity', ['project']],
      ['Other', ['cost-centre']],
      ['Planning', ['milestone', 'risk']],
      ['system-primitives', ['node']],
    ]);
    expect(groups.find(([b]) => b === 'system-primitives')?.[1][0]).toMatchObject({ abstract: true, origin: 'studio' });
  });

  it('narrows by search, origin and one kit', () => {
    expect(groupTypes(model, 'mile', 'all').flatMap(([, l]) => l.map((r) => r.id))).toEqual(['milestone']);
    expect(groupTypes(model, '', 'kit').flatMap(([, l]) => l.map((r) => r.id))).toEqual(['report', 'milestone', 'risk']);
    expect(groupTypes(model, '', 'kit', 'org-reports').flatMap(([, l]) => l.map((r) => r.id))).toEqual(['report']);
    expect(groupTypes(model, '', 'organization').flatMap(([, l]) => l.map((r) => r.id))).toEqual(['cost-centre']);
  });
});

describe('counts', () => {
  it('counts the types of each origin and of each kit', () => {
    expect(Object.fromEntries(countByOrigin(model))).toEqual({ studio: 2, kit: 3, organization: 1 });
    expect(countByKit(model)).toEqual([
      ['org-reports', 1],
      ['project-lifecycle', 2],
    ]);
  });
});

describe('the field and type forms', () => {
  it('names the common kinds, lists choices, and shows any other expression as written', () => {
    expect(typeLabel('timestamp?')).toEqual({ key: 'dm_kind_timestamp' });
    expect(typeLabel('low | high')).toEqual({ choices: ['low', 'high'] });
    expect(typeLabel('EntityId')).toEqual({ raw: 'EntityId' });
    expect(typeLabel('')).toEqual({ raw: '—' });
  });

  it('takes the names the server takes', () => {
    expect(validFieldName('cost_center')).toBe(true);
    expect(validFieldName('Cost')).toBe(false);
    expect(validTypeId('cost-centre')).toBe(true);
    expect(validTypeId('cost-')).toBe(false);
    expect(slug('  Cost Centre! ')).toBe('cost-centre');
  });

  it('sends only what changed', () => {
    const f = { name: 'a', type: 'string', required: false, description: '' };
    expect(fieldEdit(f, { ...f, name: 'b', required: true })).toEqual({ rename_to: 'b', required: true });
    expect(fieldEdit(f, f)).toEqual({});
  });

  it('reads the bases of a type', () => {
    expect(basesOf(model, 'milestone')).toEqual(['node']);
  });
});
