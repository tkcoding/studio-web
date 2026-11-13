import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

vi.mock('../../../i18n', () => {
  const t = Object.assign(
    (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    { count: (key: string, n: number) => `${key}:${n}` }
  );
  return { useConfiguratorTranslations: () => ({ t, loading: false }) };
});

import { api, type ProductPreview, type ProjectProduct } from '../../../api/client';
import { ScopeContext, type Scope } from '../../common';
import { ProductBackend, descriptionConflictOf } from './ProductBackend';

const RECORD: ProjectProduct = {
  product_id: 'shop',
  name: 'Shop',
  gears: ['cf-gears-api-gateway', 'cf-gears-static-authn-plugin'],
  config: {},
};

const preview = (ok: boolean): ProductPreview =>
  ({
    product_gdl: 'product "shop" {}',
    gdl_sha256: 'abc',
    profile: 'prod',
    ok,
    diagnostics: ok
      ? []
      : [{ code: 'GBX0325', severity: 'error', message: 'gear `static-authn-plugin` accepts any token' }],
    applications: [],
    gears: [],
    added: [],
    not_described: [],
    plugin_options: [],
  }) as unknown as ProductPreview;

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

function mount() {
  return render(
    <ScopeContext.Provider value={scope()}>
      <ProductBackend />
    </ScopeContext.Provider>
  );
}

describe('ProductBackend', () => {
  beforeEach(() => {
    // The engine is off here: no catalogue, the plain list of picks.
    vi.spyOn(api, 'gearboxStatus').mockResolvedValue({ enabled: false, source_id: 's', profiles: [] });
    vi.spyOn(api, 'projectProduct').mockResolvedValue(RECORD);
    vi.spyOn(api, 'tenant').mockResolvedValue({ id: 'p1', name: 'Shop' });
    vi.spyOn(api, 'projectTargets').mockResolvedValue({
      organization_id: 'o1',
      project_name: 'Shop',
      environments: [],
      bindings: [],
    });
    vi.spyOn(api, 'productDescription').mockResolvedValue({ latest: null });
    vi.spyOn(api, 'deployments').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'gearConfigSchemas').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'completeProduct').mockResolvedValue({ gears: RECORD.gears!, changes: [], config: {} });
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows the picks, the engine being off, and checks the product on arrival', async () => {
    const asked = vi.spyOn(api, 'previewProduct').mockResolvedValue(preview(true));
    mount();
    expect((await screen.findAllByText('api-gateway')).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-gearbox-off]')).not.toBeNull();
    await waitFor(() => expect(asked).toHaveBeenCalled());
    const body = asked.mock.calls[0][2];
    expect(body).toMatchObject({ product_id: 'shop', gears: RECORD.gears, profile: 'prod' });
    expect(body.write).toBeUndefined();
    expect(await screen.findByText(/resolves_for/)).toBeTruthy();
  });

  it('lists the fixes for a product that does not resolve, and applies one', async () => {
    vi.spyOn(api, 'previewProduct').mockResolvedValue(preview(false));
    const save = vi.spyOn(api, 'saveProjectProduct').mockResolvedValue({ value: RECORD });
    mount();
    fireEvent.click(await screen.findByText('show_fixes:1'));
    expect(await screen.findByText(/fix_replace/)).toBeTruthy();
    fireEvent.click(screen.getByText('apply'));
    // The swap is written to the record.
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    expect(save.mock.calls[0][2].gears).toEqual(['cf-gears-api-gateway', 'cf-gears-oidc-authn-plugin']);
  });

  it('tells a stale save from another failure', () => {
    const latest = { revision: 4, text: 'x', author: 'a', created_at: 'now', sha256: 's', source: 'studio' };
    expect(
      descriptionConflictOf({ response: { status: 409, data: { reason: 'DESCRIPTION_REVISION_STALE', latest } } })
    ).toMatchObject({ latest });
    expect(descriptionConflictOf({ response: { status: 500, data: {} } })).toBeNull();
  });
});
