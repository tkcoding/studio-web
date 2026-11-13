import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetList, BudgetStatus, CostReport, PriceList } from '../../api/types';

const { service, org, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as unknown[],
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key}_${count === 1 ? 'one' : 'many'} ${count}`;
  return { useCostsTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useApiQuery: () => ({ data: { subject_id: 'me' } }),
}));

import { CostsScreen } from './CostsScreen';

const answer = (value: unknown) => (params?: unknown) => {
  calls.push(params);
  return { fetch: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)) };
};

const prices = (patch: Partial<PriceList> = {}): PriceList => ({
  currency: 'USD',
  models: [
    {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5*',
      input_per_mtok: 3,
      output_per_mtok: 15,
      cache_read_per_mtok: 0.3,
      cache_write_per_mtok: 3.75,
    },
  ],
  session: null,
  may_manage: true,
  may_view_costs: true,
  ...patch,
});

const report: CostReport = {
  currency: 'USD',
  from: '2026-11-01T00:00:00Z',
  to: '2026-12-01T00:00:00Z',
  group_by: 'person',
  include_personal: true,
  total: 12.5,
  rows: [
    {
      key: 'me',
      input_tokens: 3200,
      output_tokens: 950,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      session_seconds: 5400,
      cost: 12.5,
      unpriced: true,
    },
  ],
  unpriced: ['openai/gpt-x'],
};

const budgets = (patch: Partial<BudgetList> = {}): BudgetList => ({
  currency: 'USD',
  warn_at_percent: 80,
  budgets: [{ tenant_id: null, monthly: 100 }],
  places: [{ id: 'o1', label: 'Acme', kind: 'organization' }],
  may_manage: true,
  ...patch,
});

const status: BudgetStatus = {
  currency: 'USD',
  warn_at_percent: 80,
  from: '',
  to: '',
  measured_at: '',
  include_personal: true,
  standings: [
    { tenant_id: null, label: 'Acme', monthly: 100, spent: 120, forecast: null, level: 'over', by_forecast: false },
  ],
  unpriced: [],
};

function serve(over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    prices: answer(prices()),
    costs: answer(report),
    budgets: answer(budgets()),
    budgetStatus: answer(status),
    updatePrices: () => ({ fetch: (body: unknown) => (calls.push(body), Promise.resolve(prices())) }),
    updateBudgets: () => ({ fetch: () => Promise.resolve(budgets()) }),
    getMe: {},
    ...over,
  });
}

describe('CostsScreen', () => {
  beforeEach(() => {
    calls.length = 0;
    org.value = { id: 'o1', name: 'Acme' };
    serve();
  });

  it('asks for an organization when none is in scope', () => {
    org.value = null;
    render(<CostsScreen />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it("reports this month's costs, naming the caller's own row and what had no price", async () => {
    const { container } = render(<CostsScreen />);
    await waitFor(() => expect(container.querySelector('[data-cost-row="me"]')).not.toBeNull());
    expect(container.querySelector('[data-cost-row="me"]')?.textContent).toContain('You');
    expect(container.querySelector('[data-cost-total]')?.textContent).toBe('$12.50');
    expect(container.querySelector('[data-cost-unpriced]')?.textContent).toContain('openai/gpt-x');
    expect(container.querySelector('[data-costs-budgets]')).not.toBeNull();
    // The report is asked with people's own keys and grouped by project to start with.
    expect(calls).toContainEqual(expect.objectContaining({ organizationId: 'o1', groupBy: 'project', includePersonal: true }));
  });

  it('warns about a budget in the header and opens the budgets on it', async () => {
    const { container } = render(<CostsScreen />);
    const chip = await waitFor(() => {
      const found = container.querySelector('[data-costs-budget-alerts]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(chip.textContent).toContain('budget_alerts_one 1');
    fireEvent.click(chip);
    await waitFor(() => expect(document.querySelector('[data-budget-warnings]')).not.toBeNull());
    expect(document.querySelector('[data-budget-warning="over"]')?.textContent).toContain(
      'Over budget: $120.00 of $100.00 spent.'
    );
  });

  it('shows only the price list, read-only, to whoever may not see the costs', async () => {
    serve({ prices: answer(prices({ may_view_costs: false, may_manage: false })) });
    const { container } = render(<CostsScreen />);
    await waitFor(() => expect(container.querySelector('[data-price-list]')).not.toBeNull());
    expect(screen.getByText('administrators_only')).toBeTruthy();
    expect(screen.getByText('prices_manage_only')).toBeTruthy();
    expect(container.querySelector('[data-cost-report]')).toBeNull();
    expect(container.querySelector('[data-costs-budgets]')).toBeNull();
    expect(container.querySelector('[data-price-save]')).toBeNull();
  });

  it('says nothing is priced rather than reporting $0', async () => {
    serve({ prices: answer(prices({ models: [], session: null })) });
    const { container } = render(<CostsScreen />);
    await waitFor(() => expect(container.querySelector('[data-costs-empty-prices]')).not.toBeNull());
    expect(container.querySelector('[data-costs-no-prices]')).not.toBeNull();
    expect(container.querySelector('[data-costs-total]')).toBeNull();
    fireEvent.click(container.querySelector('[data-costs-set-prices]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-price-list]')).not.toBeNull());
    expect(container.querySelector('[data-price-empty]')).not.toBeNull();
  });

  it('refuses to save a price list the backend would refuse, and saves a good one', async () => {
    serve({ prices: answer(prices({ may_view_costs: false })) });
    const { container } = render(<CostsScreen />);
    await waitFor(() => expect(container.querySelector('[data-price-add]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-price-add]') as HTMLElement);
    expect(container.querySelector('[data-price-problem]')?.textContent).toMatch(/names a provider and a model/);
    fireEvent.click(screen.getAllByText('remove')[1]);
    expect(container.querySelector('[data-price-problem]')).toBeNull();
    fireEvent.click(container.querySelector('[data-price-save]') as HTMLElement);
    await waitFor(() => expect(screen.getByText('prices_saved')).toBeTruthy());
    expect(calls).toContainEqual(expect.objectContaining({ currency: 'USD', session: null }));
  });

  it('says when the backend predates costs', async () => {
    serve({ prices: answer(Object.assign(new Error('nope'), { response: { status: 404 } })) });
    render(<CostsScreen />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('not_counted'));
  });
});
