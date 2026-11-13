import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { service, org, calls, opened } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { what: string; org: string; body: unknown }[],
  opened: [] as string[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  // The shell's live channel is a shared property; outside the shell nothing arrives.
  useStudioEventRefresh: () => undefined,
  openScreen: (_bridge: unknown, route: string) => opened.push(route),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));
// The canvas graph is the model graph's, tested there; here only what it is given.
vi.mock('../domain-model/DomainModelGraph', () => ({
  DomainModelGraph: ({ source }: { source: { key: string } }) => <div data-graph-source={source.key} />,
}));

import { ViewsSection } from './ViewsSection';
import { toViewObject } from '../../../model/views-model';
import { modelOf } from '../../../model/domain-runtime';

const ontology = {
  buckets: [{ id: 'planning', name: 'Planning' }],
  entities: [
    {
      id: 'project',
      bucket: 'planning',
      properties: [
        { name: 'name', type: 'string' },
        { name: 'status', type: 'planned | active' },
        { name: 'version', type: 'integer' },
        { name: 'public', type: 'boolean' },
        { name: 'uses', type: 'repository', extends: 'edge' },
      ],
    },
    { id: 'repository', bucket: 'planning', properties: [{ name: 'name', type: 'string' }] },
    { id: 'view', properties: [{ name: 'name', type: 'string' }] },
  ],
};
const model = modelOf({ ontology, can_edit_model: true });

const stored = toViewObject(model, {
  id: 'v-active',
  name: 'Active projects',
  type: 'project',
  columns: ['name', 'status'],
  conditions: [{ field: 'status', op: '_eq', value: 'active' }],
  relations: ['uses'],
  sort: null,
  kind: 'table',
});

const row = (id: string, name: string) => ({
  id,
  entity: 'project',
  value: { name, status: 'active' },
  relations: { uses: { items: [{ id: 'r1', entity: 'repository', value: { name: 'web' }, relations: {} }], total: 3, complete: true } },
});

const forbidden = () => Object.assign(new Error('DOMAIN_OBJECT_ACCESS_DENIED'), { response: { status: 403 } });

interface Answers {
  views?: unknown[];
  rows?: unknown;
  mutate?: (body: unknown) => Promise<unknown>;
  types?: unknown;
}

function serve(answers: Answers = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    domainTypes: () => ({ fetch: () => Promise.resolve(answers.types ?? { ontology, can_edit_model: false }) }),
    queryDomain: (orgId: string) => ({
      fetch: (body: { type: string }) => {
        calls.push({ what: 'query', org: orgId, body });
        if (body.type === 'view') {
          return Promise.resolve({ items: (answers.views ?? [stored]).map((value) => ({ id: 'n', entity: 'view', value, relations: {} })), total: 1, complete: true, warnings: [] });
        }
        const rows = answers.rows ?? { items: [row('p1', 'Apollo')], total: 1, complete: true, warnings: [] };
        return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
      },
    }),
    mutateDomain: (orgId: string) => ({
      fetch: (body: unknown) => {
        calls.push({ what: 'mutate', org: orgId, body });
        return answers.mutate ? answers.mutate(body) : Promise.resolve({ results: [] });
      },
    }),
  });
}

const queries = (type: string) => calls.filter((c) => c.what === 'query' && (c.body as { type: string }).type === type);
const mutations = () => calls.filter((c) => c.what === 'mutate');

async function shown(selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found as HTMLElement;
  });
}

beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  org.value = { id: 'o1', name: 'Acme' };
  serve();
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('Admin › Views', () => {
  it('asks for an organization when none is in scope', () => {
    org.value = null;
    render(<ViewsSection />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it("says what to do when the organization's model has no view type, and stores nothing", async () => {
    serve({ types: { ontology: { entities: ontology.entities.filter((e) => e.id !== 'view') }, can_edit_model: true } });
    render(<ViewsSection />);
    const notice = await shown('[data-view-no-type]');
    expect(within(notice).getByText('vw_no_view_type')).toBeTruthy();
    fireEvent.click(within(notice).getByRole('button', { name: 'vw_open_model' }));
    expect(opened).toEqual(['/admin/domain-model']);
    expect(calls).toEqual([]);
    expect(screen.queryByRole('button', { name: 'vw_new' })).toBeNull();
  });

  it("lists the organization's live views and runs the first one's query, paged, with its relation names", async () => {
    org.value = { id: 'administered', name: 'Other' };
    render(<ViewsSection />);
    expect((await shown('[data-view-tab="v-active"]')).textContent).toBe('Active projects');
    expect(queries('view')[0]).toMatchObject({ org: 'administered', body: { type: 'view', where: { valid_to: { _is_null: true } } } });
    const table = await shown('[data-view-row="p1"]');
    expect(table.textContent).toContain('Apollo');
    expect(table.textContent).toContain('web +2');
    expect(queries('project')[0]).toEqual({
      what: 'query',
      org: 'administered',
      body: {
        type: 'project',
        fields: ['name', 'status'],
        where: { status: { _eq: 'active' } },
        include: { uses: { fields: ['name'], order_by: [{ field: 'name' }], limit: 5 } },
        offset: 0,
        limit: 25,
      },
    });
  });

  it("keeps the reader's sort in the address and asks the server to order by it", async () => {
    window.history.replaceState(null, '', '/?screen=admin;section=views');
    render(<ViewsSection />);
    await shown('[data-view-row="p1"]');
    fireEvent.click(screen.getByRole('button', { name: 'status' }));
    await waitFor(() => expect(queries('project').slice(-1)[0]?.body).toMatchObject({ order_by: [{ field: 'status', direction: 'asc' }] }));
    expect(window.location.search).toBe('?screen=admin;section=views&view.sort=status');
  });

  it('says a refusal to read the objects is a refusal, and an empty answer is empty', async () => {
    serve({ rows: forbidden() });
    const first = render(<ViewsSection />);
    expect(await screen.findByText('vw_forbidden')).toBeTruthy();
    first.unmount();
    serve({ rows: { items: [], total: 0, complete: true, warnings: [] } });
    render(<ViewsSection />);
    expect(await screen.findByText('vw_empty')).toBeTruthy();
  });

  it('saves a new view as one upsert of a view object, the condition coerced by its field kind', async () => {
    render(<ViewsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'vw_new' }));
    const editor = await shown('[data-view-editor]');
    const save = within(editor).getByRole('button', { name: 'vw_save' });
    expect(within(editor).getByText('vw_problem_name')).toBeTruthy();
    expect(save).toHaveProperty('disabled', true);

    fireEvent.change(within(editor).getByLabelText('vw_name'), { target: { value: 'Late releases' } });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'version' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_add_condition' }));
    fireEvent.change(within(editor).getByLabelText('vw_condition_field'), { target: { value: 'version' } });
    fireEvent.change(within(editor).getByLabelText('vw_condition_op'), { target: { value: '_gt' } });
    fireEvent.change(within(editor).getByLabelText('vw_condition_value'), { target: { value: 'two' } });
    expect(within(editor).getByText('vw_problem_number')).toBeTruthy();
    fireEvent.change(within(editor).getByLabelText('vw_condition_value'), { target: { value: '2' } });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'uses → repository' }));
    fireEvent.change(within(editor).getByLabelText('vw_show_as'), { target: { value: 'graph' } });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);

    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [{ org: written, body }] = mutations();
    expect(written).toBe('o1');
    const op = (body as { validate: string; operations: { op: string; type: string; key: string; value: Record<string, unknown> }[] });
    expect(op.validate).toBe('off');
    expect(op.operations).toHaveLength(1);
    const [upsert] = op.operations;
    expect(upsert).toMatchObject({ op: 'upsert', type: 'view', value: { name: 'Late releases', view_kind: 'graph' } });
    expect(upsert.key).toBe(upsert.value.id);
    expect(upsert.value.query).toEqual({
      type: 'project',
      fields: ['name', 'version'],
      where: { version: { _gt: 2 } },
      include: { uses: { fields: ['name'], order_by: [{ field: 'name' }], limit: 5 } },
    });
    expect(upsert.value.presentation).toMatchObject({ conditions: [{ field: 'version', op: '_gt', value: '2' }], kind: 'graph' });
    await waitFor(() => expect(document.querySelector('[data-view-editor]')).toBeNull());
    expect(queries('view').length).toBeGreaterThan(1);
  });

  it('a yes/no condition offers true and false and stores a boolean', async () => {
    render(<ViewsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'vw_new' }));
    const editor = await shown('[data-view-editor]');
    fireEvent.change(within(editor).getByLabelText('vw_name'), { target: { value: 'Public' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_add_condition' }));
    fireEvent.change(within(editor).getByLabelText('vw_condition_field'), { target: { value: 'public' } });
    fireEvent.change(within(editor).getByLabelText('vw_condition_op'), { target: { value: '_eq' } });
    fireEvent.change(within(editor).getByLabelText('vw_condition_value'), { target: { value: 'true' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_save' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const value = (mutations()[0].body as { operations: { value: { query: { where: unknown } } }[] }).operations[0].value;
    expect(value.query.where).toEqual({ public: { _eq: true } });
  });

  it('reopens a saved view as it was written and saves it under the same key', async () => {
    render(<ViewsSection />);
    fireEvent.click(await shown('[data-view-edit]'));
    const editor = await shown('[data-view-editor]');
    expect(within(editor).getByLabelText('vw_name')).toHaveProperty('value', 'Active projects');
    expect(within(editor).getByRole('checkbox', { name: 'status' })).toHaveProperty('checked', true);
    expect(within(editor).getByRole('checkbox', { name: 'version' })).toHaveProperty('checked', false);
    expect(within(editor).getByRole('checkbox', { name: 'uses → repository' })).toHaveProperty('checked', true);
    expect(within(editor).getByLabelText('vw_condition_value')).toHaveProperty('value', 'active');
    fireEvent.change(within(editor).getByLabelText('vw_name'), { target: { value: 'Active' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_save' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const upsert = (mutations()[0].body as { operations: { key: string; value: { name: string } }[] }).operations[0];
    expect(upsert.key).toBe('v-active');
    expect(upsert.value.name).toBe('Active');
  });

  it('keeps the draft when the server refuses the save, then stops offering writes', async () => {
    serve({ mutate: () => Promise.reject(forbidden()) });
    render(<ViewsSection />);
    fireEvent.click(await shown('[data-view-edit]'));
    const editor = await shown('[data-view-editor]');
    fireEvent.change(within(editor).getByLabelText('vw_name'), { target: { value: 'Mine' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_save' }));
    expect(await within(editor).findByRole('alert')).toBeTruthy();
    expect(within(editor).getByLabelText('vw_name')).toHaveProperty('value', 'Mine');
    fireEvent.click(within(editor).getByRole('button', { name: 'cancel' }));
    expect(await shown('[data-view-read-only]')).toBeTruthy();
    expect(document.querySelector('[data-view-edit]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'vw_new' })).toBeNull();
  });

  it('previews the real query, and says when it finds nothing or is refused', async () => {
    render(<ViewsSection />);
    fireEvent.click(await shown('[data-view-edit]'));
    const editor = await shown('[data-view-editor]');
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_run_preview' }));
    await waitFor(() => expect(within(editor).getByText('Apollo')).toBeTruthy());
    expect(queries('project').slice(-1)[0]?.body).toMatchObject({ type: 'project', where: { status: { _eq: 'active' } }, limit: 10 });

    // Another query makes the preview old.
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'version' }));
    expect(within(editor).queryByText('Apollo')).toBeNull();

    serve({ rows: { items: [], total: 0, complete: true, warnings: [] } });
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_run_preview' }));
    expect(await within(editor).findByText('vw_preview_empty')).toBeTruthy();

    serve({ rows: forbidden() });
    fireEvent.click(within(editor).getByRole('button', { name: 'vw_run_preview' }));
    expect(await within(editor).findByText('vw_forbidden')).toBeTruthy();
  });

  it('retires a view after asking, by marking it ended', async () => {
    render(<ViewsSection />);
    fireEvent.click(await shown('[data-view-retire]'));
    fireEvent.click(await shown('[data-admin-confirm-go]'));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const upsert = (mutations()[0].body as { operations: { key: string; value: Record<string, unknown> }[] }).operations[0];
    expect(upsert.key).toBe('v-active');
    expect(typeof upsert.value.valid_to).toBe('string');
    expect(upsert.value.name).toBe('Active projects');
  });

  it('draws a graph view on the model canvas', async () => {
    serve({ views: [{ ...stored, view_kind: 'graph', presentation: { ...(stored.presentation as object), kind: 'graph' } }] });
    render(<ViewsSection />);
    expect(await shown('[data-graph-source]')).toBeTruthy();
    expect(document.querySelector('[data-view-table]')).toBeNull();
  });
});
