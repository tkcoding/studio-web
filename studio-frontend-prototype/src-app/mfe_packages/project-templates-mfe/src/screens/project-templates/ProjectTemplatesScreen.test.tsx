import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { service, scope, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  scope: {
    org: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null,
    workspace: { id: 'w1', name: 'Platform' } as { id: string; name: string } | null,
  },
  calls: [] as { what: string; tenant?: string; body?: unknown }[],
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  return { useProjectTemplatesTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: scope.org, loading: false, failed: false }),
  useWorkspace: () => ({ workspace: scope.workspace, loading: false }),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { ProjectTemplatesScreen } from './ProjectTemplatesScreen';

const OWN_WS = { types: [{ key: 'svc', title: 'A service', description: 'One gear', repository: 'new' }] };
const OWN_ORG = { types: [{ key: 'lib', title: 'A library', description: '', tabs: ['overview', 'specs'] }] };

function serve({ ws = null as unknown, org = null as unknown, kits = [] as { slug: string; name: string }[] } = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    projectTypes: ({ tenantId }: { tenantId: string }) => ({
      fetch: () => Promise.resolve({ own: tenantId === 'w1' ? ws : org }),
    }),
    kits: { fetch: () => Promise.resolve({ items: kits, total: kits.length }) },
    putProjectTypes: (tenant: string) => ({
      fetch: (body: unknown) => (calls.push({ what: 'put', tenant, body }), Promise.resolve(body)),
    }),
    deleteProjectTypes: (tenant: string) => ({
      fetch: () => (calls.push({ what: 'delete', tenant }), Promise.resolve()),
    }),
  });
}

describe('ProjectTemplatesScreen', () => {
  beforeEach(() => {
    calls.length = 0;
    scope.org = { id: 'o1', name: 'Acme' };
    scope.workspace = { id: 'w1', name: 'Platform' };
    serve();
  });

  it('asks for a workspace when none is in scope', () => {
    scope.workspace = null;
    render(<ProjectTemplatesScreen />);
    expect(screen.getByText('no_workspace')).toBeTruthy();
  });

  it('shows the built-in templates when nobody set any, and stores nothing until saved', async () => {
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelectorAll('[data-template]').length).toBe(3));
    expect(document.querySelector('[data-template="new_gears"]')).toBeTruthy();
    expect(screen.getByText(/source_builtin/)).toBeTruthy();
    expect(screen.getByText('nothing_stored')).toBeTruthy();
    // The organization is where a first list goes.
    expect((document.querySelector('[data-template-target]') as HTMLSelectElement).value).toBe('organization');
    expect(document.querySelector('[data-template-drop]')).toBeNull();
  });

  it("reads the workspace's own list first, and saves it back to the workspace", async () => {
    serve({ ws: OWN_WS, org: OWN_ORG });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelector('[data-template="svc"]')).toBeTruthy());
    expect(document.querySelector('[data-template="lib"]')).toBeNull();
    expect(screen.getByText('source_workspace', { exact: false })).toBeTruthy();
    expect((document.querySelector('[data-template-target]') as HTMLSelectElement).value).toBe('workspace');
    fireEvent.click(document.querySelector('[data-template-save]')!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ what: 'put', tenant: 'w1', body: { types: [{ key: 'svc', repository: 'new' }] } });
    await waitFor(() => expect(screen.getByText('saved_workspace')).toBeTruthy());
  });

  it("falls back to the organization's list, and saves for the organization", async () => {
    serve({ org: OWN_ORG });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelector('[data-template="lib"]')).toBeTruthy());
    expect(screen.getByText(/source_organization/)).toBeTruthy();
    fireEvent.click(document.querySelector('[data-template-save]')!);
    await waitFor(() => expect(calls[0]).toMatchObject({ what: 'put', tenant: 'o1' }));
  });

  it("drops the workspace's own list so the inherited one applies", async () => {
    serve({ ws: OWN_WS });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelector('[data-template-drop]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-template-drop]')!);
    await waitFor(() => expect(calls[0]).toEqual({ what: 'delete', tenant: 'w1' }));
  });

  it('will not save a list the model refuses', async () => {
    serve({ ws: OWN_WS });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelector('[data-template="svc"]')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('field_title'), { target: { value: '  ' } });
    expect(document.querySelector('[data-template-problem]')?.textContent).toBe('Every template needs a title.');
    expect((document.querySelector('[data-template-save]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts from a preset, adds a template and offers none', async () => {
    serve({ ws: OWN_WS });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelector('[data-template="svc"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-template-preset="learning"]')!);
    expect(document.querySelector('[data-template="build-with-gears"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-template-add]')!);
    expect(document.querySelector('[data-template="new-template"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-template-none]')!);
    expect(document.querySelectorAll('[data-template]').length).toBe(0);
    expect(screen.getByText('none_offered')).toBeTruthy();
  });

  it('offers the catalogue kits to tick', async () => {
    serve({ ws: OWN_WS, kits: [{ slug: 'sdlc', name: 'SDLC' }] });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(document.querySelector('[data-template-kit="sdlc"]')).toBeTruthy());
    expect(screen.getByText('SDLC')).toBeTruthy();
  });

  it('says what went wrong when the list cannot be read', async () => {
    Object.assign(service, {
      projectTypes: () => ({ fetch: () => Promise.reject(new Error('boom')) }),
    });
    render(<ProjectTemplatesScreen />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
  });
});
