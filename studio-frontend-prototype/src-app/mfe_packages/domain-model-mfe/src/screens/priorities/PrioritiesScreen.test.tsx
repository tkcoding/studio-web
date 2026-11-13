import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../i18n', async () => (await import('../common/testText')).i18nMock());

import type { SpecModelReview } from '../../model/review-state';
import type { SpecRequirement, SpecRequirements } from '../../model/spec-model';
import { PrioritiesScreen } from './PrioritiesScreen';

const req = (id: string, title: string, priority: string | null = null): SpecRequirement => ({
  id,
  defined_in: { path: 'docs/DESIGN.md' },
  title,
  text: title,
  kind: 'fr',
  priority,
  done: null,
  basis: 'stated',
  cites: [],
  because: null,
  work: 0,
});

const read: SpecRequirements = {
  items: [req('FR-1', 'Sign in'), req('FR-2', 'Dark mode'), req('FR-3', 'Export reports', 'p1')],
  total: 3,
  by_basis: {},
  synced: true,
};

const kept = (id: string, at: string, entry: object): SpecModelReview => ({
  fact_key: `pri:${id}`,
  state: 'scored',
  path: '',
  revision: '',
  note: JSON.stringify({ id, ...entry }),
  decided_by: 'u1',
  decided_at: at,
});

// Dark mode was added first, but Sign in scores higher: 9.33 against 2.67.
const reviews = [
  kept('FR-2', '2026-11-01T00:00:00Z', { impact: 3, confidence: 3, effort: '10' }),
  kept('FR-1', '2026-11-02T00:00:00Z', { impact: 9, confidence: 9, effort: '1' }),
];

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('PrioritiesScreen', () => {
  it('says it is loading, and shows a failure in its own words', () => {
    const { rerender } = render(<PrioritiesScreen read={null} projectId="p" reviews={[]} onTrace={() => {}} />);
    expect(screen.getByText('loading')).toBeTruthy();
    rerender(<PrioritiesScreen read={{ error: 'boom' }} projectId="p" reviews={[]} onTrace={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('boom');
  });

  it('orders the kept working set by ICE, highest first, and follows a requirement', () => {
    const onTrace = vi.fn();
    const { container } = render(<PrioritiesScreen read={read} projectId="p" reviews={reviews} onTrace={onTrace} />);
    const scores = [...container.querySelectorAll('[data-ice]')].map((n) => [n.getAttribute('data-ice'), n.textContent]);
    expect(scores).toEqual([
      ['FR-1', '9.33'],
      ['FR-2', '2.67'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onTrace).toHaveBeenCalledWith('FR-1');
  });

  it('leaves the score incomplete and names what it needs', () => {
    const { container } = render(
      <PrioritiesScreen read={read} projectId="p" reviews={[kept('FR-3', '2026-11-01T00:00:00Z', {})]} onTrace={() => {}} />
    );
    const ice = container.querySelector('[data-ice="FR-3"]')!;
    expect(ice.textContent).toContain('—');
    expect(ice.textContent).toContain('needs');
    // A stated requirement gives Confidence no number either: unknown, not 1.
    expect([...container.querySelectorAll('[data-origin]')].map((n) => n.getAttribute('data-origin'))).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
  });

  it('adds a requirement found by its title and keeps it with the project', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PrioritiesScreen read={read} projectId="p" reviews={[]} onSave={onSave} onTrace={() => {}} />);
    expect(screen.getByText('empty_title')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('add_label'), { target: { value: 'export' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export reports' }));
    expect(onSave).toHaveBeenCalledWith([
      { fact_key: 'pri:FR-3', state: 'scored', path: '', revision: '', note: JSON.stringify({ id: 'FR-3' }) },
    ]);
    await waitFor(() => expect(document.querySelector('[data-ice="FR-3"]')).toBeTruthy());
  });

  it('saves a typed Impact once typing pauses, and takes an item out', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PrioritiesScreen read={read} projectId="p" reviews={reviews} onSave={onSave} onTrace={() => {}} />);
    const field = screen.getByLabelText('criterion_of {"criterion":"criterion_impact","id":"FR-2"}');
    fireEvent.change(field, { target: { value: '7' } });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onSave.mock.calls[0][0][0].note)).toEqual({ id: 'FR-2', impact: 7, confidence: 3, effort: '10' });

    fireEvent.click(screen.getByRole('button', { name: 'remove: Dark mode' }));
    expect(onSave).toHaveBeenLastCalledWith([{ fact_key: 'pri:FR-2', state: 'proposed', path: '', revision: '' }]);
  });

  it('confirms the order as docs/priorities.md and records the confirmation', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue({ path: 'docs/priorities.md', branch: 'b', commit_sha: 'c', pr_url: 'https://x/pr/1' });
    render(
      <PrioritiesScreen read={read} projectId="p" reviews={reviews} onSave={onSave} onConfirm={onConfirm} onTrace={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await screen.findByRole('link', { name: 'as_pr' });
    const doc = onConfirm.mock.calls[0][0] as string;
    expect(doc).toContain('| 1 | Sign in `FR-1` | 9 (entered) | 9 (entered) | 10 (entered) | 9.33 |');
    expect(doc).toContain('| 2 | Dark mode `FR-2` |');
    const record = onSave.mock.calls[0][0][0];
    expect(record.state).toBe('confirmed');
    expect(JSON.parse(record.note).rows).toEqual([
      { id: 'FR-1', rank: 1, ice: '9.33' },
      { id: 'FR-2', rank: 2, ice: '2.67' },
    ]);
  });

  it('brings a comparison this browser kept into the project', async () => {
    localStorage.setItem('studio.priorities.p', JSON.stringify({ items: ['FR-3'], entries: { 'FR-3': { impact: 4 } } }));
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<PrioritiesScreen read={read} projectId="p" reviews={[]} onSave={onSave} onTrace={() => {}} />);
    const banner = container.querySelector('[data-priorities-legacy]') as HTMLElement;
    expect(banner.textContent).toContain('legacy_note {"count":1}');
    fireEvent.click(within(banner).getByRole('button', { name: 'legacy_bring' }));
    await waitFor(() => expect(container.querySelector('[data-priorities-legacy]')).toBeNull());
    expect(JSON.parse(onSave.mock.calls[0][0][0].note)).toEqual({ id: 'FR-3', impact: 4 });
    expect(localStorage.getItem('studio.priorities.p')).toBeNull();
  });
});
