import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogType, OrgMember, PlatformIdentity } from '../../api/types';

const { service, org, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { what: string; arg?: unknown; body?: unknown }[],
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { PeopleSection } from './PeopleSection';
import { AccessSection } from './AccessSection';
import { IdentitiesSection } from './IdentitiesSection';
import { TenantsSection } from './TenantsSection';
import { ObjectsSection } from './ObjectsSection';
import { SecretsSection } from './SecretsSection';
import { OrganizationsSection } from './OrganizationsSection';

const refused = Object.assign(new Error('Request failed with status code 403'), {
  response: { status: 403, data: { detail: 'Only a platform administrator may list identities' } },
});

/** A read: `fetch` answers `value` (or rejects with it, when it is an Error). */
const read = (what: string, value: unknown) => {
  const fetch = () => {
    calls.push({ what });
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  return Object.assign((arg?: unknown) => {
    calls.push({ what, arg });
    return { fetch: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)) };
  }, { fetch });
};

/** A write: a factory taking path params, its `fetch` taking the body. */
const write = (what: string, answer: unknown = {}) =>
  (...arg: unknown[]) => ({
    fetch: (body: unknown) => {
      calls.push({ what, arg, body });
      return Promise.resolve(answer);
    },
  });

const member = (patch: Partial<OrgMember>): OrgMember => ({
  user_id: 'u1',
  display_name: 'Ann Owner',
  role: 'owner',
  status: 'active',
  source: 'creation',
  created_at_epoch_ms: 1_700_000_000_000,
  updated_at_epoch_ms: 0,
  ...patch,
});

const tenant = (id: string, name: string, patch: Record<string, unknown> = {}) => ({
  id,
  name,
  status: 'active',
  tenant_type: 'gts.cf.core.am.tenant_type.v1~cf.studio.tenant.organization.v1~',
  self_managed: false,
  depth: 1,
  child_count: 0,
  created_at: '',
  updated_at: '',
  ...patch,
});

function serve(over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    orgMembers: () => Promise.resolve([member({}), member({ user_id: 'u2', display_name: 'Bob', role: 'member' })]),
    myColleagues: () => Promise.resolve([]),
    invitations: read('invitations', { items: [] }),
    platformIdentities: read('platformIdentities', refused),
    putMembership: write('putMembership'),
    removeMembership: write('removeMembership'),
    invite: write('invite'),
    revokeInvitation: write('revokeInvitation'),
    resolvePerson: { fetch: () => Promise.resolve({ user_id: 'u9' }) },
    memberIdentities: read('memberIdentities', { user_id: 'u1', logins: [], aliases: [] }),
    accessCatalogue: read('accessCatalogue', {
      privileges: ['people.view', 'access.manage'],
      default_roles: [{ key: 'owner', name: 'Owner', privileges: ['people.view', 'access.manage'], system: true }],
    }),
    groups: read('groups', { items: [] }),
    myProfile: read('myProfile', { id: 'person-me', display_name: 'Me' }),
    getMe: read('getMe', { subject_id: 'subject-me', subject_tenant_id: 'o1' }),
    getTenant: read('getTenant', tenant('o1', 'Acme')),
    getOrganizations: read('getOrganizations', { items: [] }),
    getWorkspaces: read('getWorkspaces', { items: [tenant('w1', 'Web', { tenant_type: 'ws' })] }),
    getTenantMetadata: read('getTenantMetadata', null),
    putTenantMetadata: write('putTenantMetadata'),
    myMemberships: read('myMemberships', { items: [] }),
    inboundConversions: read('inboundConversions', { items: [] }),
    logo: read('logo', Object.assign(new Error('404'), { response: { status: 404 } })),
    renameTenant: write('renameTenant'),
    deleteTenant: write('deleteTenant'),
    createTenant: { fetch: (body: unknown) => (calls.push({ what: 'createTenant', body }), Promise.resolve({})) },
    connections: read('connections', { items: [{ id: 'c1', secret_ref: 'gh-token' }] }),
    secret: read('secret', {}),
    catalogTypes: read('catalogTypes', { types: [] }),
    typeCounts: read('typeCounts', { counts: [] }),
    gtsTypeTitles: read('gtsTypeTitles', { entities: [] }),
    setTypeComponent: write('setTypeComponent'),
    ...over,
  });
}

// Base UI's checkbox builds a PointerEvent, which jsdom does not have.
globalThis.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent;

/** The element once it is there: `waitFor` retries only a callback that throws. */
async function shown(selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found as HTMLElement;
  });
}

beforeEach(() => {
  calls.length = 0;
  org.value = { id: 'o1', name: 'Acme' };
  serve();
});

describe('People', () => {
  it('asks for an organization when none is in scope', () => {
    org.value = null;
    render(<PeopleSection />);
    expect(screen.getByText('people_pick_org')).toBeTruthy();
  });

  it('lists the members, and keeps the only owner from being demoted or removed', async () => {
    render(<PeopleSection />);
    const ann = (await screen.findByText('Ann Owner')).closest('tr') as HTMLElement;
    expect(screen.getByText('Bob')).toBeTruthy();
    expect((within(ann).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    expect((ann.querySelector('[data-member-remove]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('suspends a member through the membership write, keeping their role', async () => {
    render(<PeopleSection />);
    const bob = (await screen.findByText('Bob')).closest('tr') as HTMLElement;
    fireEvent.click(bob.querySelector('[data-member-standing]') as HTMLElement);
    await waitFor(() => expect(calls.find((c) => c.what === 'putMembership')).toBeTruthy());
    const put = calls.find((c) => c.what === 'putMembership');
    expect(put?.arg).toEqual(['u2', 'o1']);
    expect(put?.body).toEqual({ role: 'member', status: 'suspended' });
  });

  it('offers adding an identity only when the directory answers', async () => {
    const { unmount } = render(<PeopleSection />);
    await screen.findByText('Bob');
    expect(document.querySelector('[data-people-add-identity]')).toBeNull();
    unmount();
    const someone: PlatformIdentity = { id: 'kc9', username: 'zoe', status: 'unassigned' };
    serve({ platformIdentities: read('platformIdentities', { items: [someone] }) });
    render(<PeopleSection />);
    await waitFor(() => expect(document.querySelector('[data-people-add-identity]')).toBeTruthy());
  });

  it('invites by e-mail', async () => {
    render(<PeopleSection />);
    await screen.findByText('Bob');
    fireEvent.change(screen.getByLabelText('people_invite_email'), { target: { value: 'new@acme.io' } });
    fireEvent.click(document.querySelector('[data-people-invite]') as HTMLElement);
    await waitFor(() => expect(calls.find((c) => c.what === 'invite')?.body).toEqual({ email: 'new@acme.io', role: 'member' }));
  });
});

describe('Access', () => {
  it('seeds the caller an Owner grant on switching to roles, and saves the document on the organization', async () => {
    render(<AccessSection />);
    const roles = await screen.findByText('access_model_roles');
    // The caller is known once the profile answered.
    await waitFor(() => expect(calls.some((c) => c.what === 'myProfile')).toBe(true));
    fireEvent.click(roles.closest('label')?.querySelector('input') as HTMLElement);
    const grant = await shown('[data-access-grants] [data-access-grant]');
    expect(grant.textContent).toContain('access_you');
    expect(document.querySelector('[data-access-no-self-grant]')).toBeNull();
    fireEvent.click(document.querySelector('[data-access-save]') as HTMLElement);
    await waitFor(() => expect(calls.find((c) => c.what === 'putTenantMetadata')).toBeTruthy());
    const saved = calls.find((c) => c.what === 'putTenantMetadata');
    expect(saved?.arg).toEqual(['o1', 'gts.cf.core.am.tenant_metadata.v1~cf.studio.access.config.v1~']);
    expect((saved?.body as { model: string; grants: { subjectId: string }[] }).model).toBe('roles');
    expect((saved?.body as { grants: { subjectId: string }[] }).grants[0].subjectId).toBe('person-me');
  });

  it('shows a notice, not the editor, for a self-managed organization', async () => {
    serve({ getTenant: read('getTenant', tenant('o1', 'Acme', { self_managed: true })) });
    render(<AccessSection />);
    await waitFor(() => expect(document.querySelector('[data-access-self-managed]')).toBeTruthy());
    expect(screen.queryByText('access_model_roles')).toBeNull();
  });
});

describe('All identities and Project tenants', () => {
  it('show the backend’s refusal to somebody who is not a platform administrator', async () => {
    render(<IdentitiesSection />);
    expect(await screen.findByText('Only a platform administrator may list identities')).toBeTruthy();
  });

  it('lists the workspaces of every organization and creates one in an organization', async () => {
    serve({ getOrganizations: read('getOrganizations', { items: [tenant('o1', 'Acme')] }) });
    render(<TenantsSection />);
    expect(await screen.findByText('Web')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('tenants_new_name'), { target: { value: 'Docs' } });
    fireEvent.click(document.querySelector('[data-tenant-create]') as HTMLElement);
    await waitFor(() =>
      expect(calls.find((c) => c.what === 'createTenant')?.body).toEqual({
        name: 'Docs',
        parent_id: 'o1',
        tenant_type: 'gts.cf.core.am.tenant_type.v1~cf.studio.tenant.workspace.v1~',
      })
    );
  });

  it('shows the refusal to read the platform root', async () => {
    serve({ getOrganizations: read('getOrganizations', Object.assign(new Error('x'), { response: { status: 404, data: { detail: 'Not found' } } })) });
    render(<TenantsSection />);
    expect(await screen.findByText('Not found')).toBeTruthy();
  });
});

describe('Objects', () => {
  it('marks a type as a component and reads the list back', async () => {
    const t: CatalogType = { type_id: 'gts.cf.studio.x.thing.v1~', leaf_id: 'gts.cf.studio.x.thing.v1~', is_abstract: false, component: false, schema: 'none' };
    serve({ catalogTypes: read('catalogTypes', { types: [t] }) });
    render(<ObjectsSection />);
    const row = (await screen.findByText('Thing')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    await waitFor(() => expect(calls.find((c) => c.what === 'setTypeComponent')).toBeTruthy());
    const set = calls.find((c) => c.what === 'setTypeComponent');
    expect(set?.arg).toEqual(['o1', t.leaf_id]);
    expect(set?.body).toEqual({ component: true });
  });
});

describe('Secrets', () => {
  it('lists the references the workspaces name and probes one', async () => {
    serve({
      getTenantMetadata: read('getTenantMetadata', {
        value: { sources: [{ connection_id: 'c1', full_path: 'acme/web', clone_url: 'https://g/acme/web.git' }] },
      }),
    });
    render(<SecretsSection />);
    const row = (await screen.findByText('gh-token')).closest('tr') as HTMLElement;
    fireEvent.click(row.querySelector('[data-secret-check]') as HTMLElement);
    expect(await within(row).findByText('secrets_readable')).toBeTruthy();
  });
});

describe('Organizations', () => {
  it('shows the organization the path bar picked, and renames it', async () => {
    serve({ myMemberships: read('myMemberships', { items: [{ org_id: 'o1', role: 'owner', status: 'active' }] }) });
    render(<OrganizationsSection />);
    const card = await shown('[data-org-card="o1"]');
    fireEvent.click(card.querySelector('[data-org-rename]') as HTMLElement);
    fireEvent.change(screen.getByLabelText('org_rename'), { target: { value: 'Acme Corp' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(calls.find((c) => c.what === 'renameTenant')?.body).toEqual({ name: 'Acme Corp' }));
  });

  it('flags same-named organizations for a platform administrator', async () => {
    serve({
      getMe: read('getMe', { subject_id: 's', subject_tenant_id: '00000000-0000-0000-0000-000000000001' }),
      getTenant: read('getTenant', tenant('00000000-0000-0000-0000-000000000001', 'Platform', { tenant_type: 'root' })),
      getOrganizations: read('getOrganizations', { items: [tenant('o1', 'Acme'), tenant('o2', 'acme')] }),
    });
    render(<OrganizationsSection />);
    await waitFor(() => expect(screen.getAllByText('org_same_name')).toHaveLength(2));
  });
});
