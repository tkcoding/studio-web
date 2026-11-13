import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Query = { data?: unknown; isError?: boolean; error?: unknown; refetch?: () => Promise<unknown> };

const h = vi.hoisted(() => ({
  org: { current: { id: 'org-1', name: 'Fabric' } as { id: string; name: string } | null },
  queries: { tenant: {} as Query, me: {} as Query, workspaces: {} as Query },
  rename: vi.fn(),
  remove: vi.fn(),
  conversion: vi.fn(),
  logo: vi.fn(),
  setLogo: vi.fn(),
  deleteLogo: vi.fn(),
  openScreen: vi.fn(),
  service: undefined as unknown,
  dialogs: {} as Record<string, { open: boolean; onSave?: (n: string) => Promise<unknown>; onConfirm?: () => Promise<unknown>; title?: string }>,
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    // One instance, as the registry holds one: a new object each render would re-run every effect keyed on it.
    getService: () => (h.service ??= {
      getTenant: () => ({ kind: 'tenant' }),
      getMe: { kind: 'me' },
      getWorkspaces: () => ({ kind: 'workspaces' }),
      renameTenant: (id: string) => ({ fetch: (body: unknown) => h.rename(id, body) }),
      deleteTenant: (id: string) => ({ fetch: () => h.remove(id) }),
      requestConversion: (id: string) => ({ fetch: (body: unknown) => h.conversion(id, body) }),
      logo: () => ({ fetch: () => h.logo() }),
      setLogo: (id: string) => ({ fetch: (body: unknown) => h.setLogo(id, body) }),
      deleteLogo: (id: string) => ({ fetch: () => h.deleteLogo(id) }),
    }),
  },
  useApiQuery: (d: { kind: 'tenant' | 'me' | 'workspaces' }) => h.queries[d.kind],
  useMfeBridge: () => null,
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganization: () => ({ org: h.org.current, loading: false }),
  openScreen: h.openScreen,
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key} ${count}`;
  return { useSettingsTranslations: () => ({ t, loading: false }) };
});

vi.mock('../../components/dialogs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NameDialog: (props: { open: boolean; onSave: (n: string) => Promise<unknown> }) => {
    h.dialogs.name = props;
    return null;
  },
  ConfirmDialog: (props: { open: boolean; title: string; onConfirm: () => Promise<unknown> }) => {
    h.dialogs[props.title.startsWith('delete') ? 'delete' : 'mode'] = props;
    return null;
  },
}));

import { SettingsScreen } from './SettingsScreen';

const tenant = (extra: Record<string, unknown> = {}) => ({
  data: { id: 'org-1', name: 'Fabric Inc', self_managed: false, ...extra },
  isError: false,
  refetch: vi.fn(() => Promise.resolve()),
});

describe('Organization › Settings', () => {
  beforeEach(() => {
    h.org.current = { id: 'org-1', name: 'Fabric' };
    h.queries.tenant = tenant();
    h.queries.me = { data: { subject_id: 'u1', subject_tenant_id: 'root' } };
    h.queries.workspaces = { data: { items: [{ id: 'w1' }, { id: 'w2' }] } };
    h.logo.mockRejectedValue(new Error('404'));
    h.dialogs = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('says so when no organization is in scope', () => {
    h.org.current = null;
    render(<SettingsScreen />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it("shows the organization's name, id, mode and workspaces", () => {
    render(<SettingsScreen />);
    expect(screen.getByText('Fabric Inc')).toBeTruthy();
    expect(screen.getByText('org-1')).toBeTruthy();
    expect(screen.getByText('managed')).toBeTruthy();
    expect(screen.getByText('workspace_count 2')).toBeTruthy();
  });

  it('shows the refusal when the organization cannot be read', () => {
    h.queries.tenant = { isError: true, error: new Error('no access'), refetch: vi.fn() };
    render(<SettingsScreen />);
    expect(screen.getByRole('alert').textContent).toContain('no access');
    expect(document.querySelector('[data-org-mode]')).toBeNull();
  });

  it('renames through the account system and reads the organization again', async () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByText('rename'));
    expect(h.dialogs.name.open).toBe(true);
    await act(async () => {
      await h.dialogs.name.onSave!('New name');
    });
    expect(h.rename).toHaveBeenCalledWith('org-1', { name: 'New name' });
    expect(h.queries.tenant.refetch).toHaveBeenCalled();
  });

  it('asks before raising the barrier, then requests the conversion', async () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByText('to_self_managed'));
    expect(h.conversion).not.toHaveBeenCalled();
    expect(h.dialogs.mode.open).toBe(true);
    await act(async () => {
      await h.dialogs.mode.onConfirm!();
    });
    expect(h.conversion).toHaveBeenCalledWith('org-1', expect.objectContaining({ target_mode: 'self_managed' }));
    expect(screen.getByText('conversion_requested')).toBeTruthy();
  });

  it('shows the refusal of a conversion request', async () => {
    h.queries.me = { data: { subject_tenant_id: 'org-1' } };
    h.queries.tenant = tenant({ self_managed: true });
    h.conversion.mockRejectedValueOnce(new Error('not allowed'));
    render(<SettingsScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText('to_managed'));
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not allowed'));
    expect(h.conversion).toHaveBeenCalledWith('org-1', expect.objectContaining({ target_mode: 'managed' }));
  });

  it('leaves a self-managed organization that is not your home to its inside', () => {
    h.queries.tenant = tenant({ self_managed: true });
    render(<SettingsScreen />);
    expect(screen.getByText('requested_inside')).toBeTruthy();
    expect(document.querySelector('[data-org-mode]')).toBeNull();
  });

  it('offers no danger zone for your home organization', () => {
    h.queries.me = { data: { subject_tenant_id: 'org-1' } };
    render(<SettingsScreen />);
    expect(document.querySelector('[data-org-danger]')).toBeNull();
  });

  it('offers neither mode nor danger zone until it knows whose home this is', () => {
    h.queries.me = {};
    render(<SettingsScreen />);
    expect(document.querySelector('[data-org-danger]')).toBeNull();
    expect(document.querySelector('[data-org-mode]')).toBeNull();
  });

  it('deletes after the confirmation and says the organization is gone', async () => {
    render(<SettingsScreen />);
    fireEvent.click(document.querySelector('[data-org-delete]')!);
    expect(h.dialogs.delete.open).toBe(true);
    await act(async () => {
      await h.dialogs.delete.onConfirm!();
    });
    expect(h.remove).toHaveBeenCalledWith('org-1');
    expect(document.querySelector('[data-org-deleted]')).toBeTruthy();
  });

  it("opens Admin's sections and the workspaces", () => {
    render(<SettingsScreen />);
    fireEvent.click(document.querySelector('[data-org-admin-link="people"]')!);
    fireEvent.click(document.querySelector('[data-org-admin-link="access"]')!);
    fireEvent.click(screen.getByText('open_workspaces'));
    expect(h.openScreen.mock.calls.map((c) => c[1])).toEqual(['/admin/people', '/admin/access', '/organization/workspaces']);
  });

  it('refuses a logo of the wrong type before sending it', async () => {
    render(<SettingsScreen />);
    const input = document.querySelector('[data-org-logo-input]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'a.svg', { type: 'image/svg+xml' })] } });
    });
    expect(screen.getByRole('alert').textContent).toBe('logo_bad_type');
    expect(h.setLogo).not.toHaveBeenCalled();
  });

  it('sends a picked logo as base64 and shows what was kept', async () => {
    h.setLogo.mockResolvedValue({ content_type: 'image/png', data: 'U3R1ZGlv' });
    render(<SettingsScreen />);
    const input = document.querySelector('[data-org-logo-input]') as HTMLInputElement;
    // jsdom's File has no arrayBuffer(); a browser's does.
    const file = Object.assign(new File(['Studio'], 'a.png', { type: 'image/png' }), {
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('Studio').buffer),
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(h.setLogo.mock.calls.length).toBe(1));
    await waitFor(() => expect(document.querySelector('[data-org-logo-image]')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h.setLogo).toHaveBeenCalledWith('org-1', { content_type: 'image/png', data: 'U3R1ZGlv' });
  });
});
