import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecModel, SpecModelFact } from '../../model/spec-model';
import { factKey } from '../../model/review-state';

vi.mock('../../i18n', async () => (await import('../common/testText')).i18nMock());

const { dmApi, openScreen } = vi.hoisted(() => ({
  dmApi: {} as Record<string, ReturnType<typeof vi.fn>>,
  openScreen: vi.fn(),
}));
vi.mock('../../api/client', () => ({ dmApi }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  openScreen,
}));

import { ScopeContext, type Scope } from '../common/ui';
import { DomainModelScreen } from './DomainModelScreen';

const side = { path: 'docs/prd.md', line_start: 3, line_end: 3, quote: 'An Order belongs to a Customer.' };

function fact(over: Partial<SpecModelFact>): SpecModelFact {
  return {
    kind: 'entity',
    subject: 'Order',
    aspect: '',
    value: '',
    text: 'An order a customer places.',
    status: 'active',
    status_because: '',
    layer: 'domain',
    source: side,
    ...over,
  };
}

const definition = fact({});
const relation = fact({ kind: 'relation', aspect: 'belongs to', value: 'Customer', text: 'An Order belongs to a Customer.' });
const customer = fact({ subject: 'Customer', text: 'Who buys.', source: { ...side, line_start: 5, quote: 'A Customer buys.' } });
const attribute = fact({ kind: 'attribute', aspect: 'total', value: 'money', text: 'The order total.' });

function model(over: Partial<SpecModel> = {}): SpecModel {
  return {
    build: { running: false, documents: 1, done: 1, candidates: 0, judged: 0, finished_at: '2026-11-10T09:00:00Z' },
    documents: [{ path: 'docs/prd.md', revision: 'r1', state: 'extracted', facts: 4, dropped: 0 }],
    facts: [definition, relation, customer, attribute],
    ...over,
  };
}

const scope = (): Scope => ({
  projectId: 'p1',
  workspaceId: 'w1',
  orgId: 'o1',
  language: 'en',
  bridge: {} as Scope['bridge'],
  container: { current: null },
});

function renderScreen() {
  return render(
    <ScopeContext.Provider value={scope()}>
      <DomainModelScreen />
    </ScopeContext.Provider>
  );
}

describe('DomainModelScreen', () => {
  beforeEach(() => {
    Object.assign(dmApi, {
      specModel: vi.fn().mockResolvedValue(model()),
      specModelUploads: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      specModelReviews: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      glossary: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      productFindings: vi.fn().mockResolvedValue({ repo: null, items: [], total: 0 }),
      workLinks: vi.fn().mockResolvedValue({ items: [], total: 0, identifiers: 0, unlinked: 0, work: 0, synced: false }),
      specRequirements: vi.fn().mockResolvedValue({ items: [], total: 0, by_basis: {}, synced: true }),
      projectPlan: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      gearboxCatalogue: vi.fn().mockRejectedValue(new Error('no engine')),
      specModelBuildEstimate: vi.fn().mockResolvedValue({ documents: 2, input_tokens: 12000, seconds: 40, measured: false }),
      startSpecModelBuild: vi.fn().mockResolvedValue({ running: true }),
      reviewSpecModelFacts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      saveSpecModelEntity: vi.fn().mockResolvedValue({ path: 'docs/domain-model.md', branch: 'studio/x', commit_sha: 'abc' }),
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('opens on the entities of the Domain layer, read from the documents', async () => {
    renderScreen();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Order')).toBeTruthy();
    expect(within(table).getByText('Customer')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /tab_entities/ }).getAttribute('aria-selected')).toBe('true');
    expect(dmApi.specModel).toHaveBeenCalledWith('p1');
  });

  it('builds on the viewer key with the estimate on the button', async () => {
    renderScreen();
    const button = await screen.findByRole('button', { name: /build_estimate/ });
    fireEvent.click(button);
    await waitFor(() => expect(dmApi.startSpecModelBuild).toHaveBeenCalledWith('p1', undefined));
  });

  it('opens an entity, accepts a reading under its key, and saves an edit', async () => {
    renderScreen();
    fireEvent.click(within(await screen.findByRole('table')).getByText('Order'));
    const panel = await screen.findByRole('complementary', { name: 'selected_entity' });
    expect(within(panel).getByText('An order a customer places.')).toBeTruthy();
    fireEvent.click(within(panel).getAllByTitle('accept_reading')[0]);
    await waitFor(() => expect(dmApi.reviewSpecModelFacts).toHaveBeenCalled());
    const [, items] = dmApi.reviewSpecModelFacts.mock.calls[0];
    expect(items[0]).toMatchObject({ fact_key: factKey(attribute), state: 'accepted', revision: 'r1' });

    fireEvent.click(within(panel).getByRole('button', { name: 'edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'save_to_docs' }));
    await waitFor(() => expect(dmApi.saveSpecModelEntity).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Order' })));
  });

  it('prefers the server fact key when a fact carries one', async () => {
    dmApi.specModel.mockResolvedValue(model({ facts: [definition, { ...attribute, fact_key: 'server-key' } as SpecModelFact] }));
    renderScreen();
    fireEvent.click(within(await screen.findByRole('table')).getByText('Order'));
    const panel = await screen.findByRole('complementary', { name: 'selected_entity' });
    fireEvent.click(within(panel).getAllByTitle('accept_reading')[0]);
    await waitFor(() => expect(dmApi.reviewSpecModelFacts).toHaveBeenCalled());
    expect(dmApi.reviewSpecModelFacts.mock.calls[0][1][0].fact_key).toBe('server-key');
  });

  it('says why a model cannot be read', async () => {
    dmApi.specModel.mockRejectedValue(new Error('the documents gear is down'));
    renderScreen();
    expect((await screen.findByRole('alert')).textContent).toContain('the documents gear is down');
  });

  it('lists the documents under Sources and rebuilds from one', async () => {
    renderScreen();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('tab', { name: /tab_sources/ }));
    expect(await screen.findByText('docs/prd.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rebuild_from: docs/prd.md' }));
    await waitFor(() => expect(dmApi.startSpecModelBuild).toHaveBeenCalledWith('p1', 'docs/prd.md'));
  });

  it('shows the empty map before anything is read', async () => {
    dmApi.specModel.mockResolvedValue(model({ facts: [] }));
    renderScreen();
    expect(await screen.findByText('nothing_read')).toBeTruthy();
  });
});
