import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { service, org, calls, opened } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
  opened: [] as unknown[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  OrganizationProvider: ({ children }: { children: React.ReactNode }) => children,
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  openProjectTeam: (_bridge: unknown, target: unknown) => opened.push(target),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));
vi.mock('../../i18n', () => {
  const t = Object.assign((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key), {
    count: (key: string, n: number) => `${key}:${n}`,
  });
  return { usePeopleTranslations: () => ({ t, loading: false }) };
});

import { PeopleScreen } from './PeopleScreen';

const fetching = (what: string, value: unknown) =>
  Object.assign(
    (arg?: unknown) => ({
      fetch: () => {
        calls.push({ what, arg });
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      },
    }),
    {
      fetch: (body?: unknown) => {
        calls.push({ what, body });
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      },
    }
  );

const tenant = (id: string, name: string) => ({ id, name });

function serve(over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    orgMembers: () =>
      Promise.resolve([
        { user_id: 'u1', display_name: 'Ann', email: 'ann@x.example', role: 'owner', status: 'active' },
        { user_id: 'u2', display_name: 'Bob', role: 'member', status: 'active' },
      ]),
    myColleagues: () => Promise.resolve([]),
    accessCatalogue: fetching('accessCatalogue', { privileges: [], default_roles: [{ key: 'editor', name: 'Editor', privileges: [] }] }),
    getTenantMetadata: (params: { metadataType: string; tenantId: string }) => ({
      fetch: () =>
        Promise.resolve(
          params.metadataType.includes('access')
            ? {
                value: {
                  model: 'roles',
                  roles: [{ key: 'editor', name: 'Editor', privileges: [] }],
                  grants: [
                    {
                      id: 'g1',
                      subjectType: 'member',
                      subjectId: 'u2',
                      subjectName: 'Bob',
                      roleKey: 'editor',
                      scopeType: 'project',
                      scopeId: 'p1',
                      scopeName: 'Alpha',
                    },
                  ],
                },
              }
            : null
        ),
    }),
    getWorkspaces: fetching('getWorkspaces', { items: [tenant('w1', 'Web')] }),
    getProjects: fetching('getProjects', { items: [tenant('p1', 'Alpha'), tenant('p2', 'Beta')] }),
    memberIdentities: fetching('memberIdentities', { user_id: 'u1', logins: [], aliases: [] }),
    openPullRequests: fetching('openPullRequests', { items: [] }),
    activityFeed: fetching('activityFeed', { items: [] }),
    desktopSessions: () => Promise.resolve([]),
    presenceOnline: fetching('presenceOnline', { items: [] }),
    insightQuery: fetching('insightQuery', { rows: [], truncated: false }),
    invite: (orgId: string) => ({
      fetch: (body: unknown) => {
        calls.push({ what: 'invite', arg: orgId, body });
        return Promise.resolve({ invitation: {} });
      },
    }),
    ...over,
  });
}

const bridge = {} as ChildMfeBridge;

beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  org.value = { id: 'o1', name: 'Acme' };
  try {
    sessionStorage.clear();
  } catch {
    /* none */
  }
  serve();
});

describe('Organization › People', () => {
  it('says so when no organization is in scope', () => {
    org.value = null;
    render(<PeopleScreen bridge={bridge} />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it('lists the members with their membership and the access model', async () => {
    render(<PeopleScreen bridge={bridge} />);
    expect(await screen.findByRole('button', { name: 'Ann' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bob' })).toBeTruthy();
    expect(screen.getByText('role_owner')).toBeTruthy();
    expect(screen.getByText('model_roles')).toBeTruthy();
    expect(screen.getByText('people:2')).toBeTruthy();
  });

  it("puts a person's role grant on the project it names, and opens that project's Team", async () => {
    render(<PeopleScreen bridge={bridge} />);
    const chip = await waitFor(() => {
      const found = document.querySelector('[data-person="u2"] [data-person-project="p1"]');
      if (!found) throw new Error('no chip');
      return found as HTMLElement;
    });
    expect(chip.textContent).toContain('Editor');
    fireEvent.click(chip);
    expect(opened).toEqual([
      {
        project: { id: 'p1', name: 'Alpha' },
        workspace: { id: 'w1', name: 'Web' },
        siblings: [
          { id: 'p1', name: 'Alpha', workspaceId: 'w1', workspaceName: 'Web', kind: null },
          { id: 'p2', name: 'Beta', workspaceId: 'w1', workspaceName: 'Web', kind: null },
        ],
        organizationId: 'o1',
      },
    ]);
  });

  it('says a person without a grant is on no project under role access', async () => {
    render(<PeopleScreen bridge={bridge} />);
    await waitFor(() => {
      const none = document.querySelector('[data-person="u1"] [data-people-none]');
      if (!none) throw new Error('not yet');
      expect(none.textContent).toContain('stack_no_project');
    });
  });

  it('narrows the list by the search', async () => {
    render(<PeopleScreen bridge={bridge} />);
    await screen.findByRole('button', { name: 'Ann' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bob' } });
    expect(screen.queryByRole('button', { name: 'Ann' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bob' })).toBeTruthy();
  });

  it('falls back to the colleague projection for a member without people.view', async () => {
    serve({
      orgMembers: () => Promise.reject(new Error('403')),
      myColleagues: () => Promise.resolve([{ org_id: 'o1', user_id: 'u3', display_name: 'Cid', role: 'member' }]),
    });
    render(<PeopleScreen bridge={bridge} />);
    expect(await screen.findByRole('button', { name: 'Cid' })).toBeTruthy();
  });

  it('shows the failure and a retry when nobody can be read', async () => {
    serve({
      orgMembers: () => Promise.reject(new Error('403')),
      myColleagues: () => Promise.reject(new Error('down')),
    });
    render(<PeopleScreen bridge={bridge} />);
    expect(await screen.findByText('read_failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });

  it('invites by address and says what happens next', async () => {
    render(<PeopleScreen bridge={bridge} />);
    await screen.findByRole('button', { name: 'Ann' });
    fireEvent.click(screen.getByRole('button', { name: 'invite' }));
    fireEvent.change(await screen.findByLabelText('invite_address'), { target: { value: ' new@x.example ' } });
    fireEvent.click(document.querySelector('[data-invite-send]') as HTMLElement);
    expect(await screen.findByText(/^invited/)).toBeTruthy();
    expect(calls.find((c) => c.what === 'invite')).toEqual({
      what: 'invite',
      arg: 'o1',
      body: { email: 'new@x.example', role: 'member' },
    });
  });

  it('shows everyone against every project in the matrix', async () => {
    render(<PeopleScreen bridge={bridge} />);
    await screen.findByRole('button', { name: 'Ann' });
    fireEvent.click(document.querySelector('[data-people-layout="matrix"]') as HTMLElement);
    const cell = await waitFor(() => {
      const found = document.querySelector('[data-matrix-cell="u2:p1"]');
      if (!found) throw new Error('no cell');
      return found as HTMLElement;
    });
    expect(cell.textContent).toBe('Edi');
    expect(document.querySelector('[data-matrix-cell="u1:p1"]')?.textContent).toBe('');
  });

  it('opens a person in a panel, without an address for a non-administrator', async () => {
    render(<PeopleScreen bridge={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bob' }));
    expect(await screen.findByText('addresses_hidden')).toBeTruthy();
    expect(screen.getByText('projects_roles')).toBeTruthy();
  });
});
