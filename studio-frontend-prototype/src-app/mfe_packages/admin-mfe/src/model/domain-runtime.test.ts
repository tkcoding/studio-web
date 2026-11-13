// The prototype had no test for domain-runtime.ts; these pin the part moved here.
import { describe, expect, it } from 'vitest';
import { ancestorsOf, fieldsOfModel, kindOf, modelOf } from './domain-runtime';

const model = modelOf({
  ontology: {
    entities: [
      { id: 'entity', properties: [{ name: 'id', type: 'EntityId' }, { name: 'title', type: 'string' }] },
      {
        id: 'project',
        extends: 'entity',
        meta: { origin: 'studio' },
        properties: [
          { name: 'title', type: 'string', required: true, description: 'What it is called' },
          { name: 'stage', type: 'planned | active' },
          { name: 'repo', type: 'Repository', extends: 'edge' },
          { name: 'sha', type: 'string', held_by: 'studio-artifact-ingest' },
        ],
      },
      { id: 'loop-a', extends: 'loop-b' },
      { id: 'loop-b', extends: 'loop-a' },
    ],
  },
  can_edit_model: false,
  gts: { types: { project: { type: 'gts.x', stored_as: 'gts.y' } }, relations: {} },
});

describe('modelOf', () => {
  it('reads the types answer: Studio types, buckets, who may edit, the GTS ids', () => {
    expect(model.source).toBe('server');
    expect(model.canEdit).toBe(false);
    expect([...model.studioTypes]).toEqual(['project']);
    expect(model.gts.types.project.type).toBe('gts.x');
    expect(modelOf({ ontology: {}, can_edit_model: true }).gts).toEqual({ types: {}, relations: {} });
  });
});

describe('fieldsOfModel', () => {
  it('reads own and inherited fields, root first, the nearest declaration winning, relations left out', () => {
    expect(fieldsOfModel(model, 'project').map((f) => [f.name, f.declaredBy, f.required])).toEqual([
      ['id', 'entity', false],
      ['title', 'project', true],
      ['stage', 'project', false],
      ['sha', 'project', false],
    ]);
    expect(fieldsOfModel(model, 'project').find((f) => f.name === 'sha')?.heldBy).toBe('studio-artifact-ingest');
  });

  it('stops on a cycle of bases', () => {
    expect(ancestorsOf(model, 'loop-a')).toEqual(['loop-a', 'loop-b']);
  });
});

describe('kindOf', () => {
  it('reads a type expression as the generator does', () => {
    expect(kindOf('planned | active')).toEqual({ kind: 'enum', values: ['planned', 'active'] });
    expect(kindOf('string[]')).toEqual({ kind: 'list' });
    expect(kindOf('decimal?')).toEqual({ kind: 'number' });
    expect(kindOf('bool')).toEqual({ kind: 'boolean' });
    expect(kindOf('EntityId')).toEqual({ kind: 'string' });
    expect(kindOf('Mystery')).toEqual({ kind: 'unknown' });
  });
});
