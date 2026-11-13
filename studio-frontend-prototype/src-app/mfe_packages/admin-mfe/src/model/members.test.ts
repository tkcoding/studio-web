import { describe, expect, it } from 'vitest';
import type { OrgMember, PlatformIdentity } from '../api/types';
import {
  PLATFORM_ROOT_TENANT_ID,
  byName,
  currentOrg,
  directoryLine,
  duplicateNames,
  fromColleagues,
  fromMembers,
  idpDrift,
  initials,
  memberName,
  orgMemberships,
  otherEmails,
  primaryEmail,
  roleIn,
} from './members';

const member = (patch: Partial<OrgMember>): OrgMember => ({
  user_id: 'u1234567890',
  role: 'member',
  status: 'active',
  source: 'invitation',
  created_at_epoch_ms: 0,
  updated_at_epoch_ms: 0,
  ...patch,
});

const identity = (patch: Partial<PlatformIdentity>): PlatformIdentity => ({
  id: 'kc1',
  username: 'ann',
  status: 'assigned',
  ...patch,
});

describe('what a member is called', () => {
  it('prefers the name, then the primary address, then a short id', () => {
    expect(memberName(member({ display_name: ' Ann ' }))).toBe('Ann');
    expect(
      memberName(
        member({
          email: 'old@x.io',
          emails: [
            { address: 'a@x.io', source: 'alias', verified: false, primary: false },
            { address: 'p@x.io', source: 'profile', verified: true, primary: true },
          ],
        })
      )
    ).toBe('p@x.io');
    expect(memberName(member({}))).toBe('Person u1234567');
  });

  it('lists the other addresses apart from the one shown first', () => {
    const m = member({
      email: 'p@x.io',
      emails: [
        { address: 'p@x.io', source: 'profile', verified: true, primary: false },
        { address: 'b@x.io', source: 'sign_in', verified: true, primary: false },
      ],
    });
    expect(primaryEmail(m)).toBe('p@x.io');
    expect(otherEmails(m).map((e) => e.address)).toEqual(['b@x.io']);
  });

  it('says the directory in one line, naming the manager', () => {
    expect(directoryLine(null, () => undefined)).toBe('');
    expect(
      directoryLine({ title: 'Lead', department: ' ', affiliation: 'Acme', reports_to: 'u2' }, (id) =>
        id === 'u2' ? 'Bob' : undefined
      )
    ).toBe('Lead · Acme · reports to Bob');
  });

  it('takes initials from the words of a name', () => {
    expect(initials('ann.lee')).toBe('AL');
    expect(initials('Mary Ann Smith')).toBe('MA');
  });
});

describe('grant subjects', () => {
  it('keeps active members, named, and colleagues of one organization', () => {
    expect(fromMembers([member({ display_name: 'Ann' }), member({ user_id: 'u2', status: 'suspended' })])).toEqual([
      { id: 'u1234567890', name: 'Ann' },
    ]);
    expect(
      fromColleagues(
        [
          { org_id: 'o1', user_id: 'u1', role: 'member', display_name: 'Ann' },
          { org_id: 'o2', user_id: 'u2', role: 'member' },
        ],
        'o1'
      )
    ).toEqual([{ id: 'u1', name: 'Ann' }]);
  });

  it('sorts by name with one row per person', () => {
    expect(
      byName([
        { id: 'b', name: 'Bob' },
        { id: 'a', name: 'Ann' },
        { id: 'b', name: 'Bob again' },
      ])
    ).toEqual([
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Bob' },
    ]);
  });
});

describe('same-named organizations', () => {
  it('are flagged by trimmed, lowercased name', () => {
    expect([...duplicateNames([{ name: 'Acme' }, { name: ' acme ' }, { name: 'Other' }])]).toEqual(['acme']);
  });
});

describe('the identity directory', () => {
  it('drops the platform root from the memberships, and knows when Studio could not say', () => {
    expect(orgMemberships(identity({ memberships: null }))).toBeNull();
    expect(
      orgMemberships(
        identity({
          memberships: [
            { org_id: PLATFORM_ROOT_TENANT_ID, role: 'owner', status: 'active' },
            { org_id: 'o1', role: 'member', status: 'active' },
          ],
        })
      )?.map((m) => m.org_id)
    ).toEqual(['o1']);
  });

  it('starts the row on where they belong, else where Keycloak says, never the first organization', () => {
    expect(
      currentOrg(
        identity({
          memberships: [
            { org_id: 'o1', role: 'member', status: 'suspended' },
            { org_id: 'o2', role: 'admin', status: 'active' },
          ],
        })
      )
    ).toBe('o2');
    expect(currentOrg(identity({ home_tenant_id: 'o3' }))).toBe('o3');
    expect(currentOrg(identity({ home_tenant_id: PLATFORM_ROOT_TENANT_ID }))).toBe('');
  });

  it('reads their role from the memberships, else the IdP attribute', () => {
    expect(roleIn(identity({ memberships: [{ org_id: 'o1', role: 'owner', status: 'active' }] }), 'o1')).toBe('owner');
    expect(roleIn(identity({ home_tenant_id: 'o1', organization_role: 'admin' }), 'o1')).toBe('admin');
  });

  it('names what Keycloak still claims that the memberships do not', () => {
    expect(
      idpDrift(identity({ home_tenant_id: 'o1', home_tenant_name: 'Old', memberships: [] }))
    ).toEqual({ kind: 'home', name: 'Old' });
    expect(
      idpDrift(
        identity({
          home_tenant_id: 'o1',
          organization_role: 'admin',
          memberships: [{ org_id: 'o1', role: 'member', status: 'active' }],
        })
      )
    ).toEqual({ kind: 'role', name: 'admin' });
    expect(
      idpDrift(identity({ home_tenant_id: 'o1', memberships: [{ org_id: 'o1', role: 'member', status: 'active' }] }))
    ).toBeNull();
  });
});
