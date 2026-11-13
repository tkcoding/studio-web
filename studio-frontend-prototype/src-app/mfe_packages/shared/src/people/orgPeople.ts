/**
 * Who is in an organization, as studio-user answers it (ADR-0040). Ported from
 * the prototype's `org-people.ts`. A member is keyed by the canonical person
 * id (`user_id`), which is also what every grant names (ADR-0040 §5), so a
 * grant and a row match by id. Account management's `/tenants/{id}/users` is
 * never read: it lists each account's home tenant, which is not membership.
 */

import type { GrantDef } from './access';
import type { Colleague, MemberDirectory, OrgMember } from './types';

export interface Member {
  /** The canonical person id — the key a grant names. */
  id: string;
  name: string;
  email?: string;
  /** The membership's role: owner, admin or member. */
  role: string;
}

const shortId = (id: string) => id.slice(0, 8);

/** From the administrative listing (`people.view`), active members only. */
export function fromMembers(members: readonly OrgMember[]): Member[] {
  return members
    .filter((m) => m.status === 'active')
    .map((m) => ({
      id: m.user_id,
      name: m.display_name?.trim() || m.email?.trim() || `Person ${shortId(m.user_id)}`,
      email: m.email ?? undefined,
      role: m.role,
    }));
}

/** From the colleague projection any member may read (ADR-0036), for one organization. No address. */
export function fromColleagues(colleagues: readonly Colleague[], orgId: string): Member[] {
  return colleagues
    .filter((c) => c.org_id === orgId)
    .map((c) => ({
      id: c.user_id,
      name: c.display_name?.trim() || `Person ${shortId(c.user_id)}`,
      role: c.role,
    }));
}

/** Sorted by name, one row per person. */
export function byName(members: readonly Member[]): Member[] {
  const seen = new Map<string, Member>();
  for (const m of members) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The name to show for a grant's holder: the member it names, else the name the grant was written with. */
export function holderName(grant: GrantDef, members: readonly Member[]): string {
  return members.find((m) => m.id === grant.subjectId)?.name ?? grant.subjectName;
}

/** A member with what the colleague projection adds: photo, directory and last seen. */
export interface PersonRow extends Member {
  avatarUrl?: string;
  directory?: MemberDirectory | null;
  lastSeenMs?: number;
}

/** The members, each joined to their colleague row by person id. A member with no colleague row keeps what it had. */
export function withColleagues(
  members: readonly Member[],
  colleagues: readonly Colleague[],
  orgId: string
): PersonRow[] {
  const byId = new Map(colleagues.filter((c) => c.org_id === orgId).map((c) => [c.user_id, c]));
  return members.map((m) => {
    const c = byId.get(m.id);
    if (!c) return m;
    return {
      ...m,
      ...(c.avatar_url ? { avatarUrl: c.avatar_url } : {}),
      directory: c.directory ?? null,
      ...(c.last_seen_at_epoch_ms != null ? { lastSeenMs: c.last_seen_at_epoch_ms } : {}),
    };
  });
}

/**
 * How the organization describes a person: title, department, company and
 * the manager they report to (by name when a member carries the id).
 */
export function directoryLine(
  directory: MemberDirectory | null | undefined,
  nameOf: (id: string) => string | undefined,
  reportsTo: (name: string) => string
): string {
  if (!directory) return '';
  const parts = [directory.title, directory.department, directory.affiliation]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
  const manager = directory.reports_to ? nameOf(directory.reports_to) : undefined;
  if (manager) parts.push(reportsTo(manager));
  return parts.join(' · ');
}

/**
 * An organization's members: the administrative listing when the caller may
 * read it (`people.view`), otherwise the colleague projection, which every
 * member may read. Throws only when neither can be read.
 */
export async function orgPeople(
  orgId: string,
  readMembers: (orgId: string) => Promise<readonly OrgMember[]>,
  readColleagues: () => Promise<readonly Colleague[]>
): Promise<Member[]> {
  try {
    return byName(fromMembers(await readMembers(orgId)));
  } catch {
    return byName(fromColleagues(await readColleagues(), orgId));
  }
}

/** Two letters for a person without a photo. */
export function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
