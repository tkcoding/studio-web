import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SpecRequirement, SpecRequirements } from '../../model/spec-model';

vi.mock('../../i18n', async () => (await import('../common/testText')).i18nMock());

import { RequirementsView } from './RequirementsView';

const req = (over: Partial<SpecRequirement>): SpecRequirement => ({
  id: 'cpt-fr-order',
  defined_in: { path: 'docs/PRD.md', line_start: 10, line_end: 12, quote: 'The system places an order.' },
  title: 'Place an order',
  text: 'The system places an order.',
  kind: 'fr',
  priority: 'p1',
  done: null,
  basis: 'stated',
  cites: [],
  because: null,
  work: 0,
  ...over,
});

const read = (items: SpecRequirement[]): SpecRequirements => ({ items, total: items.length, by_basis: {}, synced: true });

describe('RequirementsView', () => {
  it('says loading, then why it could not read', () => {
    const { rerender } = render(
      <RequirementsView read={null} traces={null} work={null} selected={null} onSelect={() => undefined} onOpenFile={undefined} />
    );
    expect(screen.getByText('loading')).toBeTruthy();
    rerender(
      <RequirementsView
        read={{ error: 'no checkout' }}
        traces={null}
        work={null}
        selected={null}
        onSelect={() => undefined}
        onOpenFile={undefined}
      />
    );
    expect(screen.getByRole('alert').textContent).toBe('no checkout');
  });

  it('lists requirements and follows the picked one to the code', () => {
    const onSelect = vi.fn();
    const items = [req({}), req({ id: 'cpt-fr-pay', title: 'Pay for it' })];
    const traces = {
      items: [
        {
          id: 'cpt-fr-order',
          defined_in: items[0].defined_in,
          documents: [],
          code: [{ path: 'src/order.rs', line_start: 4, line_end: 4, quote: 'cpt-fr-order' }],
          tests: [],
        },
      ],
      total: 1,
    } as never;
    const { rerender } = render(
      <RequirementsView read={read(items)} traces={traces} work={null} selected={null} onSelect={onSelect} onOpenFile={undefined} />
    );
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByText('Pay for it'));
    expect(onSelect).toHaveBeenCalledWith('cpt-fr-pay');
    expect(screen.getByText('trace_title')).toBeTruthy();

    rerender(
      <RequirementsView
        read={read(items)}
        traces={traces}
        work={null}
        selected="cpt-fr-order"
        onSelect={onSelect}
        onOpenFile={undefined}
      />
    );
    const chain = screen.getByRole('complementary');
    expect(within(chain).getByText('passage_to_code')).toBeTruthy();
    expect(within(chain).getByText(/src\/order\.rs/)).toBeTruthy();
  });
});
