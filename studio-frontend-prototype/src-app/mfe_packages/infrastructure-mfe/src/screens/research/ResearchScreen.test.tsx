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
  return {
    useInfrastructureTranslations: () => ({ t, loading: false }),
    useResearchTranslations: () => ({ t, loading: false }),
  };
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

import { ResearchScreen } from './ResearchScreen';

const read = (name: string, value: unknown) => (params?: unknown) => {
  calls.push({ name, args: [params] });
  return { fetch: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)) };
};
const write = (name: string, value: unknown) => (...args: unknown[]) => ({
  fetch: (body?: unknown) => {
    calls.push({ name, args, body });
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  },
});

const env = (patch: Partial<DeployEnvironment>): DeployEnvironment => ({
  id: 'e-r',
  name: 'demo',
  description: '',
  kind: 'research',
  connection_id: 'c-r',
  research_project: 'rp-1',
  research_hardware: 'cpu-small',
  registry: '',
  namespace_pattern: '{project}-{environment}',
  database: 'none',
  protected: false,
  updated_by: 'u1',
  updated_at: '2026-11-01T00:00:00Z',
  ...patch,
});

const signIn = (patch: Partial<Connection> = {}): Connection => ({
  id: 'c-r',
  owner_tenant_id: 'o1',
  provider: 'research',
  label: 'Constructor Research',
  account: 'ann@acme',
  base_url: 'https://research.example/api/platform-account/v1',
  scope: 'personal',
  secret_ref: '',
  created_at_epoch_secs: 0,
  mine: true,
  ...patch,
});

const deployment = (patch: Partial<Deployment>): Deployment => ({
  id: 'd1',
  project_id: 'p1',
  project_name: 'Shop',
  environment_id: 'e-r',
  environment_name: 'demo',
  profile: 'kubernetes',
  product: 'shop',
  images: [],
  namespace: 'shop-demo',
  chart_sha256: '',
  state: 'succeeded',
  requested_by: 'u1',
  requested_by_name: 'Ann',
  requested_at: '2026-11-08T10:00:00Z',
  ...patch,
});

function setUp({
  mayManage = true,
  environments = [env({}), env({ id: 'e-k', name: 'dev', kind: 'kubernetes', connection_id: 'c-k8s' })],
  connections = [signIn()],
  deployments = [deployment({})],
}: {
  mayManage?: boolean;
  environments?: DeployEnvironment[];
  connections?: Connection[];
  deployments?: Deployment[];
} = {}) {
  calls.length = 0;
  for (const k of Object.keys(service)) delete service[k];
  const list: EnvironmentList = {
    items: environments,
    total: environments.length,
    may_manage: mayManage,
    open_clusters: { connection_ids: [] },
  };
  Object.assign(service, {
    environments: read('environments', list),
    connections: read('connections', { items: connections }),
    deployments: read('deployments', { items: deployments, total: deployments.length }),
    tenantUsers: read('tenantUsers', { items: [] }),
    getWorkspaces: read('getWorkspaces', { items: [] }),
    getProjects: read('getProjects', { items: [{ id: 'p1', name: 'Shop' }] }),
    researchProjects: read('researchProjects', { items: [{ id: 'rp-1', name: 'Atlas' }] }),
    researchHardware: read('researchHardware', { items: [] }),
    testEnvironment: write('testEnvironment', { message: 'Research answers: project Atlas' }),
    createEnvironment: write('createEnvironment', env({ id: 'e-new', name: 'staging' })),
  });
}

const renderScreen = () => render(<ResearchScreen bridge={null} />);

describe('Organization › Constructor Research', () => {
  beforeEach(() => {
    openScreen.mockReset();
    setUp();
  });

  it('lists only the Research projects, each with what runs there', async () => {
    renderScreen();
    const place = await screen.findByText('demo');
    const card = place.closest('[data-research-place]') as HTMLElement;
    expect(card.getAttribute('data-research-place')).toBe('demo');
    expect(document.querySelector('[data-research-place="dev"]')).toBeNull();
    expect(within(card).getByText('rp-1')).toBeTruthy();
    expect(within(card).getByText('cpu-small')).toBeTruthy();
    expect(card.querySelector('[data-research-application="Shop"]')).not.toBeNull();
    // A running application can be asked for its status in Research.
    expect(card.querySelector('[data-deployment-status]')).not.toBeNull();
    expect(screen.getByText('count_running_one 1', { exact: false })).toBeTruthy();
  });

  it('walks a member who has not signed in to Connections first', async () => {
    setUp({ connections: [signIn({ scope: 'organization', mine: false })], environments: [], deployments: [] });
    renderScreen();
    const step = await waitFor(() => {
      const el = document.querySelector('[data-research-step="sign_in"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(step.getAttribute('data-step-state')).toBe('next');
    fireEvent.click(within(step).getByText('sign_in'));
    expect(openScreen).toHaveBeenCalledWith(null, '/connections');
    // No sign-in, no way to connect a project yet.
    expect(document.querySelector('[data-research-connect]')).toBeNull();
  });

  it('marks the steps done as an organization gets there', async () => {
    renderScreen();
    await screen.findByText('demo');
    const state = (s: string) => document.querySelector(`[data-research-step="${s}"]`)?.getAttribute('data-step-state');
    expect(state('sign_in')).toBe('done');
    expect(state('connect_project')).toBe('done');
    expect(state('deploy')).toBe('done');
    expect(screen.getByText('signed_in_as {"account":"ann@acme"}')).toBeTruthy();
  });

  it('connects a Research project with the environment form, set to Research', async () => {
    setUp({ environments: [], deployments: [] });
    renderScreen();
    const connect = await waitFor(() => {
      const el = document.querySelector('[data-research-connect]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(connect);
    const form = await waitFor(() => {
      const el = document.querySelector('[data-research-form]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // The form starts on the member's sign-in and asks Research for its projects.
    await waitFor(() => expect(calls.some((c) => c.name === 'researchProjects')).toBe(true));
    expect(calls.find((c) => c.name === 'researchProjects')?.args[0]).toMatchObject({
      organizationId: 'o1',
      connectionId: 'c-r',
    });
    expect(form).toBeTruthy();
  });

  it('tests a Research environment for an administrator, and offers no changes to a member', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('test'));
    expect(await screen.findByText('Research answers: project Atlas')).toBeTruthy();
    expect(calls.find((c) => c.name === 'testEnvironment')?.args).toEqual(['o1', 'e-r']);

    setUp({ mayManage: false });
    const { container } = renderScreen();
    await within(container).findAllByText('demo');
    expect(container.querySelector('[data-research-test]')).toBeNull();
    expect(container.querySelector('[data-research-connect]')).toBeNull();
  });

  it('opens Infrastructure, where Research projects are places too', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('open_infrastructure'));
    expect(openScreen).toHaveBeenCalledWith(null, '/infrastructure');
  });
});
