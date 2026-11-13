import { describe, expect, it } from 'vitest';
import { kindOf, modelOf, parsed } from './fields';
import {
  badgeOf,
  canSave,
  draftOf,
  extraFields,
  hasMilestone,
  isLate,
  milestoneFields,
  milestoneQuery,
  orderedFields,
  saveOperation,
  todayIndex,
  toneOf,
  type Milestone,
} from './timeline';

const MODEL = modelOf({
  ontology: {
    entities: [
      { id: 'system-object', bucket: 'system-primitives', properties: [{ name: 'tenant_id', type: 'string' }] },
      {
        id: 'managed-object',
        extends: 'system-object',
        properties: [
          { name: 'title', type: 'string' },
          { name: 'owner', type: 'person', extends: 'edge' },
        ],
      },
      {
        id: 'milestone',
        extends: 'managed-object',
        properties: [
          { name: 'id', type: 'string' },
          { name: 'status', type: 'planned | at_risk | achieved | missed | cancelled' },
          { name: 'target_at', type: 'timestamp' },
          { name: 'name', type: 'string', required: true },
          { name: 'weight', type: 'number' },
          { name: 'gate', type: 'boolean' },
        ],
      },
    ],
  },
});

const m = (value: Record<string, unknown>, id = 'm1'): Milestone => ({ id, value });

describe('the milestone type', () => {
  it('is there only when the installed model has it', () => {
    expect(hasMilestone(MODEL)).toBe(true);
    expect(hasMilestone(modelOf({ ontology: { entities: [{ id: 'project' }] } }))).toBe(false);
    expect(hasMilestone(null)).toBe(false);
    expect(milestoneFields(modelOf({ ontology: {} }))).toEqual([]);
  });

  it('offers its own and inherited fields, without bookkeeping, relations or the id', () => {
    expect(milestoneFields(MODEL).map((f) => f.name)).toEqual(['title', 'status', 'target_at', 'name', 'weight', 'gate']);
  });

  it('puts name, date and status first in the editor, and leaves the title to the name', () => {
    expect(orderedFields(milestoneFields(MODEL)).map((f) => f.name)).toEqual([
      'name',
      'target_at',
      'status',
      'weight',
      'gate',
    ]);
  });

  it('reads field kinds as the generator does', () => {
    expect(kindOf('planned | done')).toEqual({ kind: 'enum', values: ['planned', 'done'] });
    expect(kindOf('timestamp?')).toEqual({ kind: 'string' });
    expect(kindOf('integer')).toEqual({ kind: 'number' });
    expect(kindOf('string[]')).toEqual({ kind: 'list' });
  });
});

describe('a milestone on the axis', () => {
  const on = '2026-11-11';

  it('is late past its date while planned or at risk, not once achieved', () => {
    expect(isLate(m({ target_at: '2026-11-01T00:00:00Z' }), on)).toBe(true);
    expect(isLate(m({ target_at: '2026-11-01T00:00:00Z', status: 'at_risk' }), on)).toBe(true);
    expect(isLate(m({ target_at: '2026-11-01T00:00:00Z', status: 'achieved' }), on)).toBe(false);
    expect(isLate(m({ target_at: '2026-12-01T00:00:00Z' }), on)).toBe(false);
    expect(isLate(m({}), on)).toBe(false);
    expect(badgeOf(m({ target_at: '2026-11-01T00:00:00Z' }), on)).toBe('late');
    expect(badgeOf(m({ status: 'achieved' }), on)).toBe('achieved');
  });

  it('draws achieved green, at risk amber and late, missed or cancelled red', () => {
    expect(toneOf('achieved')).toBe('success');
    expect(toneOf('at_risk')).toBe('warning');
    expect(['late', 'missed', 'cancelled'].map(toneOf)).toEqual(['danger', 'danger', 'danger']);
    expect(toneOf('planned')).toBe('secondary');
  });

  it('puts today before the first milestone on or after it, else at the end', () => {
    const items = [m({ target_at: '2026-10-01' }, 'a'), m({ target_at: '2026-11-11' }, 'b'), m({ target_at: '2027-01-01' }, 'c')];
    expect(todayIndex(items, on)).toBe(1);
    expect(todayIndex(items.slice(0, 1), on)).toBe(1);
    expect(todayIndex([], on)).toBe(0);
  });

  it('shows beside its name only the other fields it has a value for', () => {
    const fields = milestoneFields(MODEL);
    expect(extraFields(fields, m({ name: 'Beta', weight: 3, gate: '' })).map((f) => f.name)).toEqual(['weight']);
  });
});

describe('reading and saving', () => {
  it('reads the project’s milestones by date then name, counted by status, in one query', () => {
    expect(milestoneQuery('p1')).toEqual({
      type: 'milestone',
      project_id: 'p1',
      order_by: [{ field: 'target_at' }, { field: 'name' }],
      limit: 200,
      aggregate: { group_by: ['status'] },
    });
  });

  const fields = orderedFields(milestoneFields(MODEL));

  it('needs a name and a date', () => {
    expect(canSave({ name: ' ', target_at: '2026-12-01' })).toBe(false);
    expect(canSave({ name: 'Beta', target_at: '' })).toBe(false);
    expect(canSave({ name: 'Beta', target_at: '2026-12-01' })).toBe(true);
  });

  it('creates a planned milestone in the project, its title its name', () => {
    const draft = { ...draftOf(fields, null), name: 'Beta', target_at: '2026-12-01', weight: '3' };
    expect(saveOperation(fields, draft, null, 'p1', 'k1')).toEqual({
      op: 'upsert',
      type: 'milestone',
      key: 'k1',
      project_id: 'p1',
      value: { name: 'Beta', target_at: '2026-12-01T00:00:00Z', weight: 3, gate: false, title: 'Beta', status: 'planned', tenant_id: 'p1' },
    });
  });

  it('patches an existing one, unsetting what was cleared', () => {
    const existing = m({ name: 'Beta', target_at: '2026-12-01T00:00:00Z', status: 'at_risk', weight: 3 });
    const draft = draftOf(fields, existing);
    expect(draft).toMatchObject({ name: 'Beta', target_at: '2026-12-01', status: 'at_risk', weight: '3', gate: false });
    const op = saveOperation(fields, { ...draft, weight: '', status: 'achieved' }, existing, 'p1', 'unused');
    expect(op).toEqual({
      op: 'patch',
      id: 'm1',
      set: { name: 'Beta', target_at: '2026-12-01T00:00:00Z', status: 'achieved', gate: false, title: 'Beta' },
      unset: ['weight'],
    });
  });

  it('turns an input back into the value its kind stores', () => {
    const [weight] = fields.filter((f) => f.name === 'weight');
    expect(parsed(weight, '4')).toBe(4);
    expect(parsed(weight, '')).toBeNull();
  });
});
