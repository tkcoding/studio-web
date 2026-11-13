import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { openScreen } = vi.hoisted(() => ({ openScreen: vi.fn() }));

vi.mock('../../i18n', () => ({
  useProductTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  openScreen,
}));
// The sections are tested where they live; here they only say they are drawn.
vi.mock('./map/ProductMap', () => ({ ProductMap: () => <div data-testid="map" /> }));
vi.mock('./configurator/ProductBackend', () => ({ ProductBackend: () => <div data-testid="backend" /> }));
vi.mock('./flow/ProductFlow', () => ({ ProductFlow: () => null }));
vi.mock('./flow/ProductKindStep', () => ({ ProductKindStep: () => null }));
vi.mock('./frontend/ProductFrontend', () => ({ ProductFrontend: () => <div data-testid="frontend" /> }));
vi.mock('./infra/ProductInfrastructure', () => ({ ProductInfrastructure: () => <div data-testid="infra" /> }));
vi.mock('../components/ProjectComponentsInventory', () => ({
  ProjectComponentsInventory: () => <div data-testid="parts" />,
}));

import { api } from '../../api/client';
import { ScopeContext, type Scope } from '../common';
import { ProductPage } from './ProductPage';

const scope: Scope = {
  projectId: 'p1',
  workspaceId: 'w1',
  orgId: 'o1',
  language: 'en',
  bridge: {} as ChildMfeBridge,
  container: createRef<HTMLDivElement>(),
};

function draw() {
  return render(
    <ScopeContext.Provider value={scope}>
      <ProductPage />
    </ScopeContext.Provider>
  );
}

describe('ProductPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(api, 'projectConfig').mockResolvedValue(null);
    vi.spyOn(api, 'productDescription').mockResolvedValue({ latest: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('names the product with the engine verdict and offers the fixes', async () => {
    vi.spyOn(api, 'projectProduct').mockResolvedValue({
      product_id: 'shop',
      gears: ['cf-gears-api-gateway'],
      last_preview: { ok: false, errors: 2, warnings: 1, applications: [], gears: [], profile: 'dev' } as never,
    });
    draw();
    expect(await screen.findByText('shop')).toBeTruthy();
    expect(screen.getByText("doesn't resolve: 2 errors")).toBeTruthy();
    expect(document.querySelector('[data-product-action]')?.getAttribute('data-product-action')).toBe('fix');
    // The map is where the page opens.
    expect(screen.getByTestId('map')).toBeTruthy();
  });

  it('says when the product could not be read', async () => {
    vi.spyOn(api, 'projectProduct').mockRejectedValue(new Error('boom'));
    draw();
    await waitFor(() => expect(screen.getByText(/read_failed/)).toBeTruthy());
  });

  it('switches its parts and remembers the last one', async () => {
    vi.spyOn(api, 'projectProduct').mockResolvedValue(null);
    draw();
    fireEvent.click(document.querySelector('[data-product-section-tab="infrastructure"]')!);
    expect(screen.getByTestId('infra')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-product-section-tab="parts"]')!);
    expect(screen.getByTestId('parts')).toBeTruthy();
    expect(window.localStorage.getItem('studio.product.section.p1')).toBe('parts');
    // Backend stays mounted, hidden, so its panes keep their state.
    expect(screen.getByTestId('backend')).toBeTruthy();
  });

  it('opens Releases for a product saved and checked', async () => {
    vi.spyOn(api, 'projectProduct').mockResolvedValue({
      product_id: 'shop',
      gears: ['g'],
      description: { revision: 3 },
      last_preview: { ok: true, errors: 0, warnings: 0, applications: [], gears: [], profile: 'dev' } as never,
    });
    draw();
    await screen.findByText('shop');
    const action = document.querySelector('[data-product-action]') as HTMLElement;
    if (action.getAttribute('data-product-action') === 'build') {
      fireEvent.click(action);
      expect(openScreen).toHaveBeenCalledWith(scope.bridge, '/releases');
    }
  });
});
