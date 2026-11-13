import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../api/types';
import { collapseRuns, countOf, recordedAt, rowsFor, searchText, shownKind } from './activity';

const check = (id: string, recorded: string | null = null, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id,
  kind: 'check',
  event: 'Document checked',
  subject: `doc-${id}.md`,
  by: 'leak',
  recorded,
  severity: null,
  ...extra,
});
const comment = (id: string): ActivityEvent => ({
  id,
  kind: 'comment',
  event: 'Commented',
  subject: 'README.md',
  by: 'ann',
  recorded: '2026-11-01T10:00:00Z',
});

describe('collapseRuns (the prototype activity-filter.ts)', () => {
  it('folds three or more of the same check in a row into one run row, dated by its newest', () => {
    const rows = collapseRuns([
      check('a', '2026-11-01T00:00:00Z'),
      check('b', '2026-11-03T00:00:00Z', { by: 'purpose' }),
      check('c', '2026-11-02T00:00:00Z', { severity: 'high' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'run:a',
      kind: 'check',
      event: 'Document checked',
      by: 'leak, purpose',
      recorded: '2026-11-03T00:00:00Z',
      severity: 'high',
    });
    expect(rows[0].items?.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps two of a kind as they are, and never folds comments', () => {
    expect(collapseRuns([check('a'), check('b')]).map((r) => r.id)).toEqual(['a', 'b']);
    expect(collapseRuns([comment('1'), comment('2'), comment('3')]).map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('names at most three authors of a run, then +N', () => {
    const run = collapseRuns(['a', 'b', 'c', 'd', 'e'].map((id) => check(id, null, { by: id })));
    expect(run[0].by).toBe('a, b, c +2');
  });

  it('keeps the feed order and breaks a run where another event comes between', () => {
    const rows = collapseRuns([check('a'), check('b'), comment('x'), check('c'), check('d'), check('e')]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'x', 'run:c']);
  });
});

describe('which events show', () => {
  const feed = [check('a'), comment('x')];

  it('opens on Comments when there are any, else on everything', () => {
    expect(shownKind(undefined, feed)).toBe('comment');
    expect(shownKind(undefined, [check('a')])).toBe('all');
    expect(shownKind('check', feed)).toBe('check');
    expect(shownKind('nonsense', feed)).toBe('comment');
  });

  it('counts each kind and narrows the rows to the chosen one', () => {
    expect(countOf(feed, 'comment')).toBe(1);
    expect(countOf(feed, 'check')).toBe(1);
    expect(rowsFor(feed, 'check').map((r) => r.id)).toEqual(['a']);
    expect(rowsFor(feed, 'all').map((r) => r.id)).toEqual(['a', 'x']);
  });

  it('searches every column and a run’s documents', () => {
    const [run] = collapseRuns([check('a'), check('b'), check('c')]);
    expect(searchText(run)).toContain('doc-b.md');
  });

  it('dates an undated row as the oldest', () => {
    expect(recordedAt({ recorded: null })).toBe(-Infinity);
    expect(recordedAt({ recorded: '2026-11-01T00:00:00Z' })).toBe(Date.parse('2026-11-01T00:00:00Z'));
  });
});
