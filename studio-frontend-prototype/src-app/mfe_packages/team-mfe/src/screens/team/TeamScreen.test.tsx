import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { service, scope, puts, screens } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  scope: {
    org: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null,
    project: 'p1' as unknown,
  },
  puts: [] as { tenant: string; type: string; body: unknown }[],
  screens: [] as string[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: scope.org, loading: false, failed: false }),
  OrganizationProvider: ({ children }: { children: React.ReactNode }) => children,
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  openScreen: (_bridge: unknown, route: string) => screens.push(route),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useSharedProperty: () => scope.project,
}));
vi.mock('../../i18n', () => {
  const t = Object.assign((key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key), {
    count: (key: string, n: number) => `${key}:${n}`,
  });
  return { useTeamTranslations: () => ({ t, loading: false }) };
});

import { ACCESS_ROUTE, PEOPLE_ROUTE, TeamScreen } from './TeamScreen';
import type { AccessConfig, GrantDef } from '@constructor-studio/mfe-shared';

const grant = (id: string, subjectId: string, over: Partial<GrantDef> = {}): GrantDef => ({
  id,
  subjectType: 'member',
  subjectId,
  subjectName: subjectId,
  roleKey: 'editor',
  scopeType: 'project',
  scopeId: 'p1',
  scopeName: 'Alpha',
  ...over,
});

const ROLES = [
  { key: 'viewer', name: 'Viewer', privileges: [] },
  { key: 'editor', name: 'Editor', privileges: [] },
];

function serve(access: Partial<AccessConfig> | null, over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    orgMembers: () =>
      Promise.resolve([
        { user_id: 'u1', display_name: 'Ann', email: 'ann@x.example', role: 'owner', status: 'active' },
        { user_id: 'u2', display_name: 'Bob', role: 'member', status: 'active' },
        { user_id: 'u3', display_name: 'Cid', role: 'member', status: 'active' },
      ]),
    myColleagues: () => Promise.resolve([]),
    accessCatalogue: { fetch: () => Promise.resolve({ privileges: [], default_roles: ROLES }) },
    getTenantMetadata: () => ({ fetch: () => Promise.resolve(access ? { value: access } : null) }),
    getTenant: () => ({ fetch: () => Promise.resolve({ id: 'p1', name: 'Alpha' }) }),
    putTenantMetadata: (tenant: string, type: string) => ({
      fetch: (body: unknown) => {
        puts.push({ tenant, type, body });
        return Promise.resolve({});
      },
    }),
    ...over,
  });
}

const bridge = {} as ChildMfeBridge;
const lastPut = () => puts[puts.length - 1].body as AccessConfig;

beforeEach(() => {
  puts.length = 0;
  screens.length = 0;
  scope.org = { id: 'o1', name: 'Acme' };
  scope.project = 'p1';
  serve({
    model: 'roles',
    roles: ROLES,
    grants: [
      grant('g1', 'u2'),
      grant('g2', 'u1', { scopeType: 'org', scopeId: '', roleKey: 'viewer' }),
      grant('g3', 'u3', { scopeId: 'p2' }),
    ],
  });
});

describe('Project › Team', () => {
  it('says so when no project is in scope', () => {
    scope.project = null;
    render(<TeamScreen bridge={bridge} />);
    expect(screen.getByText('no_project')).toBeTruthy();
  });

  it("lists this project's grants and the organization-wide ones, not another project's", async () => {
    render(<TeamScreen bridge={bridge} />);
    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.queryByText('Cid')).toBeNull();
    expect(screen.getByText('people:2')).toBeTruthy();
    // An organization-wide grant is shown, managed in Access.
    const orgRow = document.querySelector('[data-team-grant="g2"]') as HTMLElement;
    expect(orgRow.textContent).toContain('scope_org');
    expect(orgRow.textContent).toContain('in_access');
    expect((orgRow.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
  });

  it("changes a member's role by writing the access config", async () => {
    render(<TeamScreen bridge={bridge} />);
    await screen.findByText('Bob');
    const select = document.querySelector('[data-team-grant="g1"] select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'viewer' } });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].tenant).toBe('o1');
    expect(puts[0].type).toContain('access.config');
    expect(lastPut().grants.find((g) => g.id === 'g1')?.roleKey).toBe('viewer');
  });

  it('adds someone from the organization with the default role', async () => {
    render(<TeamScreen bridge={bridge} />);
    await screen.findByText('Bob');
    fireEvent.click(document.querySelector('[data-team-add-open]') as HTMLElement);
    const person = (await screen.findByLabelText('person')) as HTMLSelectElement;
    // Only people not on the team yet are offered.
    expect([...person.options].map((o) => o.value)).toEqual(['', 'u3']);
    fireEvent.change(person, { target: { value: 'u3' } });
    fireEvent.click(document.querySelector('[data-team-add]') as HTMLElement);
    await waitFor(() => expect(puts).toHaveLength(1));
    const added = lastPut().grants.find((g) => g.subjectId === 'u3' && g.scopeId === 'p1');
    expect(added).toMatchObject({ subjectName: 'Cid', roleKey: 'editor', scopeType: 'project', scopeName: 'Alpha' });
  });

  it('removes a member after asking', async () => {
    render(<TeamScreen bridge={bridge} />);
    await screen.findByText('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    expect(await screen.findByText(/^remove_title/)).toBeTruthy();
    fireEvent.click(document.querySelector('[data-team-remove-go]') as HTMLElement);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(lastPut().grants.map((g) => g.id)).toEqual(['g2', 'g3']);
  });

  it('shows the refusal when the write is refused', async () => {
    serve(
      { model: 'roles', roles: ROLES, grants: [grant('g1', 'u2')] },
      {
        putTenantMetadata: () => ({
          fetch: () =>
            Promise.reject(Object.assign(new Error('403'), { response: { status: 403, data: { detail: 'Not yours to change' } } })),
        }),
      }
    );
    render(<TeamScreen bridge={bridge} />);
    await screen.findByText('Bob');
    fireEvent.change(document.querySelector('[data-team-grant="g1"] select') as HTMLSelectElement, {
      target: { value: 'viewer' },
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Not yours to change');
  });

  it('says there is no team to manage under tenant access, and leads to Access', async () => {
    serve(null);
    render(<TeamScreen bridge={bridge} />);
    expect(await screen.findByText(/^tenant_title/)).toBeTruthy();
    expect(document.querySelector('[data-team-add-open]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'open_access' }));
    expect(screens).toEqual([ACCESS_ROUTE]);
  });

  it('says why, and shows no team, when nobody can be read', async () => {
    serve(null, {
      orgMembers: () => Promise.reject(new Error('403')),
      myColleagues: () => Promise.reject(new Error('members unreadable')),
    });
    render(<TeamScreen bridge={bridge} />);
    expect((await screen.findByRole('alert')).textContent).toContain('members unreadable');
    expect(screen.queryByText(/^tenant_title/)).toBeNull();
    expect(screen.queryByText('loading_team')).toBeNull();
  });

  it('offers adding and inviting when nobody is on the team', async () => {
    serve({ model: 'roles', roles: ROLES, grants: [] });
    render(<TeamScreen bridge={bridge} />);
    expect(await screen.findByText('empty_title')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'open_people' }));
    expect(screens).toEqual([PEOPLE_ROUTE]);
  });
});
