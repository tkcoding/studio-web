import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';

vi.mock('../../i18n', () => ({
  useProductTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));

import { api } from '../../api/client';
import type { ProjectSource } from '../../model/project-sources';
import { ScopeContext, type Scope } from '../common';
import { SourceRoles } from './SourceRoles';

const scope: Scope = {
  projectId: 'p1',
  workspaceId: 'w1',
  orgId: 'o1',
  language: 'en',
  bridge: {} as ChildMfeBridge,
  container: createRef<HTMLDivElement>(),
};

const API: ProjectSource = {
  connection_id: 'c1',
  full_path: 'acme/api',
  clone_url: 'https://github.com/acme/api.git',
  gears_here: true,
};
const WEB: ProjectSource = { connection_id: 'c1', full_path: 'acme/web', clone_url: 'https://github.com/acme/web.git' };

function draw() {
  return render(
    <ScopeContext.Provider value={scope}>
      <SourceRoles />
    </ScopeContext.Provider>
  );
}

describe('SourceRoles', () => {
  beforeEach(() => {
    vi.spyOn(api, 'productDescription').mockResolvedValue({
      latest: {
        revision: 3,
        text: '',
        author: 'a',
        created_at: '',
        sha256: '',
        source: 'studio',
        sources_lock: [{ id: 's1', kind: 'git', url: 'https://github.com/acme/api', commit: 'abcdef1234567890' }],
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows each source with its marks, the home and the pinned commit', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue({ sources: [API, WEB] });
    draw();
    const gears = (await screen.findByRole('checkbox', { name: 'roles_gears_title: api' })) as HTMLInputElement;
    expect(gears.checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'roles_gears_title: web' }) as HTMLInputElement).checked).toBe(false);
    // No source marked publish: the home is the first read through a connection.
    expect(screen.getByText('roles_home').closest('[data-source-role]')?.getAttribute('data-source-role')).toBe('api');
    expect(screen.getByText('roles_pinned {"commit":"abcdef12"}')).toBeTruthy();
  });

  it('moves a mark to one source: set there, cleared on every other, the rest of the config kept', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue({ brief: 'b', sources: [API, WEB] });
    const put = vi.spyOn(api, 'putProjectConfig').mockResolvedValue(undefined);
    draw();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'roles_gears_title: web' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const { gears_here: _, ...apiWithout } = API;
    expect(put.mock.calls[0]?.[2]).toEqual({ brief: 'b', sources: [apiWithout, { ...WEB, gears_here: true }] });
  });

  it('says a refused write was not saved', async () => {
    vi.spyOn(api, 'projectConfig').mockResolvedValue({ sources: [API] });
    vi.spyOn(api, 'putProjectConfig').mockRejectedValue(new Error('403'));
    draw();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'roles_publish_title: api' }));
    expect((await screen.findByRole('status')).textContent).toContain('roles_not_saved');
  });

  it('draws nothing for a project without sources', async () => {
    const read = vi.spyOn(api, 'projectConfig').mockResolvedValue(null);
    const { container } = draw();
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(container.querySelector('[data-source-roles]')).toBeNull();
  });
});
