/**
 * Project › Timeline's rules, out of the prototype's `project-timeline.tsx`
 * (studio-frontend-poc/): milestones are `milestone` objects of the Studio
 * domain model in the project's scope (ADR-0066), so a field an administrator
 * adds to `milestone` is a field here at once. The type is project-lifecycle's
 * (ADR-0070 §7); where it is not installed there is no Timeline.
 */

import type { DomainObject, DomainQuery } from '../api/types';
import { SYSTEM_BUCKET, asInput, fieldsOfModel, parsed, type DomainModel, type ModelField } from './fields';

export const MILESTONE = 'milestone';

/** As many as one query answers; the prototype read the same. */
export const MILESTONE_LIMIT = 200;

export type Milestone = Pick<DomainObject, 'id' | 'value'>;

/** The statuses still to come: one of them past its date is late. */
const OPEN = new Set(['planned', 'at_risk']);

/** The fields people fill first, in this order; then whatever else the model has. */
export const FIRST_FIELDS = ['name', 'target_at', 'status'] as const;

/** The day a timestamp falls on, `YYYY-MM-DD`, or "" when there is none. */
export function day(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 10) : '';
}

/** Today as `YYYY-MM-DD`, in UTC like the stored dates. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function statusOf(m: Milestone): string {
  const s = m.value.status;
  return typeof s === 'string' && s ? s : 'planned';
}

/** Past its date and still planned or at risk. */
export function isLate(m: Milestone, on: string): boolean {
  const date = day(m.value.target_at);
  return !!date && date < on && OPEN.has(statusOf(m));
}

/** What a milestone's badge says: `late`, or its status. */
export function badgeOf(m: Milestone, on: string): string {
  return isLate(m, on) ? 'late' : statusOf(m);
}

/** A badge as a Badge variant: achieved green, at risk amber, late/missed/cancelled red. */
export function toneOf(badge: string): 'success' | 'warning' | 'danger' | 'secondary' {
  switch (badge) {
    case 'achieved':
      return 'success';
    case 'at_risk':
      return 'warning';
    case 'late':
    case 'missed':
    case 'cancelled':
      return 'danger';
    default:
      return 'secondary';
  }
}

/** Where the "today" line goes: before the first milestone on or after today;
 *  `items.length` when every one is before it. */
export function todayIndex(items: readonly Milestone[], on: string): number {
  const at = items.findIndex((m) => day(m.value.target_at) >= on);
  return at === -1 ? items.length : at;
}

/** Whether the installed model has the type. */
export function hasMilestone(model: DomainModel | null): boolean {
  return !!model?.byId.has(MILESTONE);
}

/** The milestone's fields a person sees and fills: not the meta-model's
 *  bookkeeping, not the id. */
export function milestoneFields(model: DomainModel | null): ModelField[] {
  if (!model || !hasMilestone(model)) return [];
  const system = new Set(model.entities.filter((e) => e.bucket === SYSTEM_BUCKET).map((e) => e.id));
  return fieldsOfModel(model, MILESTONE).filter((f) => !system.has(f.declaredBy) && f.name !== 'id');
}

/** The fields a row shows beside its name, date and status: the ones it has a value for. */
export function extraFields(fields: readonly ModelField[], m: Milestone): ModelField[] {
  return fields
    .filter((f) => !['name', 'title', 'target_at', 'status'].includes(f.name))
    .filter((f) => m.value[f.name] !== undefined && m.value[f.name] !== null && m.value[f.name] !== '');
}

/** The editor's fields: name, date and status first, then the rest; `title` is the name. */
export function orderedFields(fields: readonly ModelField[]): ModelField[] {
  const first = FIRST_FIELDS.map((n) => fields.find((f) => f.name === n)).filter((f): f is ModelField => !!f);
  return [...first, ...fields.filter((f) => !(FIRST_FIELDS as readonly string[]).includes(f.name) && f.name !== 'title')];
}

/** One read: the project's milestones by date then name, counted by status. */
export function milestoneQuery(projectId: string): DomainQuery {
  return {
    type: MILESTONE,
    project_id: projectId,
    order_by: [{ field: 'target_at' }, { field: 'name' }],
    limit: MILESTONE_LIMIT,
    aggregate: { group_by: ['status'] },
  };
}

export type Draft = Record<string, string | boolean>;

/** What the editor starts from: the milestone's values, or empty ones. */
export function draftOf(fields: readonly ModelField[], milestone: Milestone | null): Draft {
  return Object.fromEntries(
    fields.map((f) => {
      const v = milestone?.value[f.name];
      if (f.kind.kind === 'boolean') return [f.name, v === true];
      return [f.name, f.name === 'target_at' ? day(v) : asInput(v)];
    })
  );
}

/** A name and a date are enough. */
export function canSave(draft: Draft): boolean {
  return String(draft.name ?? '').trim() !== '' && String(draft.target_at ?? '') !== '';
}

/**
 * The one operation that saves the editor: a `patch` of the milestone
 * (setting what has a value, unsetting what was cleared), or an `upsert` of a
 * new one under `key` in the project's scope, `planned` unless chosen. A
 * milestone's title is its name: `managed-object` asks for one.
 */
export function saveOperation(
  fields: readonly ModelField[],
  draft: Draft,
  milestone: Milestone | null,
  projectId: string,
  key: string
): Record<string, unknown> {
  const name = String(draft.name ?? '').trim();
  const date = String(draft.target_at ?? '');
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const v = f.name === 'target_at' ? (date ? `${date}T00:00:00Z` : null) : parsed(f, draft[f.name] ?? '');
    if (v !== null) values[f.name] = v;
  }
  values.title = name;
  if (milestone) {
    const unset = fields.map((f) => f.name).filter((n) => !(n in values) && milestone.value[n] !== undefined);
    return { op: 'patch', id: milestone.id, set: values, unset };
  }
  return {
    op: 'upsert',
    type: MILESTONE,
    key,
    project_id: projectId,
    value: { ...values, status: values.status ?? 'planned', tenant_id: projectId },
  };
}

/** A new milestone's stable key. */
export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
}
