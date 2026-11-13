import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { api, type InfraPassport, type InfraService, type ProjectTargets } from '../../../api/client';
import { ScopeContext, type Scope } from '../../common';

const { openScreen } = vi.hoisted(() => ({ openScreen: vi.fn() }));

vi.mock('../../../i18n', () => ({
  useInfraTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  openScreen,
}));

import { ProductInfrastructure } from './ProductInfrastructure';

const passport: InfraPassport = {
  name: 'keycloak',
  version: '26.0.7',
  image: 'quay.io/keycloak/keycloak:26.0.7',
  ports: { http: 8080 },
  args: ['start-dev'],
  config: { KC_HEALTH_ENABLED: 'true' },
  secrets: ['KC_BOOTSTRAP_ADMIN_PASSWORD'],
  provides: { 'oidc.issuer': '{public_url}/realms/product' },
  stateful: false,
};
const keycloak: InfraService = { passport, public_url: 'https://id.shop.example' };

const scope: Scope = {
  projectId: 'p1',
  workspaceId: 'w1',
  orgId: 'o1',
  language: 'en',
  bridge: {} as ChildMfeBridge,
  container: { current: null },
};

function draw() {
  return render(
    <ScopeContext.Provider value={scope}>
      <ProductInfrastructure />
    </ScopeContext.Provider>
  );
}

describe('Product › Infrastructure', () => {
  beforeEach(() => {
    openScreen.mockReset();
    vi.spyOn(api, 'projectProduct').mockResolvedValue({ gears: [] });
    vi.spyOn(api, 'projectTargets').mockResolvedValue({
      organization_id: 'o1',
      project_name: 'shop',
      environments: [],
      bindings: [],
    } as ProjectTargets);
    // No description yet: the server answers the project's list (GET product-infra).
    vi.spyOn(api, 'productInfra').mockResolvedValue({ items: [keycloak], source: 'project-list', revision: null, services: [] });
    vi.spyOn(api, 'productDescription').mockResolvedValue({ latest: null });
    vi.spyOn(api, 'listComponents').mockResolvedValue({ nodes: [] });
    vi.spyOn(api, 'projectImages').mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists the services beside the gears and says there is no environment yet, opening Releases', async () => {
    draw();
    expect(await screen.findByText('keycloak')).toBeTruthy();
    expect(document.querySelector('[data-infra-source="project-list"]')).toBeTruthy();
    expect(screen.getByText('no_environment')).toBeTruthy();
    fireEvent.click(screen.getByText('open_releases'));
    expect(openScreen).toHaveBeenCalledWith(scope.bridge, '/releases');
  });

  it('opens a row to its image, settings and public address', async () => {
    draw();
    fireEvent.click(await screen.findByText('keycloak'));
    const detail = document.querySelector('[data-infra-detail="keycloak"]');
    expect(detail?.textContent).toContain('quay.io/keycloak/keycloak:26.0.7');
    expect(detail?.textContent).toContain('KC_HEALTH_ENABLED=true');
  });

  it('removes a service after asking, writing the whole list', async () => {
    const put = vi
      .spyOn(api, 'putProductInfra')
      .mockResolvedValue({ items: [], source: 'project-list', revision: null, services: [] });
    draw();
    fireEvent.click(await screen.findByText('remove', { selector: '[data-infra-remove] , [data-infra-remove] *' }));
    fireEvent.click(await screen.findByText('remove', { selector: '[data-confirm], [data-confirm] *' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('', 'p1', { base_revision: null, items: [] }));
    // The list is read again after the save, while the reads are still stubbed.
    await waitFor(() => expect(api.productInfra).toHaveBeenCalledTimes(2));
  });

  it('edits a service image and saves it through the store', async () => {
    const put = vi
      .spyOn(api, 'putProductInfra')
      .mockResolvedValue({ items: [keycloak], source: 'project-list', revision: null, services: [] });
    draw();
    fireEvent.click(await screen.findByText('change_image'));
    fireEvent.change(screen.getByLabelText('publisher_image'), { target: { value: 'quay.io/keycloak/keycloak:26.1.0' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const saved = put.mock.calls[0][2].items;
    await waitFor(() => expect(api.productInfra).toHaveBeenCalledTimes(2));
    expect(saved[0].passport).toMatchObject({ image: 'quay.io/keycloak/keycloak:26.1.0', version: '26.1.0' });
  });

  it('says why the services could not be read', async () => {
    vi.spyOn(api, 'productInfra').mockRejectedValue(new Error('boom'));
    draw();
    expect(await screen.findByText(/read_failed/)).toBeTruthy();
  });
});
