import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FactReviewContext, type FactReview } from '../../model/review-state';
import type { SpecModelFact } from '../../model/spec-model';

vi.mock('../../i18n', async () => (await import('./testText')).i18nMock());

import { FactRow } from './facts';

const fact = (over: Partial<SpecModelFact> = {}): SpecModelFact => ({
  kind: 'attribute',
  subject: 'Invoice',
  aspect: 'retention',
  value: '30 days',
  text: 'An invoice is kept 30 days.',
  status: 'active',
  status_because: '',
  source: { path: 'docs/prd.md', line_start: 4, line_end: 4, quote: 'An invoice is kept 30 days' },
  ...over,
});

const review = (over: Partial<FactReview> = {}): FactReview => ({
  stateOf: () => undefined,
  rejectedOf: () => [],
  review: () => Promise.resolve(),
  ...over,
});

describe('FactRow', () => {
  it('shows where in the repository the passage was read', () => {
    render(<FactRow fact={fact({ source_commit: '4fbc8023aa11', source_ref: 'main' })} />);
    expect(screen.getByTestId('read-at').textContent).toBe('main @ 4fbc802');
  });

  it('marks an interpreted fact and a corrected one with the value read', () => {
    render(<FactRow fact={fact({ basis: 'interpreted', value: '90 days', extracted_value: '30 days' })} />);
    expect(screen.getByText('interpreted')).toBeTruthy();
    expect(screen.getByText('90 days')).toBeTruthy();
    expect(screen.getByText('corrected {"value":"30 days"}')).toBeTruthy();
  });

  it('says nothing more of a stated fact nobody corrected', () => {
    render(<FactRow fact={fact({ basis: 'stated' })} />);
    expect(screen.queryByText('interpreted')).toBeNull();
    expect(screen.queryByTestId('read-at')).toBeNull();
  });

  it('corrects a value through the review', async () => {
    const correct = vi.fn(() => Promise.resolve());
    render(
      <FactReviewContext.Provider value={review({ correct })}>
        <FactRow fact={fact()} />
      </FactReviewContext.Provider>
    );
    fireEvent.click(screen.getByTitle('correct_reading'));
    fireEvent.change(screen.getByLabelText('correct_value'), { target: { value: ' 90 days ' } });
    fireEvent.click(screen.getByText('correct_save'));
    expect(correct).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Invoice' }), '90 days');
    await Promise.resolve();
  });
});
