import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, DeployEnvironment, Deployment, EnvironmentList } from '../../api/types';

const { service, calls, openScreen } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown[]; body?: unknown }[],
  openScreen: vi.fn(),
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key}_${count === 1 ? 'one' : 'many'} ${count}`;
  return { useInfrastructureTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: { id: 'o1', name: 'Acme' }, loading: false, failed: false }),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  openScreen,
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { InfrastructureScreen } from './InfrastructureScreen';

// jsdom has no PointerEvent; the kit's Switch dispatches one when it is clicked.
if (typeof window.PointerEvent === 'undefined') {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

/** A read: `api.name(params).fetch()`. */
const read = (name: string, value: unknown) => (params?: unknown) => {
  calls.push({ name, args: [params] });
  return { fetch: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)) };
};
/** A write: `api.name(...args).fetch(body)`. */
const write = (name: string, value: unknown) => (...args: unknown[]) => ({
  fetch: (body?: unknown) => {
    calls.push({ name, args, body });
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  },
});

const env = (patch: Partial<DeployEnvironment>): DeployEnvironment => ({
  id: 'e-dev',
  name: 'dev',
  description: '',
  kind: 'kubernetes',
  connection_id: 'c-k8s',
  registry: 'ghcr.io/acme',
  namespace_pattern: '{project}-{environment}',
  database: 'none',
  protected: false,
  updated_by: 'u1',
  updated_at: '2026-11-01T00:00:00Z',
  ...patch,
});

const conn = (patch: Partial<Connection>): Connection => ({
  id: 'c-k8s',
  owner_tenant_id: 'o1',
  provider: 'kubernetes',
  label: 'main cluster',
  account: 'deployer',
  base_url: 'https://k8s.acme.example:6443',
  scope: 'organization',
  secret_ref: '',
  created_at_epoch_secs: 0,
  ...patch,
});

const deployment = (patch: Partial<Deployment>): Deployment => ({
  id: 'd1',
  project_id: 'p1',
  project_name: 'Shop',
  environment_id: 'e-prod',
  environment_name: 'prod',
  profile: 'kubernetes',
  product: 'shop',
  images: [],
  namespace: 'shop-prod',
  chart_sha256: '',
  chart_version: '1.2.0',
  state: 'awaiting_approval',
  requested_by: 'u2',
  requested_by_name: 'Ann',
  requested_at: '2026-11-08T10:00:00Z',
  ...patch,
});

function setUp({
  mayManage = true,
  environments = [env({}), env({ id: 'e-prod', name: 'prod', protected: true, promote_from: 'e-dev' })],
  deployments = [deployment({}), deployment({ id: 'd0', environment_id: 'e-dev', environment_name: 'dev', state: 'succeeded', chart_version: '1.1.0' })],
  environmentsError,
  kits = ['org-infrastructure', 'constructor-research'],
}: {
  mayManage?: boolean;
  environments?: DeployEnvironment[];
  deployments?: Deployment[];
  environmentsError?: Error;
  /** The kits that apply to the organization. */
  kits?: string[];
} = {}) {
  calls.length = 0;
  for (const k of Object.keys(service)) delete service[k];
  const list: EnvironmentList = { items: environments, total: environments.length, may_manage: mayManage, open_clusters: { connection_ids: [] } };
  Object.assign(service, {
    installedKits: read('installedKits', { effective: kits.map((kit_slug) => ({ kit_slug, version: '1' })) }),
    environments: read('environments', environmentsError ?? list),
    connections: read('connections', {
      items: [conn({}), conn({ id: 'c-reg', provider: 'registry', label: 'ghcr', base_url: 'https://ghcr.io' })],
    }),
    deployments: read('deployments', { items: deployments, total: deployments.length }),
    tenantUsers: read('tenantUsers', { items: [] }),
    getWorkspaces: read('getWorkspaces', { items: [{ id: 'w1', name: 'Web' }] }),
    getProjects: read('getProjects', { items: [{ id: 'p1', name: 'Shop' }] }),
    testConnection: write('testConnection', {
      connection: conn({}),
      account: 'system:serviceaccount:studio-environments:deployer',
      checks: [{ name: 'create namespaces', ok: false, detail: 'forbidden' }],
    }),
    saveOpenClusters: write('saveOpenClusters', { connection_ids: ['c-k8s'] }),
    createEnvironment: write('createEnvironment', env({ id: 'e-new', name: 'stage' })),
    decideDeployment: write('decideDeployment', deployment({ state: 'queued' })),
    // A fixed mutation, not one per path: `api.createConnection.fetch(body)`.
    createConnection: write('createConnection', { connection: conn({ id: 'c-new', label: 'k8s.example.com' }), account: 'x' })(),
  });
}

const renderScreen = () => render(<InfrastructureScreen bridge={null} />);

describe('Organization › Infrastructure', () => {
  beforeEach(() => setUp());

  it('lays the environments out as the ladder a release climbs, and the places as cards', async () => {
    setUp({ environments: [env({ id: 'e-prod', name: 'prod', promote_from: 'e-dev', protected: true }), env({})] });
    renderScreen();
    const rungs = await screen.findAllByRole('listitem', { name: undefined });
    const ladder = rungs.filter((li) => li.hasAttribute('data-ladder-environment')).map((li) => li.getAttribute('data-ladder-environment'));
    expect(ladder).toEqual(['dev', 'prod']);
    expect(document.querySelector('[data-infra-count]')?.textContent).toContain('count_places_many 2');
    expect(document.querySelector('[data-infra-count]')?.textContent).toContain('count_environments_many 2');
    expect(document.querySelector('[data-place="main cluster"]')).not.toBeNull();
    expect(document.querySelector('[data-place="ghcr"][data-place-kind="registry"]')).not.toBeNull();
  });

  it('asks every cluster and registry once when it opens, and says what a cluster may not do', async () => {
    renderScreen();
    await waitFor(() => expect(calls.filter((c) => c.name === 'testConnection').map((c) => c.args[0])).toEqual(['c-k8s', 'c-reg']));
    const card = document.querySelector('[data-place="main cluster"]') as HTMLElement;
    await waitFor(() => expect(within(card).getByText(/may_not/).textContent).toContain('create namespaces'));
  });

  it('says the deploys waiting for a decision, and an administrator approves one', async () => {
    renderScreen();
    const chip = await screen.findByText('waiting_count_one 1');
    fireEvent.click(chip);
    const awaiting = await screen.findByText('waiting_title');
    expect(awaiting).toBeTruthy();
    fireEvent.click(screen.getByText('approve'));
    await waitFor(() => expect(calls.find((c) => c.name === 'decideDeployment')?.body).toEqual({ action: 'approve' }));
    expect(calls.find((c) => c.name === 'decideDeployment')?.args).toEqual(['o1', 'd1']);
  });

  it('declines only with a reason', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('waiting_count_one 1'));
    fireEvent.click(await screen.findByText('decline_open'));
    const decline = screen.getByText('decline').closest('button') as HTMLButtonElement;
    expect(decline.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('decline_reason'), { target: { value: 'not on Friday' } });
    fireEvent.click(decline);
    await waitFor(() =>
      expect(calls.find((c) => c.name === 'decideDeployment')?.body).toEqual({ action: 'decline', reason: 'not on Friday' })
    );
  });

  it('shows what runs where: the version that runs and the newest deploy beside it', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('tab_where'));
    const cell = await waitFor(() => {
      const c = document.querySelector('[data-runs-cell="Shop/dev"]');
      if (!c) throw new Error('no cell');
      return c as HTMLElement;
    });
    expect(cell.textContent).toContain('1.1.0');
    const prod = document.querySelector('[data-runs-cell="Shop/prod"]') as HTMLElement;
    expect(prod.textContent).toContain('nothing_runs_cell');
    expect(prod.textContent).toContain('1.2.0 · Waiting for approval');
  });

  it('adds an environment from the place it runs on', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('open_place {"name":"main cluster"}'));
    fireEvent.click(await screen.findByText('add_environment_here'));
    const form = document.querySelector('[data-environment-form]') as HTMLElement;
    expect(within(form).getByText('main cluster')).toBeTruthy();
    // Pressed with a name that makes no namespace: the model says why, nothing is sent.
    fireEvent.change(within(form).getByLabelText('field_name'), { target: { value: 'Stage!' } });
    fireEvent.click(within(form).getByText('add'));
    expect(await within(form).findByText(/Only lowercase letters/)).toBeTruthy();
    expect(calls.some((c) => c.name === 'createEnvironment')).toBe(false);
    fireEvent.change(within(form).getByLabelText('field_name'), { target: { value: 'stage' } });
    fireEvent.click(within(form).getByText('add'));
    await waitFor(() => expect(calls.find((c) => c.name === 'createEnvironment')).toBeTruthy());
    const sent = calls.find((c) => c.name === 'createEnvironment')!;
    expect(sent.args).toEqual(['o1']);
    expect(sent.body).toMatchObject({ name: 'stage', kind: 'kubernetes', connection_id: 'c-k8s' });
  });

  it('tests and removes an environment from its menu, asking first', async () => {
    Object.assign(service, {
      testEnvironment: write('testEnvironment', { message: 'reached the cluster as deployer' }),
      deleteEnvironment: write('deleteEnvironment', undefined),
    });
    renderScreen();
    fireEvent.click(await screen.findByLabelText('environment_actions {"name":"dev"}'));
    fireEvent.click(await screen.findByText('test'));
    expect(await screen.findByText('reached the cluster as deployer')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('environment_actions {"name":"dev"}'));
    fireEvent.click(await screen.findByText('remove'));
    expect(await screen.findByText('remove_confirm {"name":"dev"}')).toBeTruthy();
    expect(calls.some((c) => c.name === 'deleteEnvironment')).toBe(false);
    fireEvent.click(document.querySelector('[data-confirm]') as HTMLElement);
    await waitFor(() => expect(calls.find((c) => c.name === 'deleteEnvironment')?.args).toEqual(['o1', 'e-dev']));
    expect(await screen.findByText('removed {"name":"dev"}')).toBeTruthy();
  });

  it('reads what runs on a place from its cluster, on demand', async () => {
    Object.assign(service, {
      deploymentStatus: read('deploymentStatus', {
        deployment: deployment({ id: 'd0' }),
        workloads: [{ name: 'shop-api', ready: 1, desired: 2, images: ['ghcr.io/acme/shop/api:1.1.0'] }],
        hosts: ['shop.dev.acme.example'],
        problems: ['shop-api: ImagePullBackOff'],
      }),
    });
    renderScreen();
    fireEvent.click(await screen.findByLabelText('open_place {"name":"main cluster"}'));
    const panel = await waitFor(() => {
      const p = document.querySelector('[data-place-panel="cluster"]');
      if (!p) throw new Error('no panel');
      return p as HTMLElement;
    });
    expect(within(panel).getByText('runs_here')).toBeTruthy();
    fireEvent.click(within(panel).getByText('status_in {"place":"status_place_cluster"}'));
    expect(await within(panel).findByText('shop-api: ImagePullBackOff')).toBeTruthy();
    expect(within(panel).getByText('1/2')).toBeTruthy();
    expect(calls.find((c) => c.name === 'deploymentStatus')?.args).toEqual([{ organizationId: 'o1', id: 'd0' }]);
  });

  it('opens a cluster to projects as soon as it is switched', async () => {
    renderScreen();
    const card = await waitFor(() => {
      const c = document.querySelector('[data-place="main cluster"]');
      if (!c) throw new Error('no card');
      return c as HTMLElement;
    });
    fireEvent.click(await within(card).findByRole('switch'));
    await waitFor(() => expect(calls.find((c) => c.name === 'saveOpenClusters')?.body).toEqual({ connection_ids: ['c-k8s'] }));
  });

  it('connects a cluster with the bootstrap manifest at hand, reading the API server off a kubeconfig', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('add_place'));
    fireEvent.click(await screen.findByText('add_place_cluster'));
    const form = document.querySelector('[data-add-cluster]') as HTMLElement;
    expect(form.querySelector('[data-bootstrap-manifest]')?.textContent).toContain('kind: ServiceAccount');
    fireEvent.change(within(form).getByLabelText('kubeconfig_label'), {
      target: { value: 'apiVersion: v1\nclusters:\n- cluster:\n    server: https://k8s.example.com:6443\n' },
    });
    expect((within(form).getByLabelText('api_server') as HTMLInputElement).value).toBe('https://k8s.example.com:6443');
    fireEvent.click(within(form).getByText('test_connect'));
    await waitFor(() =>
      expect(calls.find((c) => c.name === 'createConnection')?.body).toMatchObject({
        provider: 'kubernetes',
        label: 'k8s.example.com',
        base_url: 'https://k8s.example.com:6443',
        scope: 'organization',
        owner_tenant_id: 'o1',
      })
    );
  });

  it('sends a member to Connections for a Research sign-in, which is their own', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('add_place'));
    fireEvent.click(await screen.findByText('add_place_research'));
    expect(openScreen).toHaveBeenCalledWith(null, '/connections');
  });

  it('sends an organization without the Constructor Research kit to its kits', async () => {
    openScreen.mockReset();
    setUp({ kits: ['org-infrastructure'] });
    renderScreen();
    await waitFor(() => expect(calls.some((c) => c.name === 'installedKits')).toBe(true));
    fireEvent.click(await screen.findByText('add_place'));
    fireEvent.click(await screen.findByText('add_place_research_kit'));
    expect(openScreen).toHaveBeenCalledWith(null, '/organization-kits');
    expect(openScreen).not.toHaveBeenCalledWith(null, '/connections');
  });

  it('offers no changes and no administrator tabs to a member who may not manage', async () => {
    setUp({ mayManage: false });
    renderScreen();
    await screen.findByText('tab_where');
    expect(screen.queryByText('add_place')).toBeNull();
    expect(screen.queryByText('tab_namespaces')).toBeNull();
    expect(document.querySelector('[data-environment-menu]')).toBeNull();
    fireEvent.click(screen.getByText('tab_where'));
    expect(await screen.findByText('admin_decides')).toBeTruthy();
  });

  it('says a backend without environments is one, not an error', async () => {
    setUp({ environmentsError: Object.assign(new Error('nope'), { response: { status: 404 } }) });
    renderScreen();
    expect(await screen.findByText('no_backend')).toBeTruthy();
  });
});
