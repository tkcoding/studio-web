import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

vi.mock('../../../i18n', () => ({
  useFrontendTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));

import { api, type CatalogNode, type ProjectProduct } from '../../../api/client';
import { FRONTX_NODE_TYPE } from '../../../model/frontend-constructor';
import { ScopeContext, type Scope } from '../../common';
import { ProductFrontend } from './ProductFrontend';
import { forgetFrontxDefaults } from './frontxDefaults';
import { forgetPictures } from './FrontendConstructor';

const scope: Scope = {
  projectId: 'p1',
  workspaceId: 'w1',
  orgId: 'o1',
  language: 'en',
  bridge: {} as ChildMfeBridge,
  container: { current: null },
};

const shellRef = 'github:acme/portal//shell@main';

/** A catalogue micro-frontend node, and its profile: one screen, calling `gear-a`. */
const mfeNode = {
  type_id: FRONTX_NODE_TYPE,
  instance_id: 'people-mfe',
  value: { name: 'people-mfe', component_kind: 'micro-frontend', description: 'People screens', repository: 'acme/portal' },
} as unknown as CatalogNode;
const mfeProfile = {
  type_id: 'profile',
  instance_id: 'people-mfe',
  value: {
    gear_name: 'people-mfe',
    auto: {
      path: 'src-app/mfe_packages/people-mfe',
      mfe_extensions: [{ id: 'people', domain: 'screen', label: 'People', route: '/people', order: 1 }],
      mfe_calls: ['gear-a'],
    },
  },
} as unknown as CatalogNode;

function mount() {
  return render(
    <ScopeContext.Provider value={scope}>
      <ProductFrontend onChanged={onChanged} />
    </ScopeContext.Provider>
  );
}

const onChanged = vi.fn();

beforeEach(() => {
  forgetFrontxDefaults();
  forgetPictures();
  vi.spyOn(api, 'gearboxStatus').mockResolvedValue({ enabled: true } as never);
  vi.spyOn(api, 'listComponents').mockResolvedValue({ nodes: [mfeNode] });
  vi.spyOn(api, 'listComponentProfiles').mockResolvedValue({ nodes: [mfeProfile] });
  vi.spyOn(api, 'listArtifactNodes').mockResolvedValue({ nodes: [] } as never);
  vi.spyOn(api, 'catalogSources').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(api, 'getProjectGearRepo').mockResolvedValue({ nodes: [] });
  vi.spyOn(api, 'screenPreviews').mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  onChanged.mockReset();
});

describe('ProductFrontend', () => {
  it('offers a frontend when the product has none, and adds the starter shell', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue({});
    vi.spyOn(api, 'projectProduct').mockResolvedValue({ gears: [] });
    const save = vi
      .spyOn(api, 'saveProjectProduct')
      .mockResolvedValue({ value: { frontend: { shell: { repo: 'r', path: 'p', ref: 'main' }, mfes: [] } } });
    mount();
    fireEvent.click(await screen.findByText('add'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = save.mock.calls[0][2];
    expect(body.frontend?.mfes).toEqual([]);
    expect(body.frontend?.shell.repo).toBeTruthy();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('removes the frontend and the project configuration’s older record of it', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue({ frontend: { mfes: [], shell: shellRef } });
    vi.spyOn(api, 'projectProduct').mockResolvedValue({ gears: [] });
    vi.spyOn(api, 'saveProjectProduct').mockResolvedValue({ value: {} as ProjectProduct });
    const put = vi.spyOn(api, 'putProjectConfig').mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByText('remove'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('', 'p1', {}));
  });

  it('draws the constructor with the catalogue’s micro-frontends and saves a pick to the product', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue({ frontend: { mfes: [], shell: shellRef } });
    vi.spyOn(api, 'projectProduct').mockResolvedValue({ gears: ['gear-a'] });
    const save = vi.spyOn(api, 'saveProjectProduct').mockResolvedValue({ value: {} as ProjectProduct });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-mfe="people-mfe"]')).not.toBeNull());
    fireEvent.click(screen.getByText('add_one'));
    await waitFor(() => expect(container.querySelector('[data-mfe="people-mfe"]')).toBeNull());
    expect(screen.getByText('gears_all')).toBeTruthy();
    fireEvent.click(screen.getByText('save_to_product'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const pick = save.mock.calls[0][2].frontend;
    expect(pick?.shell.repo).toBe('acme/portal');
  });

  it('says what could not be read', async () => {
    vi.spyOn(api, 'projectConfig').mockRejectedValue(new Error('down'));
    vi.spyOn(api, 'projectProduct').mockResolvedValue(null);
    mount();
    expect(await screen.findByText('down')).toBeTruthy();
  });
});
