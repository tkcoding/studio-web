import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorProvider, StoredConnection } from '../../../api/types';

const { service, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: { id: 'o1', name: 'Acme' }, loading: false, failed: false }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { IntegrationsSection } from './IntegrationsSection';

/** A read: callable with its params or not, `fetch` answers `value` (rejects when it is an Error). */
const read = (what: string, value: unknown) => {
  const answer = () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  return Object.assign(
    (arg?: unknown) => {
      calls.push({ what, arg });
      return { fetch: answer };
    },
    { fetch: () => (calls.push({ what }), answer()) }
  );
};

/** A write: a factory taking path params, its `fetch` taking the body. */
const write = (what: string, answer: unknown = {}) =>
  (...arg: unknown[]) => ({
    fetch: (body: unknown) => {
      calls.push({ what, arg, body });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });

/** A write at a fixed path: `fetch` takes the body. */
const post = (what: string, answer: unknown = {}) => ({
  fetch: (body: unknown) => {
    calls.push({ what, body });
    return Promise.resolve(answer);
  },
});

const provider = (p: Partial<ConnectorProvider>): ConnectorProvider => ({
  provider: 'github',
  display_name: 'GitHub',
  default_base_url: 'https://api.github.com',
  instance_id: 'i',
  category: 'source_code',
  credential_label: 'Personal Access Token (PAT)',
  credential_hint: 'ghp_…',
  ...p,
});

const connection = (c: Partial<StoredConnection>): StoredConnection => ({
  id: 'c1',
  owner_tenant_id: 'o1',
  provider: 'github',
  label: 'Acme GitHub',
  account: 'acme-bot',
  base_url: 'https://api.github.com',
  scope: 'organization',
  secret_ref: 'ref-c1',
  created_at_epoch_secs: 0,
  ...c,
});

const PROVIDERS = [
  provider({}),
  provider({ provider: 'anthropic', display_name: 'Anthropic', category: 'ai', default_base_url: 'https://api.anthropic.com' }),
  provider({ provider: 'kubernetes', display_name: 'Kubernetes', category: 'cluster', default_base_url: '' }),
  provider({ provider: 'research', display_name: 'Constructor Research', category: 'compute', sign_in: true }),
];

const created = { connection: connection({ id: 'c9' }), account: 'new-bot', display_name: 'New Bot' };

function serve(over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    connectorProviders: read('connectorProviders', { items: PROVIDERS }),
    storedConnections: read('storedConnections', {
      items: [
        connection({}),
        connection({ id: 'c2', provider: 'anthropic', label: 'Shared key', owner_tenant_id: 'root', account: 'org-key' }),
        connection({ id: 'c3', label: 'My own', scope: 'personal', mine: true }),
      ],
    }),
    environments: read('environments', { items: [] }),
    testConnection: (id: string, tenant: string) => ({
      fetch: () => {
        calls.push({ what: 'testConnection', arg: [id, tenant] });
        return id === 'c2'
          ? Promise.reject(new Error('401 Unauthorized'))
          : Promise.resolve({ connection: connection({ id }), account: 'acme-bot', display_name: null });
      },
    }),
    probeConnection: post('probeConnection', { account: 'new-bot', display_name: 'New Bot' }),
    createConnection: post('createConnection', created),
    startSignIn: post('startSignIn', { authorize_url: 'https://id.example/authorize?x=1' }),
    patchConnection: write('patchConnection', created),
    deleteConnection: write('deleteConnection'),
    connectionRepositories: read('connectionRepositories', {
      items: [
        { id: 'r1', name: 'api', full_path: 'acme/api', clone_url: 'https://github.com/acme/api.git', default_branch: 'main' },
        { id: 'r2', name: 'web', full_path: 'acme/web', clone_url: 'https://github.com/acme/web.git', visibility: 'private' },
      ],
    }),
    getTenantMetadata: read('getTenantMetadata', {
      value: { brief: 'kept', sources: [{ connection_id: 'c1', full_path: 'acme/web', clone_url: 'https://github.com/acme/web' }] },
    }),
    putTenantMetadata: write('putTenantMetadata'),
    syncProjectCatalogue: write('syncProjectCatalogue'),
    ...over,
  });
}

// Base UI's checkbox builds a PointerEvent, which jsdom does not have.
globalThis.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent;

const row = async (label: string) => (await screen.findByText(label)).closest('tr') as HTMLElement;
const click = (root: ParentNode, selector: string) => fireEvent.click(root.querySelector(selector) as HTMLElement);

beforeEach(() => {
  calls.length = 0;
  serve();
});

afterEach(() => vi.restoreAllMocks());

describe('Integrations: the list', () => {
  it('lists the organization’s shared connections, never a person’s own, with each one’s answer', async () => {
    render(<IntegrationsSection />);
    const own = await row('Acme GitHub');
    expect(screen.queryByText('My own')).toBeNull();
    await waitFor(() => expect(own.querySelector('[data-connection-answer="ok"]')?.textContent).toBe('acme-bot'));
    const shared = await row('Shared key');
    await waitFor(() => expect(shared.querySelector('[data-connection-answer="bad"]')?.textContent).toBe('401 Unauthorized'));
    // Inherited from above: edited where it is defined, and called shared.
    expect((shared.querySelector('[data-connection-edit]') as HTMLButtonElement).disabled).toBe(true);
    expect(within(shared).getByText('int_scope_shared')).toBeTruthy();
    // Only a source-code connection has repositories to browse.
    expect(own.querySelector('[data-connection-browse]')).toBeTruthy();
    expect(shared.querySelector('[data-connection-browse]')).toBeNull();
  });

  it('says what is not connected yet, and opens the picker on that kind', async () => {
    render(<IntegrationsSection />);
    const missing = await waitFor(() => {
      const found = document.querySelector('[data-connections-missing]');
      if (!found) throw new Error('no missing line');
      return found as HTMLElement;
    });
    expect(missing.querySelector('[data-missing-add="cluster"]')).toBeTruthy();
    expect(missing.querySelector('[data-missing-add="source_code"]')).toBeNull();
    click(missing, '[data-missing-add="cluster"]');
    const picker = document.querySelector('[data-connection-picker]') as HTMLElement;
    expect(picker.querySelector('[data-provider="kubernetes"]')).toBeTruthy();
    expect(picker.querySelector('[data-provider="github"]')).toBeNull();
  });

  it('keeps its search and kind in the address, and opens on them', async () => {
    window.history.replaceState(null, '', '/connections?conn.f.kind=ai');
    const view = render(<IntegrationsSection />);
    // Opened on the address: the AI kind chosen, so the GitHub row is filtered out.
    await screen.findByText('Shared key');
    expect(screen.queryByText('Acme GitHub')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'int_search' }), { target: { value: 'shared' } });
    expect(new URLSearchParams(window.location.search).get('conn.q')).toBe('shared');
    expect(new URLSearchParams(window.location.search).get('conn.f.kind')).toBe('ai');

    // Leaving the screen takes the list's part out of the address.
    view.unmount();
    expect(window.location.search).toBe('');
  });

  it('says plainly when this build has no connector driver', async () => {
    serve({
      connectorProviders: read(
        'connectorProviders',
        Object.assign(new Error('503'), { response: { status: 503, data: { detail: 'No driver registered' } } })
      ),
    });
    render(<IntegrationsSection />);
    await waitFor(() => expect(document.querySelector('[data-integrations-disabled]')?.textContent).toContain('No driver registered'));
    expect(document.querySelector('[data-connections]')).toBeNull();
  });

  it('removes a connection after asking, from the organization', async () => {
    render(<IntegrationsSection />);
    const own = await row('Acme GitHub');
    click(own, '[data-connection-remove]');
    fireEvent.click(await waitFor(() => document.querySelector('[data-admin-confirm-go]') as HTMLElement));
    await waitFor(() => expect(calls.find((c) => c.what === 'deleteConnection')?.arg).toEqual(['c1', 'o1']));
  });
});

describe('Integrations: adding', () => {
  it('tests a credential without saving, then saves it for the organization', async () => {
    render(<IntegrationsSection />);
    await row('Acme GitHub');
    click(document, '[data-connection-add]');
    click(document, '[data-connection-picker] [data-provider="github"]');
    const form = document.querySelector('[data-connection-form="github"]') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('Personal Access Token (PAT)'), { target: { value: 'ghp_x' } });
    click(form, '[data-connection-probe-go]');
    await waitFor(() => expect(form.querySelector('[data-connection-probe]')?.textContent).toBe('int_valid_named'));
    expect(calls.find((c) => c.what === 'probeConnection')?.body).toEqual({
      provider: 'github',
      base_url: undefined,
      token: 'ghp_x',
    });
    fireEvent.change(within(form).getByPlaceholderText('int_label_placeholder'), { target: { value: 'Bot' } });
    click(form, '[data-connection-create]');
    await waitFor(() => expect(document.querySelector('[data-integrations-note]')?.textContent).toBe('int_connected_as_named'));
    expect(calls.find((c) => c.what === 'createConnection')?.body).toEqual({
      provider: 'github',
      base_url: undefined,
      token: 'ghp_x',
      label: 'Bot',
      scope: 'organization',
      owner_tenant_id: 'o1',
    });
    // The picker closes and the list is read again.
    expect(document.querySelector('[data-connection-form]')).toBeNull();
    expect(calls.filter((c) => c.what === 'storedConnections').length).toBeGreaterThan(1);
  });

  it('takes a cluster’s address from its kubeconfig and keeps the cluster to the organization', async () => {
    render(<IntegrationsSection />);
    await row('Acme GitHub');
    click(document, '[data-connection-add]');
    click(document, '[data-provider="kubernetes"]');
    const form = document.querySelector('[data-connection-form="kubernetes"]') as HTMLElement;
    expect((form.querySelector('[data-connection-reach]') as HTMLSelectElement).value).toBe('organization');
    fireEvent.change(within(form).getByLabelText('Personal Access Token (PAT)'), {
      target: { value: 'clusters:\n- cluster:\n    server: https://10.0.0.1:6443\n' },
    });
    expect((within(form).getByPlaceholderText('int_url_required') as HTMLInputElement).value).toBe('https://10.0.0.1:6443');
  });

  it('sends a signed-in account to the identity provider, kept to the person', async () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, origin: 'https://studio.example', assign });
    render(<IntegrationsSection />);
    await row('Acme GitHub');
    click(document, '[data-connection-add]');
    click(document, '[data-provider="research"]');
    const form = document.querySelector('[data-connection-form="research"]') as HTMLElement;
    fireEvent.change(within(form).getByPlaceholderText('int_signin_label_placeholder'), { target: { value: 'My Research' } });
    click(form, '[data-connection-signin]');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://id.example/authorize?x=1'));
    expect(calls.find((c) => c.what === 'startSignIn')?.body).toEqual({
      provider: 'research',
      label: 'My Research',
      scope: 'personal',
      owner_tenant_id: 'o1',
      redirect_uri: 'https://studio.example/connections/oauth/callback',
    });
  });
});

describe('Integrations: a connection', () => {
  it('edits only what changed, keeping the connection, and asks it again', async () => {
    render(<IntegrationsSection />);
    const own = await row('Acme GitHub');
    click(own, '[data-connection-edit]');
    const editor = document.querySelector('[data-connection-editor]') as HTMLElement;
    fireEvent.change(within(editor).getByLabelText('int_label'), { target: { value: 'Renamed' } });
    const tests = calls.filter((c) => c.what === 'testConnection').length;
    click(editor, '[data-connection-save]');
    await waitFor(() => expect(calls.find((c) => c.what === 'patchConnection')).toBeTruthy());
    const patch = calls.find((c) => c.what === 'patchConnection');
    expect(patch?.arg).toEqual(['c1', 'o1']);
    expect(patch?.body).toEqual({ label: 'Renamed' });
    await waitFor(() => expect(calls.filter((c) => c.what === 'testConnection').length).toBeGreaterThan(tests));
  });

  it('browses its repositories and adds the ticked ones to the organization’s sources', async () => {
    render(<IntegrationsSection />);
    const own = await row('Acme GitHub');
    click(own, '[data-connection-browse]');
    const browser = await waitFor(() => {
      const found = document.querySelector('[data-repo-browser] [data-repo="acme/api"]');
      if (!found) throw new Error('no repositories');
      return found.closest('[data-repo-browser]') as HTMLElement;
    });
    // acme/web is listed already (however its URL is spelled): attached, not tickable.
    await waitFor(() => expect(within(browser.querySelector('[data-repo="acme/web"]') as HTMLElement).getByText('int_attached_mark')).toBeTruthy());
    fireEvent.click(within(browser.querySelector('[data-repo="acme/api"]') as HTMLElement).getByRole('checkbox'));
    click(browser, '[data-repo-attach]');
    await waitFor(() => expect(calls.find((c) => c.what === 'putTenantMetadata')).toBeTruthy());
    const put = calls.find((c) => c.what === 'putTenantMetadata');
    expect(put?.arg).toEqual(['o1', 'gts.cf.core.am.tenant_metadata.v1~cf.studio.project.config.v1~']);
    expect(put?.body).toEqual({
      brief: 'kept',
      sources: [
        { connection_id: 'c1', full_path: 'acme/web', clone_url: 'https://github.com/acme/web' },
        {
          connection_id: 'c1',
          full_path: 'acme/api',
          clone_url: 'https://github.com/acme/api.git',
          branch: 'main',
          share_mode: 'branch',
        },
      ],
    });
    await waitFor(() => expect(calls.find((c) => c.what === 'syncProjectCatalogue')?.arg).toEqual(['o1']));
  });
});
