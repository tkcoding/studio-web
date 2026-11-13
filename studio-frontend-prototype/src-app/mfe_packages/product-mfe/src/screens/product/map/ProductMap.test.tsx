import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

vi.mock('../../../i18n', () => ({
  useMapTranslations: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));

import { api } from '../../../api/client';
import type { ProjectProduct } from '../../../api/types';
import { ScopeContext, type Scope } from '../../common';
import { ProductMap } from './ProductMap';

const PRODUCT: ProjectProduct = { product_id: 'shop', name: 'shop', gears: ['cf-gears-orders'] };

function scope(): Scope {
  return {
    projectId: 'p1',
    workspaceId: 'w1',
    orgId: 'o1',
    language: 'en',
    bridge: {} as ChildMfeBridge,
    container: createRef<HTMLDivElement>(),
  };
}

function mount(onSection = vi.fn()) {
  return render(
    <ScopeContext.Provider value={scope()}>
      <ProductMap onSection={onSection} />
    </ScopeContext.Provider>
  );
}

/** Generous under a loaded machine: the map reads seven things before it draws. */
const WAIT = { timeout: 10000 };

describe('ProductMap', () => {
  beforeEach(() => {
    vi.spyOn(api, 'projectProduct').mockResolvedValue(PRODUCT);
    vi.spyOn(api, 'projectTargets').mockRejectedValue(new Error('no targets'));
    vi.spyOn(api, 'listComponents').mockResolvedValue({ nodes: [] });
    vi.spyOn(api, 'listComponentProfiles').mockResolvedValue({ nodes: [] });
    vi.spyOn(api, 'projectConfig').mockResolvedValue(null);
    vi.spyOn(api, 'productDescription').mockResolvedValue({ latest: null });
    vi.spyOn(api, 'productInfra').mockResolvedValue({ items: [], source: 'project-list', revision: null, services: [] });
    vi.spyOn(api, 'outlineProductDescription').mockResolvedValue({ nodes: [{ id: 'gear:orders', lines: [2] }], lines: [{ line: 2, nodes: ['gear:orders'] }] });
    vi.spyOn(api, 'gearboxCatalogue').mockRejectedValue(new Error('no engine'));
    vi.spyOn(api, 'gearConfigSchemas').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'previewProduct').mockResolvedValue({
      product_gdl: 'product(\n  use_gear("cf-gears-orders"),\n)\n',
      ok: true,
      gears: ['cf-gears-orders'],
      diagnostics: [],
      applications: [],
      profile: 'deploy',
    } as unknown as Awaited<ReturnType<typeof api.previewProduct>>);
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the lanes and the picked gear, and says nothing is wrong between them', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-product-map]')).not.toBeNull(), WAIT);
    expect(container.querySelector('[data-pmap-lane="frontend"]')).not.toBeNull();
    expect(container.querySelector('[data-pmap-lane="backend"]')).not.toBeNull();
    expect(container.querySelector('[data-pmap-lane="infrastructure"]')).not.toBeNull();
    expect(container.querySelector('[data-pmap-node="gear:orders"]')).not.toBeNull();
    expect(screen.getByText('detail_title')).toBeTruthy();
  });

  it('opens a gear in the detail and takes it out of the product', async () => {
    const save = vi.spyOn(api, 'saveProjectProduct').mockResolvedValue({ value: { ...PRODUCT, gears: [] } });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-pmap-node="gear:orders"]')).not.toBeNull(), WAIT);
    fireEvent.click(container.querySelector('[data-pmap-node="gear:orders"]')!);
    expect(container.querySelector('[data-pmap-detail="gear:orders"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-pmap-remove-gear="cf-gears-orders"]')!);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][2]).toMatchObject({ product_id: 'shop', gears: [] });
  });

  it('shows product.gdl as the next save would write it, its gear line tied to the node', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-pmap-view="gdl"]')).not.toBeNull(), WAIT);
    fireEvent.click(container.querySelector('[data-pmap-view="gdl"]')!);
    await waitFor(() => expect(container.querySelector('[data-pmap-gdl="draft"]')).not.toBeNull(), WAIT);
    expect(screen.getByText('use_gear("cf-gears-orders"),', { exact: false })).toBeTruthy();
    expect(api.previewProduct).toHaveBeenCalledWith('', 'p1', expect.objectContaining({ product_id: 'shop', gears: ['cf-gears-orders'] }));
    // The server reads which line is which node: the gear's line is tied to it.
    expect(api.outlineProductDescription).toHaveBeenCalledWith('', 'p1', {
      text: 'product(\n  use_gear("cf-gears-orders"),\n)\n',
    });
    await waitFor(() => expect(container.querySelector('[data-gdl-line="2"]')?.className).toMatch(/owned/), WAIT);
  });
});
