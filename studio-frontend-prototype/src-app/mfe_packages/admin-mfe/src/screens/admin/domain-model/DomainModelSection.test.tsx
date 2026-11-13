import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { service, org, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  // The shell's live channel is a shared property; outside the shell nothing arrives.
  useStudioEventRefresh: () => undefined,
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { DomainModelSection } from './DomainModelSection';

/** A read taking params: `fetch` answers `value` (or rejects with it, when it is an Error). */
const read = (what: string, value: unknown) => (arg?: unknown) => ({
  fetch: () => {
    calls.push({ what, arg });
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  },
});

/** A write: a factory taking path params, its `fetch` taking the body. */
const write =
  (what: string, answer: unknown = { entity: {}, version: 2 }) =>
  (...arg: unknown[]) => ({
    fetch: (body: unknown) => {
      calls.push({ what, arg, body });
      return Promise.resolve(answer);
    },
  });

const ontology = {
  buckets: [
    { id: 'identity', name: 'Identity' },
    { id: 'planning', name: 'Planning' },
  ],
  entities: [
    { id: 'entity', abstract: true, bucket: 'identity', meta: { origin: 'studio' }, properties: [{ name: 'id', type: 'EntityId' }, { name: 'title', type: 'string' }] },
    {
      id: 'project',
      name: 'Project',
      extends: 'entity',
      bucket: 'identity',
      meta: { origin: 'studio' },
      properties: [
        { name: 'stage', type: 'planned | active', required: true, description: 'Where it is' },
        { name: 'sha', type: 'string', held_by: 'studio-artifact-ingest' },
        { name: 'milestones', type: 'Milestone', extends: 'edge', relationType: 'owns' },
      ],
    },
    {
      id: 'milestone',
      name: 'Milestone',
      extends: 'entity',
      bucket: 'planning',
      meta: { origin: 'kit', kit: 'project-lifecycle', kit_version: '0.3.0' },
    },
    { id: 'report', name: 'Report', bucket: 'planning', meta: { origin: 'kit', kit: 'org-reports' } },
    { id: 'cost-centre', name: 'Cost centre', meta: { origin: 'organization' } },
  ],
};

function serve(over: Record<string, unknown> = {}, canEdit = true) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    domainTypes: read('domainTypes', {
      ontology,
      can_edit_model: canEdit,
      gts: { types: { project: { type: 'gts.cf.studio.project.v1~', stored_as: 'gts.cf.graph.node.v1~project' } }, relations: {} },
    }),
    domainTypeCounts: read('domainTypeCounts', { counts: { project: 3, milestone: 1 }, complete: true }),
    addDomainField: write('addDomainField'),
    addDomainTab: write('addDomainTab'),
    editDomainField: write('editDomainField'),
    removeDomainField: write('removeDomainField'),
    createDomainType: write('createDomainType'),
    ...over,
  });
}

async function shown(selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found as HTMLElement;
  });
}

const typesShown = () => [...document.querySelectorAll('[data-dm-type]')].map((el) => el.getAttribute('data-dm-type'));

beforeEach(() => {
  calls.length = 0;
  org.value = { id: 'o1', name: 'Acme' };
  serve();
});

describe('Studio domain model', () => {
  it('asks for an organization when none is in scope', () => {
    org.value = null;
    render(<DomainModelSection />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it("reads the model of the organization on the path bar and opens on Project, its origin chip from meta.origin", async () => {
    render(<DomainModelSection />);
    const chip = await shown('[data-dm-origin]');
    expect(chip.getAttribute('data-dm-origin')).toBe('studio');
    expect(chip.textContent).toBe('Studio');
    expect(calls.find((c) => c.what === 'domainTypes')?.arg).toEqual({ orgId: 'o1' });
    expect(calls.find((c) => c.what === 'domainTypeCounts')?.arg).toEqual({ orgId: 'o1' });
    // By bucket name (the untranslated key of Other sorts first here), each by name.
    expect(typesShown()).toEqual(['cost-centre', 'entity', 'project', 'milestone', 'report']);
    // Own fields; `id` never; the field a gear writes is locked.
    const own = document.querySelector('[data-dm-fields="own"]') as HTMLElement;
    expect(within(own).getByText('stage')).toBeTruthy();
    expect(within(own).getByText('dm_kind_one_of')).toBeTruthy();
    const held = own.querySelector('[data-dm-field="sha"]') as HTMLElement;
    expect(within(held).queryByText('dm_edit')).toBeNull();
    expect(document.querySelector('[data-dm-field="id"]')).toBeNull();
    expect(screen.getByText('dm_objects 3')).toBeTruthy();
    expect(document.querySelector('[data-dm-gts]')).toBeTruthy();
  });

  it('adds a model tab in the administered organization and refuses duplicate or malformed keys', async () => {
    org.value = { id: 'administered-org', name: 'Other organization' };
    render(<DomainModelSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'dm_add_tab' }));
    fireEvent.change(screen.getByLabelText('dm_tab_target'), { target: { value: 'milestone' } });
    const submit = screen.getByRole('button', { name: 'dm_add_tab' });
    for (const name of ['stage', 'title', 'Bad key']) {
      fireEvent.change(screen.getByLabelText('dm_tab_name'), { target: { value: name } });
      expect(submit).toHaveProperty('disabled', true);
    }
    fireEvent.change(screen.getByLabelText('dm_tab_name'), { target: { value: 'delivery-plan' } });
    fireEvent.change(screen.getByLabelText('dm_tab_label'), { target: { value: 'Delivery plan' } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls.find((c) => c.what === 'addDomainTab')).toEqual({
      what: 'addDomainTab', arg: ['administered-org', 'project'],
      body: { name: 'delivery-plan', label: 'Delivery plan', target: 'milestone' },
    }));
    await waitFor(() => expect(screen.queryByLabelText('dm_tab_name')).toBeNull());
    expect(calls.filter((c) => c.what === 'domainTypes').length).toBeGreaterThan(1);
  });

  it('keeps the tab form on a server refusal and hides tab controls from readers', async () => {
    serve({ addDomainTab: () => ({ fetch: () => Promise.reject(new Error('Model permission denied')) }) });
    const view = render(<DomainModelSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'dm_add_tab' }));
    fireEvent.change(screen.getByLabelText('dm_tab_name'), { target: { value: 'delivery-plan' } });
    fireEvent.change(screen.getByLabelText('dm_tab_target'), { target: { value: 'milestone' } });
    fireEvent.click(screen.getByRole('button', { name: 'dm_add_tab' }));
    expect(await screen.findByText('Model permission denied')).toBeTruthy();
    expect(screen.getByLabelText('dm_tab_name')).toHaveProperty('value', 'delivery-plan');
    view.unmount(); serve({}, false);
    render(<DomainModelSection />);
    await shown('[data-dm-tabs]');
    expect(screen.queryByRole('button', { name: 'dm_add_tab' })).toBeNull();
  });

  it('filters by origin with a count each, and the kits by the kit that brought them', async () => {
    render(<DomainModelSection />);
    const kits = await shown('[data-dm-origin-filter="kit"]');
    expect(kits.textContent).toContain('dm_origin_kit');
    expect(kits.textContent).toContain('2');
    expect(document.querySelector('[data-dm-origin-filter="upload"]')).toBeNull();
    fireEvent.click(kits);
    expect(typesShown()).toEqual(['milestone', 'report']);
    fireEvent.click(await shown('[data-dm-kit-filter="project-lifecycle"]'));
    expect(typesShown()).toEqual(['milestone']);
    fireEvent.click(document.querySelector('[data-dm-type="milestone"]') as HTMLElement);
    const chip = await shown('[data-dm-origin]');
    expect(chip.getAttribute('data-dm-origin')).toBe('kit');
    expect(chip.textContent).toBe('kit · project-lifecycle 0.3.0');
    fireEvent.click(document.querySelector('[data-dm-origin-filter="organization"]') as HTMLElement);
    expect(typesShown()).toEqual(['cost-centre']);
  });

  it('opens a related type from the relation map', async () => {
    render(<DomainModelSection />);
    fireEvent.click(await shown('[data-dm-node="milestone"]'));
    await waitFor(() => expect(document.querySelector('[data-dm-origin]')?.getAttribute('data-dm-origin')).toBe('kit'));
  });

  it('adds a field, then reads the model again', async () => {
    render(<DomainModelSection />);
    fireEvent.click(await shown('[data-dm-add-field]'));
    fireEvent.change(await shown('[data-dm-field-name]'), { target: { value: 'cost_center' } });
    fireEvent.click(await shown('[data-dm-field-save]'));
    await waitFor(() => expect(calls.find((c) => c.what === 'addDomainField')).toBeTruthy());
    const add = calls.find((c) => c.what === 'addDomainField');
    expect(add?.arg).toEqual(['o1', 'project']);
    expect(add?.body).toEqual({ name: 'cost_center', type: 'string', required: false, description: '' });
    await waitFor(() => expect(calls.filter((c) => c.what === 'domainTypes')).toHaveLength(2));
  });

  it('keeps a custom expression selected while adding a field', async () => {
    render(<DomainModelSection />);
    fireEvent.click(await shown('[data-dm-add-field]'));
    fireEvent.change(await shown('[data-dm-field-name]'), { target: { value: 'attachments' } });
    fireEvent.change(await shown('[data-dm-field-kind]'), { target: { value: '__custom' } });
    const expression = await screen.findByPlaceholderText('EntityId');
    fireEvent.change(expression, { target: { value: 'FileId[]' } });
    expect((document.querySelector('[data-dm-field-kind]') as HTMLSelectElement).value).toBe('__custom');
    fireEvent.click(await shown('[data-dm-field-save]'));
    await waitFor(() => expect(calls.find((c) => c.what === 'addDomainField')?.body).toEqual({
      name: 'attachments', type: 'FileId[]', required: false, description: '',
    }));
  });

  it('clears a conformance report when selecting another type', async () => {
    serve({ domainConformance: read('domainConformance', {
      type: 'project', checked: 1, conforming: 1, truncated: false, violations: [], undeclared: [], sample: [],
    }) });
    render(<DomainModelSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'dm_conformance' }));
    await screen.findByText('dm_conformance_summary');
    fireEvent.click(document.querySelector('[data-dm-type="milestone"]') as HTMLElement);
    expect(screen.queryByText('dm_conformance_summary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'dm_conformance' }));
    await waitFor(() => expect(calls.filter((c) => c.what === 'domainConformance').map((c) => c.arg)).toEqual([
      { orgId: 'o1', typeId: 'project' }, { orgId: 'o1', typeId: 'milestone' },
    ]));
  });

  it('removes a field the type declares', async () => {
    render(<DomainModelSection />);
    const row = await shown('[data-dm-field="stage"]');
    fireEvent.click(within(row).getByText('dm_remove'));
    await waitFor(() => expect(calls.find((c) => c.what === 'removeDomainField')?.arg).toEqual(['o1', 'project', 'stage']));
  });

  it('only reads when the server says the caller may not change the model', async () => {
    serve({}, false);
    render(<DomainModelSection />);
    expect(await screen.findByText('dm_read_only')).toBeTruthy();
    expect(document.querySelector('[data-dm-add-field]')).toBeNull();
    expect(document.querySelector('[data-dm-new-type]')).toBeNull();
    expect(screen.queryByText('dm_remove')).toBeNull();
  });

  it("shows the server's refusal and reads again on Try again", async () => {
    const refused = Object.assign(new Error('Request failed with status code 403'), {
      response: { status: 403, data: { detail: 'Not a member of this organization' } },
    });
    serve({ domainTypes: read('domainTypes', refused) });
    render(<DomainModelSection />);
    expect(await screen.findByText('Not a member of this organization')).toBeTruthy();
    serve();
    fireEvent.click(screen.getByText('dm_retry'));
    await shown('[data-dm-origin]');
  });

  it('says so when the model has no types', async () => {
    serve({ domainTypes: read('domainTypes', { ontology: { entities: [] }, can_edit_model: true }) });
    render(<DomainModelSection />);
    expect(await screen.findByText('dm_no_types')).toBeTruthy();
    expect(screen.getByText('dm_pick')).toBeTruthy();
  });
});
