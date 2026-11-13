import { describe, expect, it } from 'vitest';
import {
  defaultTeamRole,
  grantsForProject,
  normalizeAccessConfig,
  projectGrant,
  withGrant,
  withGrantRole,
  withoutGrant,
  type AccessConfig,
  type GrantDef,
  type RoleDef,
} from './access';

const role = (key: string): RoleDef => ({ key, name: key.toUpperCase(), privileges: [] });
const grant = (id: string, over: Partial<GrantDef> = {}): GrantDef => ({
  id,
  subjectType: 'member',
  subjectId: `u-${id}`,
  subjectName: id,
  roleKey: 'viewer',
  scopeType: 'project',
  scopeId: 'p1',
  scopeName: 'P1',
  ...over,
});

describe('access config', () => {
  it('reads an absent config as tenant access with the seeded ladder', () => {
    expect(normalizeAccessConfig(null, [role('owner')])).toEqual({
      model: 'tenant',
      roles: [role('owner')],
      grants: [],
    });
  });

  it('keeps the stored ladder over the seeded one', () => {
    const cfg = normalizeAccessConfig({ model: 'roles', roles: [role('editor')] }, [role('owner')]);
    expect(cfg.model).toBe('roles');
    expect(cfg.roles.map((r) => r.key)).toEqual(['editor']);
  });

  it("finds a project's team: member grants on it and organization-wide ones", () => {
    const cfg: AccessConfig = {
      model: 'roles',
      roles: [],
      grants: [
        grant('a'),
        grant('b', { scopeType: 'org', scopeId: '' }),
        grant('c', { scopeId: 'p2' }),
        grant('d', { subjectType: 'team' }),
      ],
    };
    expect(grantsForProject(cfg, 'p1').map((g) => g.id)).toEqual(['a', 'b']);
    expect(grantsForProject(null, 'p1')).toEqual([]);
  });

  it('gives a new team member editor, else the first role', () => {
    expect(defaultTeamRole({ model: 'roles', roles: [role('viewer'), role('editor')], grants: [] })?.key).toBe(
      'editor'
    );
    expect(defaultTeamRole({ model: 'roles', roles: [role('viewer')], grants: [] })?.key).toBe('viewer');
  });

  it('adds, re-roles and removes a project grant', () => {
    const g = projectGrant({ id: 'u-ann', name: 'Ann' }, 'editor', { id: 'p1', name: 'P1' }, 36, 0);
    expect(g).toEqual({
      id: 'g_10_0',
      subjectType: 'member',
      subjectId: 'u-ann',
      subjectName: 'Ann',
      roleKey: 'editor',
      scopeType: 'project',
      scopeId: 'p1',
      scopeName: 'P1',
    });
    const cfg = withGrant({ model: 'roles', roles: [], grants: [] }, g);
    expect(withGrantRole(cfg, g.id, 'viewer').grants[0].roleKey).toBe('viewer');
    expect(withoutGrant(cfg, g.id).grants).toEqual([]);
  });
});
