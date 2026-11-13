import { describe, expect, it, vi } from 'vitest';
import type { GrantDef } from './access';
import type { Colleague, OrgMember } from './types';
import {
  byName,
  directoryLine,
  fromColleagues,
  fromMembers,
  holderName,
  initials,
  orgPeople,
  withColleagues,
} from './orgPeople';

const member = (user_id: string, over: Partial<OrgMember> = {}): OrgMember => ({
  user_id,
  role: 'member',
  status: 'active',
  ...over,
});

const colleague = (user_id: string, org_id: string, display_name?: string): Colleague => ({
  user_id,
  org_id,
  display_name,
  role: 'member',
  directory: {},
});

const grant = (subjectId: string, over: Partial<GrantDef> = {}): GrantDef => ({
  id: `g-${subjectId}`,
  subjectType: 'member',
  subjectId,
  subjectName: 'as written',
  roleKey: 'editor',
  scopeType: 'project',
  scopeId: 'p1',
  scopeName: 'P1',
  ...over,
});

const refused = async (): Promise<never> => {
  throw new Error('403');
};

describe("an organization's people come from its memberships", () => {
  it('keys each member by the person id a grant names', () => {
    expect(fromMembers([member('u-ada', { display_name: 'Ada', role: 'owner' })])).toEqual([
      { id: 'u-ada', name: 'Ada', email: undefined, role: 'owner' },
    ]);
  });

  it('leaves a suspended member out', () => {
    expect(fromMembers([member('u-1', { status: 'suspended' })])).toEqual([]);
  });

  it('names a person with no name by an address, then by a short id', () => {
    expect(fromMembers([member('u-2', { email: 'bo@x.example' })])[0].name).toBe('bo@x.example');
    expect(fromMembers([member('0123456789')])[0].name).toBe('Person 01234567');
  });

  it('reads the colleague projection for one organization only', () => {
    const people = fromColleagues([colleague('u-a', 'org-1', 'Ann'), colleague('u-b', 'org-2', 'Ben')], 'org-1');
    expect(people.map((p) => p.id)).toEqual(['u-a']);
  });

  it('lists a person once, by name', () => {
    const people = byName([
      { id: 'b', name: 'Zed', role: 'member' },
      { id: 'a', name: 'Ann', role: 'member' },
      { id: 'b', name: 'Zed', role: 'member' },
    ]);
    expect(people.map((p) => p.name)).toEqual(['Ann', 'Zed']);
  });
});

describe('who may read which list', () => {
  it('uses the administrative listing when the caller may read it', async () => {
    const colleagues = vi.fn();
    const people = await orgPeople('org-1', async () => [member('u-1', { display_name: 'One' })], colleagues);
    expect(people.map((p) => p.id)).toEqual(['u-1']);
    expect(colleagues).not.toHaveBeenCalled();
  });

  it('falls back to colleagues for a member without people.view', async () => {
    const people = await orgPeople('org-1', refused, async () => [colleague('u-2', 'org-1', 'Two')]);
    expect(people.map((p) => p.name)).toEqual(['Two']);
  });

  it('fails only when neither list can be read', async () => {
    await expect(
      orgPeople('org-1', refused, async () => {
        throw new Error('down');
      })
    ).rejects.toThrow('down');
  });
});

describe('a grant and a member match by person', () => {
  const people = [{ id: 'u-ada', name: 'Ada', role: 'member' }];

  it('names the holder from the member it names', () => {
    expect(holderName(grant('u-ada'), people)).toBe('Ada');
  });

  it('keeps the stored name for a grant on a login nobody has rekeyed yet', () => {
    expect(holderName(grant('some-login-subject'), people)).toBe('as written');
  });
});

describe('one list of people', () => {
  it('joins each member to their colleague row by person id', () => {
    const rows = withColleagues(
      [
        { id: 'u-a', name: 'Ann', email: 'ann@x.example', role: 'owner' },
        { id: 'u-b', name: 'Ben', role: 'member' },
      ],
      [
        {
          ...colleague('u-a', 'org-1', 'Ann'),
          avatar_url: '/p/a.png',
          last_seen_at_epoch_ms: 5,
          directory: { title: 'CTO' },
        },
        { ...colleague('u-b', 'org-2', 'Ben'), last_seen_at_epoch_ms: 9 },
      ],
      'org-1'
    );
    expect(rows[0]).toEqual({
      id: 'u-a',
      name: 'Ann',
      email: 'ann@x.example',
      role: 'owner',
      avatarUrl: '/p/a.png',
      directory: { title: 'CTO' },
      lastSeenMs: 5,
    });
    // Ben's colleague row is another organization's: nothing joins.
    expect(rows[1]).toEqual({ id: 'u-b', name: 'Ben', role: 'member' });
  });

  it('describes a person by title, department, company and manager', () => {
    const line = directoryLine(
      { title: 'CTO', department: ' R&D ', affiliation: null, reports_to: 'u-b' },
      (id) => (id === 'u-b' ? 'Ben' : undefined),
      (name) => `reports to ${name}`
    );
    expect(line).toBe('CTO · R&D · reports to Ben');
    expect(directoryLine(null, () => undefined, (n) => n)).toBe('');
  });

  it('writes two initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('bo.smith')).toBe('BS');
  });
});
