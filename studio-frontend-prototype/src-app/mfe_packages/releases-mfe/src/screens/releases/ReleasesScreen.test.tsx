import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openScreen } from '@constructor-studio/mfe-shared';
import type { DeployEnvironment, Deployment, ProjectPath, ProjectTargets } from '../../api/types';

const { service, calls, scope } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown[]; body?: unknown }[],
  scope: { project: 'p1' as string | null },
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key}_${count === 1 ? 'one' : 'many'} ${count}`;
  return { useReleasesTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  openScreen: vi.fn(),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useSharedProperty: () => scope.project,
}));

import { ReleasesScreen } from './ReleasesScreen';

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

const deployment = (patch: Partial<Deployment>): Deployment => ({
  id: 'd1',
  project_id: 'p1',
  project_name: 'Shop',
  environment_id: 'e-dev',
  environment_name: 'dev',
  profile: 'prod',
  product: 'shop',
  build: 'studio-2',
  images: [],
  namespace: 'shop-dev',
  chart_sha256: '',
  chart_ref: 'oci://ghcr.io/acme/charts/shop',
  chart_version: '0.2.0',
  state: 'succeeded',
  requested_by: 'u2',
  requested_by_name: 'Ann',
  requested_at: '2026-11-08T10:00:00Z',
  ...patch,
});

const buildNode = (id: string, v: Record<string, unknown>) => ({ type_id: 'build', instance_id: id, value: v });

/** The path the server answers: the product composed, built, published, ready for dev. */
const readyPath = (patch: Partial<ProjectPath> = {}): ProjectPath => ({
  organization_id: 'o1',
  current: 'running',
  environment_id: 'e-dev',
  steps: [
    { id: 'product', state: 'done', reason: 'The product is described (revision 3).', checklist: [] },
    { id: 'build', state: 'done', reason: 'Build studio-2 passed.', checklist: [], build_id: 'studio-2' },
    { id: 'image', state: 'done', reason: '0.2.0 is published with 1 image(s).', checklist: [] },
    { id: 'environment', state: 'done', reason: 'dev is ready for a deploy.', checklist: [] },
    {
      id: 'running',
      state: 'next',
      reason: 'Nothing is deployed yet.',
      checklist: [],
      action: { kind: 'deploy', label: 'Deploy', environment_id: 'e-dev' },
    },
  ],
  running_in: [],
  research_kit: false,
  ...patch,
});

function setUp({ deployments, path }: { deployments?: Deployment[]; path?: ProjectPath } = {}) {
  calls.length = 0;
  for (const k of Object.keys(service)) delete service[k];
  const targets: ProjectTargets = {
    organization_id: 'o1',
    project_name: 'Shop',
    environments: [
      { environment: env({}), namespace: 'shop-dev' },
      { environment: env({ id: 'e-prod', name: 'prod', promote_from: 'e-dev', protected: true }), namespace: 'shop-prod' },
    ],
    bindings: [{ profile: 'prod', environment_id: 'e-dev' }],
    secrets: [],
  };
  const builds = [
    buildNode('n2', {
      build_id: 'studio-2',
      where: 'studio',
      status: 'passed',
      product: 'shop',
      started_at: '2026-11-08T09:00:00Z',
      finished_at: '2026-11-08T09:10:00Z',
      chart: { reference: 'oci://ghcr.io/acme/charts/shop', version: '0.2.0' },
    }),
    buildNode('n3', {
      build_id: 'desktop-3',
      where: 'desktop',
      status: 'failed',
      product: 'shop',
      started_at: '2026-11-09T09:00:00Z',
      failure: 'gear `billing` does not compile',
      failure_step: 'images',
    }),
  ];
  Object.assign(service, {
    targets: read('targets', targets),
    deployments: read('deployments', { items: deployments ?? [deployment({})], total: 1 }),
    nodes: (params: { type: string }) => {
      calls.push({ name: 'nodes', args: [params] });
      const page = params.type === 'build' ? { nodes: builds } : { nodes: [] };
      return { fetch: () => Promise.resolve(page) };
    },
    connections: read('connections', { items: [] }),
    environments: read('environments', { items: [], total: 0, may_manage: true }),
    tenantUsers: read('tenantUsers', { items: [] }),
    projectConfig: read('projectConfig', { value: {} }),
    createDeployment: write('createDeployment', deployment({ id: 'd9', state: 'awaiting_approval' })),
    productDescription: read('productDescription', { latest: null }),
    saveBindings: write('saveBindings', { items: [], total: 0 }),
    projectPath: read('projectPath', path ?? readyPath()),
    specPlan: read('specPlan', { items: [{}, {}], total: 2 }),
    deployment: read('deployment', deployment({})),
    deploymentLogs: read('deploymentLogs', { containers: [] }),
    myResearchProjects: read('myResearchProjects', { connection_id: 'c-research', items: [{ id: 'rp', name: 'ML team' }], total: 1 }),
    myResearchHardware: read('myResearchHardware', { items: [{ id: 'gpu', name: 'GPU', trial: true }], total: 1 }),
    createProjectEnvironment: write('createProjectEnvironment', env({ id: 'e-research', name: 'Research ML team', kind: 'research', research_project: 'rp' })),
    startBuild: write('startBuild', { build_id: 'research-7', run_id: 'r7', namespace: 'shop' }),
  });
}

describe('ReleasesScreen', () => {
  beforeEach(() => {
    scope.project = 'p1';
    try {
      window.localStorage.clear();
    } catch {
      // No storage: the tab is the next step's.
    }
    setUp();
  });
  afterEach(() => vi.clearAllMocks());

  it('asks for a project when none is open', () => {
    scope.project = null;
    render(<ReleasesScreen bridge={null} />);
    expect(screen.getByText('no_project')).toBeTruthy();
  });

  it('opens on Deploy with the ladder: what runs where, and Promote to the next rung', async () => {
    render(<ReleasesScreen bridge={null} />);
    expect(await screen.findByText('0.2.0 runs in dev')).toBeTruthy();
    const dev = document.querySelector('[data-ladder-step="dev"]');
    expect(dev?.getAttribute('data-ladder-state')).toBe('runs');
    const prod = document.querySelector('[data-ladder-step="prod"]');
    expect(prod?.getAttribute('data-ladder-state')).toBe('empty');
    // prod takes from dev, which runs studio-2: Promote installs it.
    const promote = document.querySelector('[data-ladder-promote]') as HTMLElement;
    expect(promote.textContent).toContain('0.2.0');
    fireEvent.click(promote);
    await waitFor(() => expect(calls.some((c) => c.name === 'createDeployment')).toBe(true));
    const asked = calls.find((c) => c.name === 'createDeployment');
    expect(asked?.args).toEqual(['p1']);
    expect(asked?.body).toEqual({ environment_id: 'e-prod', build: 'studio-2' });
    // A protected environment answers "waiting for an administrator".
    expect(await screen.findByText(/asked_waits/)).toBeTruthy();
  });

  it('asks before an uninstall and sends it only on confirm', async () => {
    render(<ReleasesScreen bridge={null} />);
    await screen.findByText('0.2.0 runs in dev');
    const deployButtons = document.querySelectorAll('[data-ladder-deploy]');
    fireEvent.click(deployButtons[0] as HTMLElement);
    fireEvent.click(await waitFor(() => document.querySelector('[data-deploy-uninstall]') as HTMLElement));
    expect(await screen.findByText(/uninstall_title/)).toBeTruthy();
    expect(calls.some((c) => c.name === 'createDeployment')).toBe(false);
    fireEvent.click(document.querySelector('[data-confirm]') as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.name === 'createDeployment')).toBe(true));
    expect(calls.find((c) => c.name === 'createDeployment')?.body).toEqual({
      environment_id: 'e-dev',
      product: 'shop',
      profile: 'prod',
      action: 'uninstall',
    });
  });

  it('binds a profile to an environment under the ladder, keeping the others', async () => {
    render(<ReleasesScreen bridge={null} />);
    await screen.findByText('0.2.0 runs in dev');
    const prod = document.querySelector('[data-binding-environment="prod"] select') as HTMLSelectElement;
    fireEvent.change(prod, { target: { value: 'prod' } });
    fireEvent.click(document.querySelector('[data-bindings-save]') as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.name === 'saveBindings')).toBe(true));
    const saved = calls.find((c) => c.name === 'saveBindings');
    expect(saved?.args).toEqual(['p1']);
    expect(saved?.body).toEqual({
      items: [
        { profile: 'prod', environment_id: 'e-dev' },
        { profile: 'prod', environment_id: 'e-prod' },
      ],
    });
  });

  it('lists the builds on Build: the newest open, a failed one with whose it is to fix', async () => {
    setUp({ deployments: [] });
    render(<ReleasesScreen bridge={null} />);
    await screen.findByText('status_deploy_newest');
    fireEvent.click(document.querySelector('[data-release-tab="build"]') as HTMLElement);
    const failed = await waitFor(() => {
      const card = document.querySelector('[data-build-card="desktop-3"]');
      if (!card) throw new Error('not yet');
      return card;
    });
    expect(failed.querySelector('[data-build-cause="gear"]')?.textContent).toContain('Gear billing fails');
    expect(document.querySelectorAll('[data-product-build]').length).toBe(2);
  });

  describe('the path to running (#1050)', () => {
    it('shows every step from Specs to Running, the current one open with its action', async () => {
      render(<ReleasesScreen bridge={null} />);
      const path = await waitFor(() => {
        const p = document.querySelector('[data-project-path]');
        if (!p) throw new Error('not yet');
        return p;
      });
      const steps = [...path.querySelectorAll('[data-path-step]')].map((s) => s.getAttribute('data-path-step'));
      expect(steps).toEqual(['specs', 'product', 'build', 'image', 'environment', 'running']);
      expect(path.querySelector('[data-path-step="specs"]')?.getAttribute('data-path-state')).toBe('done');
      expect(path.getAttribute('data-path-current')).toBe('running');
      expect(path.querySelector('[data-path-reason]')?.textContent).toBe('Nothing is deployed yet.');
      // Its action opens the one deploy dialog on dev.
      fireEvent.click(path.querySelector('[data-path-action="deploy"]') as HTMLElement);
      const dialog = await waitFor(() => {
        const d = document.querySelector('[data-deploy-dialog]');
        if (!d) throw new Error('not yet');
        return d;
      });
      expect(dialog.querySelector('[data-deploy-target="e-dev"]')?.getAttribute('data-deploy-target-focused')).toBe('true');
    });

    it('a project without a product is sent to compose one', async () => {
      setUp({
        path: readyPath({
          current: 'product',
          steps: [
            { id: 'product', state: 'next', reason: 'The project has no product yet.', checklist: [], action: { kind: 'open_product', label: '' } },
            { id: 'build', state: 'later', reason: 'Waits for the product.', checklist: [] },
          ],
        }),
      });
      render(<ReleasesScreen bridge={null} />);
      const button = await waitFor(() => {
        const b = document.querySelector('[data-path-open="product"] [data-path-action="open_product"]');
        if (!b) throw new Error('not yet');
        return b as HTMLElement;
      });
      fireEvent.click(button);
      expect(openScreen).toHaveBeenCalledWith(null, '/product');
    });

    it('a failed build names its gear and its cause leads to the gear', async () => {
      setUp({
        path: readyPath({
          current: 'build',
          steps: [
            { id: 'product', state: 'done', reason: '', checklist: [] },
            {
              id: 'build',
              state: 'failed',
              reason: 'Build b3 failed: Gear billing did not build.',
              checklist: [],
              build_id: 'b3',
              cause: {
                code: 'GEAR_BUILD_FAILED',
                summary: 'Gear billing did not build.',
                gear: 'billing',
                lines: ['error: gear `billing` · help: currency is required'],
                actions: [
                  { kind: 'open_gear', label: 'Open the gear', gear: 'billing' },
                  { kind: 'retry', label: 'Build again' },
                ],
              },
            },
          ],
        }),
      });
      render(<ReleasesScreen bridge={null} />);
      const cause = await waitFor(() => {
        const c = document.querySelector('[data-path-open="build"] [data-failure-cause="GEAR_BUILD_FAILED"]');
        if (!c) throw new Error('not yet');
        return c;
      });
      expect(cause.textContent).toContain('gear `billing`');
      fireEvent.click(cause.querySelector('[data-path-action="open_gear"]') as HTMLElement);
      expect(openScreen).toHaveBeenCalledWith(null, '/product');
    });

    it('a missing secret is a checklist item before any deploy', async () => {
      setUp({
        path: readyPath({
          current: 'environment',
          steps: [
            {
              id: 'environment',
              state: 'blocked',
              reason: '1 thing is missing before a deploy to dev.',
              environment_id: 'e-dev',
              checklist: [
                { code: 'PROFILE_BOUND', text: 'A profile is bound to dev.', done: true },
                {
                  code: 'SECRET',
                  text: 'The product needs the secret SMTP_PASSWORD in dev.',
                  done: false,
                  action: { kind: 'provide_secret', label: 'Provide it', key: 'SMTP_PASSWORD', environment_id: 'e-dev' },
                },
              ],
              action: { kind: 'provide_secret', label: 'Provide it', key: 'SMTP_PASSWORD', environment_id: 'e-dev' },
            },
          ],
        }),
      });
      render(<ReleasesScreen bridge={null} />);
      const missing = await waitFor(() => {
        const m = document.querySelector('[data-path-checklist] [data-check="SECRET"]');
        if (!m) throw new Error('not yet');
        return m;
      });
      expect(missing.getAttribute('data-check-done')).toBeNull();
      expect(missing.textContent).toContain('SMTP_PASSWORD');
      // Provide it opens the environment's configuration on Deploy.
      fireEvent.click(missing.querySelector('[data-path-action="provide_secret"]') as HTMLElement);
      await waitFor(() => expect(document.querySelector('[data-step="deploy"]')).toBeTruthy());
    });

    it('a project running in an environment is done and opens its application', async () => {
      setUp({
        path: readyPath({
          steps: [
            {
              id: 'running',
              state: 'done',
              reason: 'Runs in Research at https://shop.example.',
              checklist: [],
              url: 'https://shop.example',
              action: { kind: 'open_app', label: 'Open the application', url: 'https://shop.example' },
            },
          ],
          running_in: [{ environment_id: 'e-r', environment_name: 'Research', url: 'https://shop.example' }],
        }),
      });
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      render(<ReleasesScreen bridge={null} />);
      const button = await waitFor(() => {
        const b = document.querySelector('[data-path-action="open_app"]');
        if (!b) throw new Error('not yet');
        return b as HTMLElement;
      });
      expect(document.querySelector('[data-path-step="running"]')?.getAttribute('data-path-state')).toBe('done');
      fireEvent.click(button);
      expect(opened).toHaveBeenCalledWith('https://shop.example', '_blank', 'noopener,noreferrer');
    });
  });

  describe('Deploy to… (#1053)', () => {
    const openDialog = async () => {
      render(<ReleasesScreen bridge={null} />);
      fireEvent.click(
        await waitFor(() => {
          const b = document.querySelector('[data-deploy-to]');
          if (!b) throw new Error('not yet');
          return b as HTMLElement;
        })
      );
      return waitFor(() => {
        const d = document.querySelector('[data-deploy-dialog]');
        if (!d) throw new Error('not yet');
        return d;
      });
    };

    it('lists the environments and no Research target without the kit', async () => {
      const dialog = await openDialog();
      expect(dialog.querySelectorAll('[data-deploy-target]').length).toBe(2);
      expect(dialog.querySelector('[data-deploy-target-research]')).toBeNull();
      expect(calls.some((c) => c.name === 'myResearchProjects')).toBe(false);
    });

    it("with the kit offers the caller's Research projects and builds there", async () => {
      setUp({ path: readyPath({ research_kit: true, research: { state: 'signed_in', connection_id: 'c-research' } }) });
      const dialog = await openDialog();
      const research = await waitFor(() => {
        const r = dialog.querySelector('[data-deploy-target-research]');
        if (!r?.querySelector('[data-research-run]')) throw new Error('not yet');
        return r;
      });
      expect(research.querySelector('[data-research-sign-in]')?.getAttribute('data-research-sign-in')).toBe('signed_in');
      await waitFor(() => expect(research.textContent).toContain('GPU'));
      fireEvent.click(research.querySelector('[data-research-run]') as HTMLElement);
      await waitFor(() => expect(calls.some((c) => c.name === 'startBuild')).toBe(true));
      expect(calls.find((c) => c.name === 'createProjectEnvironment')?.body).toMatchObject({
        kind: 'research',
        connection_id: 'c-research',
        research_project: 'rp',
      });
      expect(calls.find((c) => c.name === 'startBuild')?.body).toEqual({ environment_id: 'e-research' });
      expect(await waitFor(() => research.querySelector('[data-research-build="research-7"]'))).toBeTruthy();
    });

    it('asks to sign in when the Research sign-in ran out', async () => {
      setUp({ path: readyPath({ research_kit: true, research: { state: 'expired', days_left: 0 } }) });
      const dialog = await openDialog();
      const research = await waitFor(() => {
        const r = dialog.querySelector('[data-deploy-target-research]');
        if (!r) throw new Error('not yet');
        return r as HTMLElement;
      });
      expect(research.querySelector('[data-research-sign-in]')?.getAttribute('data-research-sign-in')).toBe('expired');
      expect(research.querySelector('[data-research-run]')).toBeNull();
      expect(calls.some((c) => c.name === 'myResearchProjects')).toBe(false);
    });
  });

  describe('a deploy the address names (#1054)', () => {
    afterEach(() => window.history.replaceState(null, '', '/'));

    it('opens that deploy with its cause and log, as the Inbox links it', async () => {
      const id = '0b1f5c2a-6f0e-4d7e-9a43-2f5e8c1d9b10';
      setUp();
      service.deployment = read(
        'deployment',
        deployment({
          id,
          state: 'failed',
          research: true,
          outcome: 'the Constructor Research connection cannot be used: invalid_grant',
          cause: {
            code: 'RESEARCH_SIGN_IN_EXPIRED',
            summary: 'Your sign-in ran out.',
            lines: ['invalid_grant'],
            actions: [{ kind: 'sign_in', label: 'Sign in again' }],
          },
        })
      );
      window.history.replaceState(null, '', `/?screen=releases;org=o1;project=p1&deployment=${id}`);
      render(<ReleasesScreen bridge={null} />);
      const detail = await waitFor(() => {
        const d = document.querySelector(`[data-deployment-detail="${id}"] [data-failure-cause]`);
        if (!d) throw new Error('not yet');
        return d;
      });
      expect(detail.getAttribute('data-failure-cause')).toBe('RESEARCH_SIGN_IN_EXPIRED');
      expect(calls.find((c) => c.name === 'deployment')?.args).toEqual([{ projectId: 'p1', id }]);
      fireEvent.click(detail.querySelector('[data-path-action="sign_in"]') as HTMLElement);
      expect(openScreen).toHaveBeenCalledWith(null, '/connections');
    });
  });
});
