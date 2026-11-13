/**
 * An organization's access config, as the People and Team screens read and
 * write it: the model, the roles and the grants, kept as account management
 * tenant metadata of `ACCESS_CONFIG_TYPE` — the same document Admin › Access
 * edits and the Studio PDP enforces. Ported from the prototype's `access.ts`
 * (the part these screens use; Admin keeps its own copy with the privilege
 * catalogue).
 */

export const ACCESS_CONFIG_TYPE = 'gts.cf.core.am.tenant_metadata.v1~cf.studio.access.config.v1~';

export type AccessModel = 'tenant' | 'roles';

/** A role is a named set of privileges. */
export interface RoleDef {
  key: string;
  name: string;
  privileges: string[];
  system?: boolean;
}

/** A grant binds a member or a team to a role on the organization or one project. */
export interface GrantDef {
  id: string;
  subjectType: 'member' | 'team';
  subjectId: string;
  subjectName: string;
  roleKey: string;
  scopeType: 'org' | 'project';
  /** Tenant id (org) or project id. */
  scopeId: string;
  scopeName: string;
}

export interface AccessConfig {
  model: AccessModel;
  roles: RoleDef[];
  grants: GrantDef[];
}

/**
 * Fill in any missing pieces so an older or partial stored config still
 * renders. `seeded` is the ladder the server seeds a fresh organization with
 * (`GET /studio-organizations/v1/access-catalogue`), never the browser's idea
 * of it.
 */
export function normalizeAccessConfig(
  v: Partial<AccessConfig> | null | undefined,
  seeded: readonly RoleDef[]
): AccessConfig {
  const model: AccessModel = v?.model === 'roles' ? 'roles' : 'tenant';
  const roles = v?.roles && v.roles.length ? v.roles : [...seeded];
  const grants = Array.isArray(v?.grants) ? (v.grants as GrantDef[]) : [];
  return { model, roles, grants };
}

/** Member grants that reach one project: those scoped to it, plus organization-wide ones. */
export function grantsForProject(cfg: AccessConfig | null, projectId: string): GrantDef[] {
  if (!cfg) return [];
  return cfg.grants.filter(
    (g) =>
      g.subjectType === 'member' &&
      (g.scopeType === 'org' || (g.scopeType === 'project' && g.scopeId === projectId))
  );
}

/** The role a new team member gets when none is picked: `editor`, else the first. */
export function defaultTeamRole(cfg: AccessConfig): RoleDef | undefined {
  return cfg.roles.find((r) => r.key === 'editor') ?? cfg.roles[0];
}

/** A project-scoped grant for one member. `now` and `n` make its id. */
export function projectGrant(
  member: { id: string; name: string },
  roleKey: string,
  project: { id: string; name: string },
  now: number,
  n: number
): GrantDef {
  return {
    id: `g_${now.toString(36)}_${n}`,
    subjectType: 'member',
    // The person id: what every grant names (ADR-0040 §5).
    subjectId: member.id,
    subjectName: member.name,
    roleKey,
    scopeType: 'project',
    scopeId: project.id,
    scopeName: project.name,
  };
}

/** `cfg` with one more grant. */
export function withGrant(cfg: AccessConfig, grant: GrantDef): AccessConfig {
  return { ...cfg, grants: [...cfg.grants, grant] };
}

/** `cfg` without grant `id`. */
export function withoutGrant(cfg: AccessConfig, id: string): AccessConfig {
  return { ...cfg, grants: cfg.grants.filter((g) => g.id !== id) };
}

/** `cfg` with grant `id` on another role. */
export function withGrantRole(cfg: AccessConfig, id: string, roleKey: string): AccessConfig {
  return { ...cfg, grants: cfg.grants.map((g) => (g.id === id ? { ...g, roleKey } : g)) };
}
