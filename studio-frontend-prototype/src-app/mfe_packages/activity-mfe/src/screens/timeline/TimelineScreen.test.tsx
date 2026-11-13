import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenText } from '@constructor-studio/mfe-shared';

const { service, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: { query: [] as unknown[], mutate: [] as unknown[] },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: { id: 'o1', name: 'Acme' }, loading: false, failed: false }),
  useStudioEventRefresh: () => undefined,
}));

import { TimelineScreen } from './TimelineScreen';

const t = Object.assign(
  (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  { count: (key: string, n: number) => `${key}:${n}` }
) as unknown as ScreenText;

const WITH_MILESTONE = {
  ontology: {
    entities: [
      {
        id: 'milestone',
        properties: [
          { name: 'name', type: 'string', required: true },
          { name: 'target_at', type: 'timestamp' },
          { name: 'status', type: 'planned | at_risk | achieved | missed | cancelled' },
          { name: 'owner_note', type: 'string' },
        ],
      },
    ],
  },
  can_edit_model: false,
};

function serve(types: unknown, milestones: unknown[] | Error = [], mutate: () => Promise<unknown> = () => Promise.resolve({ results: [] })) {
  Object.assign(service, {
    domainTypes: () => ({ fetch: () => (types instanceof Error ? Promise.reject(types) : Promise.resolve(types)) }),
    queryDomain: () => ({
      fetch: (body: unknown) => {
        calls.query.push(body);
        return milestones instanceof Error
          ? Promise.reject(milestones)
          : Promise.resolve({
              items: milestones,
              total: milestones.length,
              complete: true,
              warnings: [],
              groups: [{ key: ['planned'], count: milestones.length }],
            });
      },
    }),
    mutateDomain: () => ({
      fetch: (body: unknown) => {
        calls.mutate.push(body);
        return mutate();
      },
    }),
  });
}

const container = { current: null };

describe('Project › Timeline', () => {
  beforeEach(() => {
    calls.query = [];
    calls.mutate = [];
  });
  afterEach(cleanup);

  it('without the milestone type says so, asks for no milestones and offers no add', async () => {
    serve({ ontology: { entities: [{ id: 'project' }] }, can_edit_model: false });
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => expect(document.querySelector('[data-timeline-no-type]')).not.toBeNull());
    expect(calls.query).toEqual([]);
    expect((document.querySelector('[data-timeline-add]') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the model could not be read rather than showing an empty timeline', async () => {
    serve(new Error('model down'));
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => screen.getByText(/model_failed/));
    expect(screen.getByText(/model down/)).toBeTruthy();
  });

  it('lists the project’s milestones by date with today between, counted by status', async () => {
    serve(WITH_MILESTONE, [
      { id: 'a', value: { name: 'Alpha', target_at: '2000-01-01T00:00:00Z', status: 'planned' } },
      { id: 'b', value: { name: 'Beta', target_at: '2999-01-01T00:00:00Z', status: 'planned', owner_note: 'ann' } },
    ]);
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => screen.getByText('Alpha'));
    expect(calls.query[0]).toMatchObject({ type: 'milestone', project_id: 'p1' });
    const rows = [...document.querySelectorAll('[data-timeline] > li')].map((li) =>
      li.hasAttribute('data-timeline-today') ? 'today' : li.getAttribute('data-milestone')
    );
    expect(rows).toEqual(['a', 'today', 'b']);
    // Alpha is past its date and still planned.
    expect(screen.getByText('late')).toBeTruthy();
    expect(screen.getByText('owner note: ann')).toBeTruthy();
    expect(document.querySelector('[data-timeline-count]')?.textContent).toContain('"count":2');
  });

  it('says there are none yet', async () => {
    serve(WITH_MILESTONE, []);
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => expect(document.querySelector('[data-timeline-empty]')).not.toBeNull());
  });

  it('shows a refused read in the gear’s words', async () => {
    serve(WITH_MILESTONE, new Error('the graph store is not answering'));
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toContain('the graph store is not answering');
    expect((document.querySelector('[data-timeline-add]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is read-only and says not installed when the objects route refuses a type the model still lists', async () => {
    serve(WITH_MILESTONE, new Error('DOMAIN_TYPE_NOT_INSTALLED: project-lifecycle'));
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => expect(document.querySelector('[data-timeline-no-type="not_installed"]')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect((document.querySelector('[data-timeline-add]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the type was left dormant, read-only, rather than failing', async () => {
    const dormant = Object.assign(new Error('Request failed with status code 400'), {
      response: {
        status: 400,
        data: { context: { violations: [{ type: 'DOMAIN_TYPE_DORMANT', subject: 'project-lifecycle' }] } },
      },
    });
    serve(WITH_MILESTONE, dormant);
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => expect(document.querySelector('[data-timeline-no-type="dormant"]')).not.toBeNull());
    expect(document.querySelector('[data-timeline-no-type]')?.textContent).toBe('milestone_type_dormant');
    expect((document.querySelector('[data-timeline-add]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a milestone with one upsert and reads again', async () => {
    serve(WITH_MILESTONE, []);
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => expect(document.querySelector('[data-timeline-empty]')).not.toBeNull());
    fireEvent.click(screen.getByText('add_milestone'));
    const save = () => document.querySelector('[data-milestone-save]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(document.getElementById('attr-name')!, { target: { value: 'Beta' } });
    fireEvent.change(document.getElementById('attr-target_at')!, { target: { value: '2026-12-01' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(calls.mutate).toHaveLength(1));
    expect(calls.mutate[0]).toMatchObject({
      operations: [{ op: 'upsert', type: 'milestone', project_id: 'p1', value: { name: 'Beta', title: 'Beta', status: 'planned' } }],
    });
    await waitFor(() => expect(calls.query).toHaveLength(2));
  });

  it('keeps the draft and shows the refusal when a save is refused', async () => {
    serve(WITH_MILESTONE, [], () => Promise.reject(new Error('not allowed')));
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => expect(document.querySelector('[data-timeline-empty]')).not.toBeNull());
    fireEvent.click(screen.getByText('add_milestone'));
    fireEvent.change(document.getElementById('attr-name')!, { target: { value: 'Beta' } });
    fireEvent.change(document.getElementById('attr-target_at')!, { target: { value: '2026-12-01' } });
    fireEvent.click(document.querySelector('[data-milestone-save]')!);
    await waitFor(() => screen.getByText(/save_failed/));
    expect(screen.getByText(/not allowed/)).toBeTruthy();
    expect((document.getElementById('attr-name') as HTMLInputElement).value).toBe('Beta');
  });

  it('deletes a milestone once asked', async () => {
    serve(WITH_MILESTONE, [{ id: 'a', value: { name: 'Alpha', target_at: '2999-01-01T00:00:00Z' } }]);
    render(<TimelineScreen projectId="p1" t={t} container={container} />);
    await waitFor(() => screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('delete'));
    expect(calls.mutate).toEqual([]);
    const confirm = [...document.querySelectorAll('[data-timeline-delete] button')].find((b) => b.textContent === 'delete')!;
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.mutate).toEqual([{ operations: [{ op: 'delete', id: 'a' }] }]));
  });
});
