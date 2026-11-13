import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { openScreen } = vi.hoisted(() => ({ openScreen: vi.fn() }));

vi.mock('../../../i18n', () => ({
  useFlowTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  openScreen,
}));

import { api, type ProductKindAnswer, type ProductPreview, type ProjectProduct } from '../../../api/client';
import { ScopeContext, type Scope } from '../../common';
import { ProductFlow } from './ProductFlow';
import { ProductKindStep } from './ProductKindStep';

const bridge = {} as ChildMfeBridge;
const scope: Scope = {
  projectId: 'p1',
  workspaceId: 'w1',
  orgId: 'o1',
  language: 'en',
  bridge,
  container: { current: null },
};

const PRODUCT: ProjectProduct = { product_id: 'shop', name: 'Shop', gears: ['cf-gears-api-gateway'] };

function wrap(node: React.ReactNode) {
  return render(<ScopeContext.Provider value={scope}>{node}</ScopeContext.Provider>);
}

beforeEach(() => {
  vi.spyOn(api, 'projectProduct').mockResolvedValue(PRODUCT);
  vi.spyOn(api, 'projectConfig').mockResolvedValue({});
  vi.spyOn(api, 'projectTargets').mockRejectedValue(new Error('no targets'));
  vi.spyOn(api, 'productDescription').mockResolvedValue({
    latest: { revision: 2, text: 'product "shop" {\n}\n', author: 'studio', created_at: '2026-11-01T00:00:00Z', sha256: 'x', source: 'studio' },
  });
  vi.spyOn(api, 'listArtifactNodes').mockResolvedValue({ nodes: [] } as never);
  vi.spyOn(api, 'deployments').mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  openScreen.mockReset();
});

describe('ProductFlow', () => {
  it('draws the four steps and tells the page what it read', async () => {
    const onSteps = vi.fn();
    wrap(<ProductFlow round={0} open={null} onOpen={() => undefined} onSection={() => undefined} onSaved={() => undefined} onSteps={onSteps} />);
    await waitFor(() => expect(document.querySelectorAll('[data-step]')).toHaveLength(4));
    expect(onSteps).toHaveBeenCalled();
    expect(onSteps.mock.calls[0][0].map((s: { id: string }) => s.id)).toEqual(['configure', 'save', 'build', 'deploy']);
  });

  it('opens the map for Configure and Releases for Build', async () => {
    const onSection = vi.fn();
    wrap(<ProductFlow round={0} open={null} onOpen={() => undefined} onSection={onSection} onSaved={() => undefined} />);
    await waitFor(() => expect(document.querySelector('[data-step="configure"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-step="configure"]')!);
    expect(onSection).toHaveBeenCalledWith('map');
    fireEvent.click(document.querySelector('[data-step="build"]')!);
    expect(openScreen).toHaveBeenCalledWith(bridge, '/releases');
  });

  it("checks what changes against the kept revision, then saves the next one", async () => {
    const draft = { product_gdl: 'product "shop" {\n  gear "a"\n}\n', ok: true } as ProductPreview;
    const preview = vi.spyOn(api, 'previewProduct').mockResolvedValue(draft);
    const onSaved = vi.fn();
    wrap(<ProductFlow round={0} open="save" onOpen={() => undefined} onSection={() => undefined} onSaved={onSaved} />);
    const check = await screen.findByText('check');
    fireEvent.click(check);
    await waitFor(() => expect(document.querySelector('[data-flow-diff]')).not.toBeNull());
    expect(screen.getByText('lines_change {"count":"1"}')).toBeTruthy();
    expect(preview.mock.calls[0][2]).toMatchObject({ product_id: 'shop', gears: ['cf-gears-api-gateway'] });
    expect(preview.mock.calls[0][2].write).toBeUndefined();

    fireEvent.click(screen.getByText('save_revision {"revision":"3"}'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(preview.mock.calls[1][2]).toMatchObject({ write: true, base_revision: 2 });
  });
});

describe('ProductKindStep', () => {
  const kinds = [
    { id: 'gear_product', title: 'Full product on gears', what: 'w', builds: 'b' },
    { id: 'gear_service', title: 'Gear service', what: 'w', builds: 'b' },
    { id: 'frontx_app', title: 'FrontX app', what: 'w', builds: 'b' },
    { id: 'source_built', title: 'Built from its own source', what: 'w', builds: 'b' },
  ] as ProductKindAnswer['kinds'];
  const answer = (choice: ProductKindAnswer['choice']): ProductKindAnswer => ({
    proposed: 'gear_product',
    reasons: ['The specs say too little yet to tell.'],
    basis: 'none',
    alternatives: ['gear_service', 'frontx_app', 'source_built'],
    choice,
    decided: !!choice,
    status: choice ? 'Full product on gears, confirmed.' : 'Not decided yet.',
    kinds,
    experimental: true,
  });

  it("shows the server's proposal, open while undecided, and confirms it through the server", async () => {
    vi.spyOn(api, 'productKind').mockResolvedValue(answer(null));
    const put = vi
      .spyOn(api, 'confirmProductKind')
      .mockResolvedValue(answer({ kind: 'gear_product', proposed: 'gear_product', confirmed_at: '2026-11-10T00:00:00Z' }));
    wrap(<ProductKindStep />);
    const confirm = await screen.findByText(/^confirm /);
    expect(document.querySelector('[data-product-kind="undecided"]')).not.toBeNull();
    expect(screen.getByText('The specs say too little yet to tell.')).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(put).toHaveBeenCalledWith('', 'p1', 'gear_product'));
    await waitFor(() => expect(document.querySelector('[data-product-kind="gear_product"]')).not.toBeNull());
  });

  it('says why the kind could not be read', async () => {
    vi.spyOn(api, 'productKind').mockRejectedValue(new Error('503 studio-mcp is not running'));
    wrap(<ProductKindStep />);
    expect(await screen.findByText(/kind_read_failed/)).toBeTruthy();
  });
});
