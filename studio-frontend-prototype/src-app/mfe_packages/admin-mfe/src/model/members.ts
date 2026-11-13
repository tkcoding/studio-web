/**
 * Small pure helpers the prototype kept beside its screens
 * (`org-admin.tsx`, `people-profile.tsx`, `org-people.ts`,
 * `identity-directory.tsx` at 00828880), lifted out so they can be tested
 * without a DOM. The sentences stay English where the prototype composed them.
 */

import type {
  Colleague,
  DirectoryMembership,
  MemberDirectory,
  OrgMember,
  PersonEmail,
  PlatformIdentity,
} from '../api/types';

/** The platform's root tenant: a person homed there is a platform administrator. */
export const PLATFORM_ROOT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const shortId = (id: string) => id.slice(0, 8);

/** The address to show first: the one the backend marks primary, else the profile's own. */
export function primaryEmail(person: { email?: string | null; emails?: PersonEmail[] }): string | null {
  return person.emails?.find((e) => e.primary)?.address ?? (person.email?.trim() || null);
}

/** Every other address the person holds, in the backend's order. */
export function otherEmails(person: { email?: string | null; emails?: PersonEmail[] }): PersonEmail[] {
  const first = primaryEmail(person);
  return (person.emails ?? []).filter((e) => e.address !== first);
}

/** What a member is called: their name, else their address, else their id. */
export function memberName(m: Pick<OrgMember, 'display_name' | 'email' | 'emails' | 'user_id'>): string {
  return m.display_name?.trim() || primaryEmail(m) || `Person ${shortId(m.user_id)}`;
}

/** How the organization describes the person, in one line: title,
 *  department, company, and who they report to. Empty when it says nothing. */
export function directoryLine(
  directory: MemberDirectory | null | undefined,
  nameOf: (userId: string) => string | undefined
): string {
  if (!directory) return '';
  const manager = directory.reports_to ? nameOf(directory.reports_to) : undefined;
  return [directory.title, directory.department, directory.affiliation, manager ? `reports to ${manager}` : null]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ');
}

export function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Somebody a grant can name: the canonical person id and what to call them. */
export interface Member {
  id: string;
  name: string;
}

/** From the administrative listing, active members only. */
export function fromMembers(members: OrgMember[]): Member[] {
  return members
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.user_id, name: m.display_name?.trim() || m.email?.trim() || `Person ${shortId(m.user_id)}` }));
}

/** From the colleague projection any member may read, for one organization. */
export function fromColleagues(colleagues: Colleague[], orgId: string): Member[] {
  return colleagues
    .filter((c) => c.org_id === orgId)
    .map((c) => ({ id: c.user_id, name: c.display_name?.trim() || `Person ${shortId(c.user_id)}` }));
}

/** Sorted by name, one row per person. */
export function byName(members: Member[]): Member[] {
  const seen = new Map<string, Member>();
  for (const m of members) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Same-named organizations, by their lowercased trimmed name. */
export function duplicateNames(orgs: { name: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const o of orgs) {
    const key = o.name.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
}

/* ── The identity directory (identity-directory.tsx) ── */

/** Their memberships in organizations — the platform root is not one. `null`
 *  when Studio could not say, and the IdP attributes are all there is. */
export function orgMemberships(identity: PlatformIdentity): DirectoryMembership[] | null {
  return identity.memberships ? identity.memberships.filter((m) => m.org_id !== PLATFORM_ROOT_TENANT_ID) : null;
}

/** The organization the row's controls start on: where they belong, else
 *  where the IdP says, else nothing — never silently the first in the list. */
export function currentOrg(identity: PlatformIdentity): string {
  const held = orgMemberships(identity);
  if (held) return (held.find((m) => m.status === 'active') ?? held[0])?.org_id ?? '';
  return identity.home_tenant_id && identity.home_tenant_id !== PLATFORM_ROOT_TENANT_ID ? identity.home_tenant_id : '';
}

/** Their role in `orgId` as it stands, or `undefined` when they have none there. */
export function roleIn(identity: PlatformIdentity, orgId: string): string | undefined {
  const held = orgMemberships(identity);
  if (held) return held.find((m) => m.org_id === orgId)?.role;
  return identity.home_tenant_id === orgId ? identity.organization_role : undefined;
}

/** What the IdP's attribute claims that Studio's memberships do not, as
 *  `{ kind, name }` for the screen to word: `home` names another organization
 *  as home, `role` names another role. */
export function idpDrift(identity: PlatformIdentity): { kind: 'home' | 'role'; name: string } | null {
  const held = orgMemberships(identity);
  const home = identity.home_tenant_id;
  if (!held || !home || home === PLATFORM_ROOT_TENANT_ID) return null;
  const there = held.find((m) => m.org_id === home && m.status === 'active');
  if (!there) return { kind: 'home', name: identity.home_tenant_name ?? '' };
  if (identity.organization_role && identity.organization_role !== there.role)
    return { kind: 'role', name: identity.organization_role };
  return null;
}
