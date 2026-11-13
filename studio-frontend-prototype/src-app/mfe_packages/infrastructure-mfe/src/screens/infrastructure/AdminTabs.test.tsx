import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeployEnvironment } from '../../api/types';

const { service, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown[]; body?: unknown }[],
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { NamespaceAssignments, OrgRetention } from './Namespaces';
import { RegistryBrowser } from './RegistryBrowser';
import { InfraProvider, type Text } from './parts';

const t = ((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)) as Text;
t.count = (key: string, count: number) => `${key} ${count}`;

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

const wrap = (ui: React.ReactNode) =>
  render(
    <InfraProvider value={{ t, language: 'en', org: { id: 'o1', name: 'Acme' }, container: { current: null } }}>
      {ui}
    </InfraProvider>
  );

const dev: DeployEnvironment = {
  id: 'e-dev',
  name: 'dev',
  description: '',
  kind: 'kubernetes',
  connection_id: 'c1',
  registry: '',
  namespace_pattern: '{project}-{environment}',
  database: 'none',
  protected: false,
  updated_by: 'u1',
  updated_at: '',
};

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(service)) delete service[k];
});

describe('Namespaces', () => {
  it('assigns a project a namespace, offering the one its environment’s pattern names', async () => {
    Object.assign(service, {
      namespaceAssignments: read('namespaceAssignments', { items: [], total: 0 }),
      saveNamespaceAssignment: write('saveNamespaceAssignment', {
        project_id: 'p1',
        environment_id: 'e-dev',
        namespace: 'shop-dev',
      }),
    });
    wrap(<NamespaceAssignments environments={[dev]} projects={[{ id: 'p1', name: 'Shop' }]} people={new Map()} />);
    expect(await screen.findByText('no_assignments')).toBeTruthy();
    fireEvent.click(screen.getByText('assignment_add'));
    const form = document.querySelector('[data-assignment-form]') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('col_project'), { target: { value: 'p1' } });
    fireEvent.change(within(form).getByLabelText('col_environment'), { target: { value: 'e-dev' } });
    fireEvent.click(within(form).getByText(/use_suggestion/));
    fireEvent.click(within(form).getByText('save'));
    await waitFor(() =>
      expect(calls.find((c) => c.name === 'saveNamespaceAssignment')?.body).toEqual({
        project_id: 'p1',
        environment_id: 'e-dev',
        namespace: 'shop-dev',
        build_namespace: null,
      })
    );
    expect(await screen.findByText(/assignment_saved/)).toBeTruthy();
  });
});

describe('Image retention', () => {
  it('reads the organization’s retention and saves a new one; the model refuses a bad one', async () => {
    Object.assign(service, {
      imageRetention: read('imageRetention', { scope: 'organization', keep_last: 10, keep_days: null, inherited: false }),
      saveImageRetention: write('saveImageRetention', { scope: 'organization', keep_last: 5, keep_days: 30, inherited: false }),
    });
    wrap(<OrgRetention />);
    expect((await screen.findByText(/Keeps the newest 10 of each app/)).textContent).toContain("organization's setting");
    fireEvent.change(screen.getByLabelText('keep_last'), { target: { value: '0' } });
    expect(screen.getByText(/Keep from 1 to 1000/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('keep_last'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('keep_days'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(calls.find((c) => c.name === 'saveImageRetention')?.body).toEqual({ keep_last: 5, keep_days: 30 }));
    expect(await screen.findByText('saved')).toBeTruthy();
  });
});

describe('A registry’s contents', () => {
  it('opens a repository to its versions and keeps a running one from being deleted', async () => {
    Object.assign(service, {
      orgRegistries: read('orgRegistries', {
        items: [{ connection_id: 'r1', label: 'ghcr', host: 'ghcr.io', kind: 'ghcr', prefixes: ['ghcr.io/acme'], environments: [], role: 'push_pull' }],
      }),
      registryRepositories: read('registryRepositories', {
        items: [{ name: 'acme/shop/api', project_id: 'p1', project_name: 'Shop', recorded: 2 }],
      }),
      registryTags: read('registryTags', {
        items: [
          {
            digest: `sha256:${'a'.repeat(64)}`,
            tags: ['1.2.0'],
            image_id: 'i1',
            running_in: [{ environment_id: 'e-dev', environment_name: 'dev', deployment_id: 'd1', namespace: 'shop-dev', deployed_at: '' }],
          },
        ],
      }),
    });
    wrap(<RegistryBrowser connectionId="r1" />);
    expect((await screen.findByText(/ghcr.io\/acme/)).closest('[data-registry-role]')).not.toBeNull();
    fireEvent.click(await screen.findByText('acme/shop/api'));
    const version = await waitFor(() => {
      const v = document.querySelector('[data-registry-version]');
      if (!v) throw new Error('no version');
      return v as HTMLElement;
    });
    expect(within(version).getByText('1.2.0')).toBeTruthy();
    const del = within(version).getByText('delete').closest('button') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });
});
