import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { service, org, shared, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  shared: { workspace: null as unknown, project: null as unknown },
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  useStudioEventRefresh: () => undefined,
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useSharedProperty: (id: string) =>
    id.includes('.workspace.selected.') ? shared.workspace : id.includes('.project.selected.') ? shared.project : undefined,
}));

import { ModelScreen, modelLevelOf } from './ModelScreen';

/** An error the API client throws for an answer with `status`. */
const refusal = (status: number, detail = 'refused') =>
  Object.assign(new Error(detail), { response: { status, data: { detail } } });

const ontology = {
  entities: [
    { id: 'system-object', bucket: 'system-primitives', properties: [{ name: 'tenant_id', type: 'TenantId' }] },
    { id: 'entity', extends: 'system-object', properties: [{ name: 'id', type: 'EntityId' }] },
    {
      id: 'workspace',
      name: 'Workspace',
      extends: 'entity',
      properties: [
        { name: 'name', type: 'string' },
        { name: 'cost_centre', type: 'string' },
        { name: 'phase', type: 'idea | build' },
        { name: 'projects', type: 'Project', relation: 'project', extends: 'edge', relationType: 'shows', relationLabel: 'Projects' },
        { name: 'vendors', type: 'Vendor', relation: 'vendor', extends: 'edge', relationType: 'shows', relationLabel: 'Vendors' },
        { name: 'ghosts', type: 'Ghost', relation: 'ghost', extends: 'edge', relationType: 'shows', relationLabel: 'Ghosts' },
      ],
    },
    { id: 'project', name: 'Project', extends: 'entity' },
    { id: 'person', name: 'Person', extends: 'entity', properties: [{ name: 'name', type: 'string' }] },
    {
      id: 'vendor',
      name: 'Vendor',
      extends: 'entity',
      properties: [
        { name: 'name', type: 'string' },
        { name: 'rating', type: 'number' },
        { name: 'contact', type: 'Person', relation: 'person', extends: 'edge', relationType: 'references', relationLabel: 'Contact' },
      ],
    },
  ],
};

type Answer = unknown | ((body: unknown) => unknown);

function serve({ query, mutate, types }: { query?: Answer; mutate?: Answer; types?: unknown } = {}) {
  for (const key of Object.keys(service)) delete service[key];
  const answer = (what: string, a: Answer) => (arg?: unknown) => ({
    fetch: (body?: unknown) => {
      calls.push({ what, arg, body });
      const value = typeof a === 'function' ? (a as (b: unknown) => unknown)(body) : a;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    },
  });
  Object.assign(service, {
    types: answer('types', types ?? { ontology, can_edit_model: false }),
    query: answer('query', query ?? { items: [], total: 0, complete: true }),
    mutate: answer('mutate', mutate ?? { results: [] }),
    getTenant: answer('getTenant', { id: 'p1', name: 'Apollo' }),
  });
}

const queries = () => calls.filter((c) => c.what === 'query').map((c) => c.body as Record<string, unknown>);
const last = () => queries()[queries().length - 1];

beforeEach(() => {
  calls.length = 0;
  org.value = { id: 'o1', name: 'Acme' };
  shared.workspace = { id: 'w1', name: 'Platform' };
  shared.project = null;
});
afterEach(() => cleanup());

describe('the level a generic screen stands for', () => {
  it('is in the id of the extension the shell mounted', () => {
    const id = (leaf: string) =>
      `gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~constructor_studio.screensets.layout.leveled_screen.v1~constructor_studio.admin.screens.${leaf}.v1`;
    expect(modelLevelOf(id('model_organization'))).toBe('organization');
    expect(modelLevelOf(id('model_workspace_types'))).toBe('workspace');
    expect(modelLevelOf(id('model_project'))).toBe('project');
    expect(modelLevelOf(id('connections'))).toBeNull();
    expect(modelLevelOf(undefined)).toBeNull();
  });
});

describe('a tab the Studio domain model adds (type:<name>)', () => {
  const rows = [
    { id: 'v1', entity: 'vendor', value: { name: 'Initech', rating: 4 } },
    { id: 'v2', entity: 'vendor', value: { name: 'Globex', rating: 5, legacy_code: 'G-1' } },
  ];

  it('lists the objects of its target in this workspace, with the type’s fields as columns', async () => {
    serve({ query: { items: rows, total: 2, complete: true } });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    expect(await screen.findByText('Initech')).toBeTruthy();
    expect(screen.getByText('Vendors')).toBeTruthy();
    const headers = Array.from(document.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers).toEqual(['name', 'rating']);
    expect(queries()[0]).toEqual({ type: 'vendor', project_id: 'w1', limit: 50 });
    expect(calls.find((c) => c.what === 'query')?.arg).toBe('o1');
  });

  it('reads the whole organization on the organization', async () => {
    serve({
      types: {
        can_edit_model: false,
        ontology: {
          entities: ontology.entities.map((e) =>
            e.id === 'workspace' ? { ...e, id: 'organization' } : e
          ),
        },
      },
    });
    render(<ModelScreen level="organization" section="type:vendors" />);
    await screen.findByText('model_empty');
    expect(queries()[0]).toEqual({ type: 'vendor', limit: 50 });
  });

  it('sorts by a column header: ascending, then descending, then the gear’s order', async () => {
    serve({ query: { items: rows, total: 2, complete: true } });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    await screen.findByText('Initech');
    const header = () => screen.getByRole('button', { name: /^rating/ });
    fireEvent.click(header());
    await waitFor(() => expect(last()?.order_by).toEqual([{ field: 'rating', direction: 'asc' }]));
    expect(header().closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(header());
    await waitFor(() => expect(last()?.order_by).toEqual([{ field: 'rating', direction: 'desc' }]));
    fireEvent.click(header());
    await waitFor(() => expect(last()?.order_by).toBeUndefined());
  });

  it('says so when there is nothing, and when the caller may not read them', async () => {
    serve();
    render(<ModelScreen level="workspace" section="type:vendors" />);
    expect(await screen.findByText('model_empty')).toBeTruthy();
    cleanup();
    serve({ query: refusal(403) });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    expect(await screen.findByText('model_forbidden')).toBeTruthy();
    expect(screen.queryByText('model_empty')).toBeNull();
  });

  it('pages through the objects, and a new sort starts again from the first page', async () => {
    serve({ query: { items: rows, total: 120, complete: true } });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    await screen.findByText('Initech');
    const previous = () => screen.getByRole('button', { name: 'model_previous' }) as HTMLButtonElement;
    const next = () => screen.getByRole('button', { name: 'model_next' }) as HTMLButtonElement;
    expect(previous().disabled).toBe(true);
    fireEvent.click(next());
    await waitFor(() => expect(last()).toEqual({ type: 'vendor', project_id: 'w1', limit: 50, offset: 50 }));
    expect(previous().disabled).toBe(false);
    fireEvent.click(next());
    await waitFor(() => expect(last()?.offset).toBe(100));
    expect(next().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^rating/ }));
    await waitFor(() => expect(last()?.order_by).toEqual([{ field: 'rating', direction: 'asc' }]));
    expect(last()?.offset ?? 0).toBe(0);
  });

  it('says a type left dormant, or not installed here, is not in use — not a failure, nothing offered', async () => {
    const dormant = Object.assign(new Error('Request failed with status code 400'), {
      response: {
        status: 400,
        data: { context: { violations: [{ type: 'DOMAIN_TYPE_DORMANT', subject: 'vendor-kit', description: 'dormant' }] } },
      },
    });
    serve({ query: dormant });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    await waitFor(() => expect(document.querySelector('[data-model-type-absent="dormant"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('model_empty')).toBeNull();
    cleanup();
    serve({ query: refusal(404, 'DOMAIN_TYPE_NOT_INSTALLED:vendor-kit') });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    await waitFor(() => expect(document.querySelector('[data-model-type-absent="not_installed"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows another failure in the gear’s own words', async () => {
    serve({ query: refusal(500, 'the read model is filling') });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('model_forbidden')).toBeNull();
  });

  it('says when the tab left the model, or reaches a type it does not define', async () => {
    serve();
    render(<ModelScreen level="workspace" section="type:gone" />);
    expect(await screen.findByText('model_tab_gone')).toBeTruthy();
    cleanup();
    render(<ModelScreen level="workspace" section="type:ghosts" />);
    expect(await screen.findByText('model_tab_unknown_type')).toBeTruthy();
    expect(queries()).toEqual([]);
  });

  it('opens a row on its card: its fields, what the model no longer declares, and a relation read when asked', async () => {
    serve({
      query: (body: unknown) =>
        (body as { include?: unknown }).include
          ? {
              items: [
                {
                  id: 'v2',
                  entity: 'vendor',
                  value: {},
                  relations: { contact: { items: [{ id: 'pp1', entity: 'person', value: { name: 'Ada' } }], total: 1, complete: true } },
                },
              ],
              total: 1,
              complete: true,
            }
          : { items: rows, total: 2, complete: true },
    });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    fireEvent.click(await screen.findByText('Globex'));
    expect(screen.getByRole('heading', { name: 'Globex' })).toBeTruthy();
    expect(screen.getByText('legacy code')).toBeTruthy();
    expect(screen.getByText('Contact')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'model_show_related' }));
    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(last()).toEqual({ type: 'vendor', where: { id: { _eq: 'v2' } }, limit: 1, include: { contact: { limit: 20 } } });
    fireEvent.click(document.querySelector('[data-model-back]') as HTMLElement);
    expect(await screen.findByText('Initech')).toBeTruthy();
  });

  it('says the model could not be read rather than drawing nothing', async () => {
    serve({ types: refusal(503, 'down') });
    render(<ModelScreen level="workspace" section="type:vendors" />);
    expect(await screen.findByText('model_unreadable')).toBeTruthy();
  });
});

describe('the Attributes card', () => {
  it('shows what is recorded about the workspace, its name from the tenant', async () => {
    serve({ query: { items: [{ id: 'self-1', entity: 'workspace', value: { cost_centre: 'CC-7' } }], total: 1, complete: true } });
    render(<ModelScreen level="workspace" section="attributes" />);
    expect(await screen.findByText('CC-7')).toBeTruthy();
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(queries()[0]).toEqual({ type: 'workspace', project_id: 'w1', where: { tenant_id: { _eq: 'w1' } }, limit: 1 });
  });

  it('patches the object it found with what was changed, and the tenant’s name the first time', async () => {
    serve({ query: { items: [{ id: 'self-1', entity: 'workspace', value: { cost_centre: 'CC-7' } }], total: 1, complete: true } });
    render(<ModelScreen level="workspace" section="attributes" />);
    await screen.findByText('CC-7');
    fireEvent.click(document.querySelector('[data-attributes-edit]') as HTMLElement);
    fireEvent.change(document.getElementById('attr-cost_centre') as HTMLInputElement, { target: { value: 'CC-8' } });
    fireEvent.click(document.querySelector('[data-attributes-save]') as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.what === 'mutate')).toBe(true));
    expect(calls.find((c) => c.what === 'mutate')?.body).toEqual({
      // `name` is the workspace's own (account-management), written so lists can show it.
      operations: [{ op: 'patch', id: 'self-1', set: { name: 'Platform', cost_centre: 'CC-8' }, unset: [] }],
    });
  });

  it('creates the project’s self object the first time, with the project’s name read from the tenant', async () => {
    shared.project = 'p1';
    const projectModel = {
      can_edit_model: false,
      ontology: {
        entities: [
          ...ontology.entities.filter((e) => e.id !== 'project'),
          { id: 'project', name: 'Project', extends: 'entity', properties: [{ name: 'name', type: 'string' }, { name: 'phase', type: 'idea | build' }] },
        ],
      },
    };
    serve({ types: projectModel });
    render(<ModelScreen level="project" section="attributes" />);
    expect(await screen.findByText('Apollo')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-attributes-edit]') as HTMLElement);
    fireEvent.change(document.getElementById('attr-phase') as HTMLSelectElement, { target: { value: 'build' } });
    fireEvent.click(document.querySelector('[data-attributes-save]') as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.what === 'mutate')).toBe(true));
    expect(calls.find((c) => c.what === 'mutate')?.body).toEqual({
      operations: [
        { op: 'upsert', type: 'project', key: 'self', project_id: 'p1', value: { name: 'Apollo', phase: 'build', tenant_id: 'p1' } },
      ],
    });
  });

  it('says nothing is recorded yet, and that the model has no such type', async () => {
    serve({ types: { can_edit_model: false, ontology: { entities: ontology.entities.filter((e) => e.id !== 'workspace') } } });
    render(<ModelScreen level="workspace" section="attributes" />);
    expect(await screen.findByText('model_attributes_no_type')).toBeTruthy();
    // Only who may change the model is offered to make the type.
    expect(document.querySelector('[data-attributes-create-type]')).toBeNull();
    cleanup();
    shared.workspace = { id: 'w1', name: '' };
    serve();
    // No name to show from the tenant either.
    service.getTenant = () => ({ fetch: () => Promise.reject(refusal(404)) });
    render(<ModelScreen level="workspace" section="attributes" />);
    expect(await screen.findByText('model_nothing_recorded')).toBeTruthy();
  });

  it('lets whoever may change the model create the missing type, then reads the model again', async () => {
    const withoutWorkspace = { can_edit_model: true, ontology: { entities: ontology.entities.filter((e) => e.id !== 'workspace') } };
    serve({ types: withoutWorkspace });
    service.createDomainType = (arg: unknown) => ({
      fetch: (body: unknown) => {
        calls.push({ what: 'createDomainType', arg, body });
        return Promise.resolve({ entity: {}, version: 2 });
      },
    });
    render(<ModelScreen level="workspace" section="attributes" />);
    fireEvent.click(await screen.findByText('model_create_type'));
    await waitFor(() => expect(calls.filter((c) => c.what === 'types')).toHaveLength(2));
    expect(calls.find((c) => c.what === 'createDomainType')).toEqual({
      what: 'createDomainType',
      arg: 'o1',
      body: { id: 'workspace', name: 'Workspace', extends: 'managed-object' },
    });
  });

  it('is refused to whoever may not read the object, with no Edit', async () => {
    serve({ query: refusal(403) });
    render(<ModelScreen level="workspace" section="attributes" />);
    expect(await screen.findByText('model_forbidden')).toBeTruthy();
    expect(document.querySelector('[data-attributes-edit]')).toBeNull();
  });
});
