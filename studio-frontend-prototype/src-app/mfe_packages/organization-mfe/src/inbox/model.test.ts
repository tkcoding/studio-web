import { describe, expect, it } from 'vitest';
import { badgeVariant, pullOf, reviewOf, snoozeUntil } from './model';
import type { InboxItem } from './types';

const item = (source: string, record: Record<string, unknown>): InboxItem => ({
  key: 'k',
  source,
  workspace_id: 'w1',
  workspace_name: 'Main',
  title: 't',
  url: null,
  due_at: null,
  overdue: false,
  record,
});

describe('inbox model', () => {
  it('tells a review row from a pull request row by its source', () => {
    expect(reviewOf(item('review-requests', { id: 'r1', title: 'Spec' }))?.id).toBe('r1');
    expect(reviewOf(item('pull-requests', { id: 'p1' }))).toBeNull();
    expect(pullOf(item('pull-requests', { id: 'p1', waiting: 'review' }))?.id).toBe('p1');
    expect(pullOf(item('review-requests', { id: 'r1' }))).toBeNull();
  });

  it('does not read a pull request without its waiting state as one', () => {
    expect(pullOf(item('pull-requests', { id: 'p1' }))).toBeNull();
  });

  it('ends a snooze a day later', () => {
    expect(snoozeUntil(new Date('2026-11-10T08:00:00Z'), 1)).toBe('2026-11-11T08:00:00.000Z');
  });

  it('maps the prototype tones to badge variants', () => {
    expect(badgeVariant('danger')).toBe('danger');
    expect(badgeVariant('warn')).toBe('warning');
    expect(badgeVariant('ok')).toBe('success');
    expect(badgeVariant('info')).toBe('info');
    expect(badgeVariant('neutral')).toBe('secondary');
  });
});
