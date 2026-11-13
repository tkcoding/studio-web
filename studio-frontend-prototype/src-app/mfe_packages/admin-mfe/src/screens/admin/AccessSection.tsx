/**
 * Admin › Access — the prototype's `AccessView` (`App.tsx`) carried over
 * (ADR-0069): choose the organization's access model and, when it is
 * role-based, edit the roles (each a set of privileges) and the grants
 * (member or team × role × the whole organization or one workspace). Stored as
 * the organization's AM tenant metadata; the privilege catalogue and the seeded
 * ladder come from the side that evaluates them (`studio-organizations`).
 *
 * A self-managed organization is governed from inside: a notice, not the editor.
 * Switching to role-based seeds an Owner grant for the caller, so nobody locks
 * themselves out.
 */

import { useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { AccountsApiService, useOrganization, type OrganizationRef, type Tenant } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import {
  ACCESS_MODELS,
  normalizeAccessConfig,
  privilegesByGroup,
  type AccessConfig,
  type AccessModel,
  type GrantDef,
} from '../../model/access';
import { byName, fromColleagues, fromMembers, type Member } from '../../model/members';
import { ErrorLine, Header, errText, useAdmin } from './common';
import styles from './Admin.module.css';

/** Where AM keeps the organization's access document. */
export const ACCESS_TYPE = 'gts.cf.core.am.tenant_metadata.v1~cf.studio.access.config.v1~';

export function AccessSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;
  return <Access key={org.id} org={org} />;
}

interface Loaded {
  cfg: AccessConfig;
  privileges: string[];
  tenant: Tenant | null;
}

function Access({ org }: { org: OrganizationRef }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [cfg, setCfg] = useState<AccessConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Grant subjects: the organization's members and teams (RG groups); scopes: its workspaces.
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Member[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  // The caller: what a self grant names (ADR-0040 §5), the sign-in subject until the person is known.
  const [me, setMe] = useState<{ personId: string | null; subject: string; name: string }>({
    personId: null,
    subject: '',
    name: '',
  });
  // Add-grant form.
  const [gSubjectType, setGSubjectType] = useState<'member' | 'team'>('member');
  const [gSubject, setGSubject] = useState('');
  const [gRole, setGRole] = useState('');
  const [gScope, setGScope] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([
      accounts
        .getTenantMetadata<Partial<AccessConfig>>({ tenantId: org.id, metadataType: ACCESS_TYPE })
        .fetch({ staleTime: 0 }),
      api.accessCatalogue.fetch({ staleTime: 0 }),
      accounts
        .getTenant({ tenantId: org.id })
        .fetch({ staleTime: 0 })
        .catch(() => null),
    ]).then(
      ([entry, catalogue, tenant]) => {
        if (!live) return;
        const normalized = normalizeAccessConfig(entry?.value ?? null, catalogue.default_roles);
        setLoaded({ cfg: normalized, privileges: catalogue.privileges, tenant });
        setCfg(normalized);
      },
      (e: unknown) => live && setError(errText(e))
    );
    return () => {
      live = false;
    };
  }, [api, accounts, org.id]);

  // Best-effort: a failed read just leaves a picker empty.
  useEffect(() => {
    let live = true;
    api.orgMembers(org.id).then(
      (list) => live && setMembers(byName(fromMembers(list))),
      () =>
        api.myColleagues().then(
          (list) => live && setMembers(byName(fromColleagues(list, org.id))),
          () => live && setMembers([])
        )
    );
    api.groups.fetch({ staleTime: 0 }).then(
      (p) => live && setTeams((p.items ?? []).map((g) => ({ id: g.id, name: g.name ?? g.id.slice(0, 8) }))),
      () => live && setTeams([])
    );
    accounts
      .getWorkspaces({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then(
        (p) => live && setProjects((p?.items ?? []).map((w) => ({ id: w.id, name: w.name }))),
        () => live && setProjects([])
      );
    Promise.all([
      accounts.getMe.fetch().catch(() => null),
      api.myProfile.fetch({ staleTime: 0 }).catch(() => null),
    ]).then(([who, profile]) => {
      if (!live) return;
      setMe({
        personId: profile?.id ?? null,
        subject: who?.subject_id ?? '',
        name: profile?.display_name?.trim() || profile?.email?.trim() || '',
      });
    });
    return () => {
      live = false;
    };
  }, [api, accounts, org.id]);

  const myKeys = [me.personId, me.subject].filter((k): k is string => !!k);
  const selfManaged = loaded?.tenant?.self_managed ?? false;
  const privileges = loaded?.privileges ?? [];

  function mutate(next: AccessConfig) {
    setCfg(next);
    setDirty(true);
    setSaved(false);
  }

  const subjectPool = gSubjectType === 'member' ? members : teams;

  function addGrant() {
    if (!cfg || !gSubject || !gRole) return;
    const subj = subjectPool.find((s) => s.id === gSubject);
    const scopeProj = projects.find((p) => p.id === gScope);
    const grant: GrantDef = {
      id: `g_${Date.now().toString(36)}_${cfg.grants.length}`,
      subjectType: gSubjectType,
      subjectId: gSubject,
      subjectName: subj?.name ?? gSubject.slice(0, 8),
      roleKey: gRole,
      scopeType: gScope ? 'project' : 'org',
      scopeId: gScope,
      scopeName: gScope ? (scopeProj?.name ?? gScope.slice(0, 8)) : org.name,
    };
    mutate({ ...cfg, grants: [...cfg.grants, grant] });
    setGSubject('');
  }

  const selfGranted = (c: AccessConfig): boolean =>
    c.grants.some((g) => g.subjectType === 'member' && myKeys.includes(g.subjectId));

  /** An org-wide Owner grant for the caller, so enabling roles cannot lock them out. Idempotent. */
  function withSelfOwner(c: AccessConfig): AccessConfig {
    if (selfGranted(c)) return c;
    const ownerKey = c.roles.some((r) => r.key === 'owner') ? 'owner' : (c.roles[0]?.key ?? 'owner');
    const grant: GrantDef = {
      // One self grant per person (`selfGranted` keeps it idempotent), so the person names it.
      id: `g_self_${me.personId ?? me.subject}`,
      subjectType: 'member',
      subjectId: me.personId ?? me.subject,
      subjectName: t('access_you', { name: me.name || me.subject.slice(0, 8) }),
      roleKey: ownerKey,
      scopeType: 'org',
      scopeId: '',
      scopeName: org.name,
    };
    return { ...c, grants: [...c.grants, grant] };
  }

  function setModel(model: AccessModel) {
    if (!cfg) return;
    // Role-based without a grant for yourself would hide everything from you
    // once enforcement is on — seed a self Owner grant up front.
    mutate(model === 'roles' ? withSelfOwner({ ...cfg, model }) : { ...cfg, model });
  }

  function togglePrivilege(roleKey: string, privId: string) {
    if (!cfg) return;
    mutate({
      ...cfg,
      roles: cfg.roles.map((r) => {
        if (r.key !== roleKey) return r;
        const has = r.privileges.includes(privId);
        return { ...r, privileges: has ? r.privileges.filter((p) => p !== privId) : [...r.privileges, privId] };
      }),
    });
  }

  function addRole() {
    if (!cfg) return;
    const key = `role_${cfg.roles.length + 1}_${privileges.length}`.replace(/[^a-z0-9_]/gi, '');
    mutate({ ...cfg, roles: [...cfg.roles, { key, name: t('access_new_role'), privileges: ['people.view'] }] });
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      await accounts.putTenantMetadata<AccessConfig>(org.id, ACCESS_TYPE).fetch(cfg);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const groups = privilegesByGroup(privileges);

  return (
    <>
      <Header
        title={t('access_title')}
        info={<p>{t('access_about', { name: org.name })}</p>}
        action={
          <Button disabled={!cfg || !dirty || busy || selfManaged} onClick={() => void save()} data-access-save>
            {busy ? t('saving') : saved && !dirty ? t('saved') : t('save')}
          </Button>
        }
      />
      {error && <ErrorLine>{error}</ErrorLine>}

      {!loaded && !error ? (
        <p className={styles.muted}>{t('reading')}</p>
      ) : !cfg ? null : selfManaged ? (
        <p className={styles.notice} data-access-self-managed>
          {t('access_self_managed', { name: org.name })}
        </p>
      ) : (
        <>
          <Card>
            <CardContent className={styles.cardBody}>
              <h3 className={styles.subtitle}>{t('access_model')}</h3>
              <div className={styles.models} role="radiogroup" aria-label={t('access_model')}>
                {ACCESS_MODELS.map((m) => (
                  <label key={m.id} className={`${styles.model} ${cfg.model === m.id ? styles.modelOn : ''}`}>
                    <input
                      type="radio"
                      name="access-model"
                      checked={cfg.model === m.id}
                      onChange={() => setModel(m.id)}
                      data-access-model={m.id}
                    />
                    <div>
                      <div className={styles.name}>{t(`access_model_${m.id}`)}</div>
                      <div className={styles.sub}>{t(`access_model_${m.id}_blurb`)}</div>
                    </div>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {cfg.model === 'roles' ? (
            <>
              <p className={styles.notice}>{t('access_rolling_out')}</p>
              {!selfGranted(cfg) && (
                <p className={`${styles.notice} ${styles.danger}`} data-access-no-self-grant>
                  {t('access_no_grant')}{' '}
                  <Button size="sm" variant="outline" onClick={() => mutate(withSelfOwner(cfg))}>
                    {t('access_grant_myself')}
                  </Button>
                </p>
              )}
              {cfg.roles.map((role) => (
                <Card key={role.key} data-access-role={role.key}>
                  <CardContent className={styles.cardBody}>
                    <div className={styles.roleHead}>
                      <Input
                        className={styles.search}
                        aria-label={t('access_role_name')}
                        value={role.name}
                        onChange={(e) =>
                          mutate({
                            ...cfg,
                            roles: cfg.roles.map((r) => (r.key === role.key ? { ...r, name: e.target.value } : r)),
                          })
                        }
                      />
                      {role.system ? (
                        <Badge variant="secondary" title={t('access_system_hint')}>
                          {t('access_system')}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mutate({ ...cfg, roles: cfg.roles.filter((r) => r.key !== role.key) })}
                        >
                          {t('delete')}
                        </Button>
                      )}
                      <span className={`${styles.sub} ${styles.headerAction}`}>
                        {t('access_privilege_count', { have: role.privileges.length, all: privileges.length })}
                      </span>
                    </div>
                    <div className={styles.roleGrid}>
                      {groups.map((g) => (
                        <div key={g.group} className={styles.group}>
                          <div className={styles.groupLabel}>{g.group}</div>
                          {g.items.map((p) => (
                            <label key={p.id} className={styles.check}>
                              <Checkbox
                                // Owner holds every privilege, never editable.
                                disabled={role.key === 'owner'}
                                checked={role.privileges.includes(p.id)}
                                onCheckedChange={() => togglePrivilege(role.key, p.id)}
                              />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              <div>
                <Button variant="outline" onClick={addRole} data-access-add-role>
                  {t('access_add_role')}
                </Button>
              </div>

              <Card data-access-grants>
                <CardContent className={styles.cardBody}>
                  <h3 className={styles.subtitle}>{t('access_grants')}</h3>
                  <p className={styles.muted}>{t('access_grants_about')}</p>
                  {cfg.grants.length === 0 ? (
                    <p className={styles.muted}>{t('access_no_grants')}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('access_col_subject')}</TableHead>
                          <TableHead>{t('access_col_role')}</TableHead>
                          <TableHead>{t('access_col_scope')}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cfg.grants.map((g) => (
                          <TableRow key={g.id} data-access-grant={g.id}>
                            <TableCell>
                              <Badge variant="secondary">{t(`access_subject_${g.subjectType}`)}</Badge> {g.subjectName}
                            </TableCell>
                            <TableCell>{cfg.roles.find((r) => r.key === g.roleKey)?.name ?? g.roleKey}</TableCell>
                            <TableCell className={styles.sub}>
                              {g.scopeType === 'org' ? t('access_scope_org', { name: g.scopeName }) : g.scopeName}
                            </TableCell>
                            <TableCell className={styles.num}>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => mutate({ ...cfg, grants: cfg.grants.filter((x) => x.id !== g.id) })}
                              >
                                {t('remove')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  <div className={styles.inline}>
                    <NativeSelect
                      aria-label={t('access_col_subject')}
                      value={gSubjectType}
                      onChange={(e) => {
                        setGSubjectType(e.target.value as 'member' | 'team');
                        setGSubject('');
                      }}
                    >
                      <NativeSelectOption value="member">{t('access_subject_member')}</NativeSelectOption>
                      <NativeSelectOption value="team">{t('access_subject_team')}</NativeSelectOption>
                    </NativeSelect>
                    <NativeSelect aria-label={t('access_pick_subject')} value={gSubject} onChange={(e) => setGSubject(e.target.value)}>
                      <NativeSelectOption value="">
                        {subjectPool.length
                          ? t(`access_select_${gSubjectType}`)
                          : gSubjectType === 'team'
                            ? t('access_no_teams')
                            : t('access_no_members')}
                      </NativeSelectOption>
                      {subjectPool.map((s) => (
                        <NativeSelectOption key={s.id} value={s.id}>
                          {s.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect aria-label={t('access_col_role')} value={gRole} onChange={(e) => setGRole(e.target.value)}>
                      <NativeSelectOption value="">{t('access_select_role')}</NativeSelectOption>
                      {cfg.roles.map((r) => (
                        <NativeSelectOption key={r.key} value={r.key}>
                          {r.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect aria-label={t('access_col_scope')} value={gScope} onChange={(e) => setGScope(e.target.value)}>
                      <NativeSelectOption value="">{t('access_whole_org')}</NativeSelectOption>
                      {projects.map((p) => (
                        <NativeSelectOption key={p.id} value={p.id}>
                          {p.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button disabled={!gSubject || !gRole} onClick={addGrant} data-access-add-grant>
                      {t('access_add_grant')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <p className={styles.notice}>{t('access_tenant_on')}</p>
          )}
        </>
      )}
    </>
  );
}
