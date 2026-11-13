/**
 * Project › Team — the prototype's `PeopleView` in `mode="team"`
 * (`people.tsx`), carried over (ADR-0069) as the `project-team` kit's screen:
 * who works on this project and in which role. The team is the role grants in
 * the organization's access config scoped to this project, plus the
 * organization-wide ones (shown, managed in Admin › Access). Adding a person,
 * changing their role or removing them writes that config — the same document
 * the Studio PDP enforces. Under tenant access everyone in the organization
 * can work everywhere, so there is no per-project team to manage, and the
 * screen says so.
 *
 * Who may write is the backend's to say: a refused write shows its refusal.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { apiRegistry, useSharedProperty, type ChildMfeBridge } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import {
  ACCESS_CONFIG_TYPE,
  AccountsApiService,
  OrganizationProvider,
  PeopleApiService,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  defaultTeamRole,
  errorMessage,
  grantsForProject,
  holderName,
  initials,
  normalizeAccessConfig,
  openScreen,
  orgPeople,
  projectGrant,
  refusalText,
  useHostChrome,
  useOrganization,
  withGrant,
  withGrantRole,
  withoutGrant,
  type AccessConfig,
  type GrantDef,
  type Member,
  type OrganizationRef,
  type RoleDef,
  type ScreenText,
} from '@constructor-studio/mfe-shared';
import { useTeamTranslations } from '../../i18n';
import styles from './TeamScreen.module.css';

const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** Where the organization's access model is switched, and where people are invited. */
export const ACCESS_ROUTE = '/admin/access';
export const PEOPLE_ROUTE = '/people';

/** The members, the access config and the project's name; fails only when nobody can be read. */
async function readTeam(
  orgId: string,
  projectId: string
): Promise<{ members: Member[]; cfg: AccessConfig; projectName: string | null }> {
  const api = apiRegistry.getService(PeopleApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [members, access, seeded, projectName] = await Promise.all([
    orgPeople(
      orgId,
      (id) => api.orgMembers(id),
      () => api.myColleagues()
    ),
    accounts
      .getTenantMetadata<Partial<AccessConfig>>({ tenantId: orgId, metadataType: ACCESS_CONFIG_TYPE })
      .fetch({ staleTime: 0 })
      .then(
        (entry) => entry?.value ?? null,
        () => null
      ),
    // The ladder a fresh organization is seeded with, from the side that seeds it.
    api.accessCatalogue.fetch({ staleTime: 0 }).then(
      (c) => c.default_roles,
      () => [] as RoleDef[]
    ),
    accounts
      .getTenant({ tenantId: projectId })
      .fetch({ staleTime: 0 })
      .then(
        (p) => p.name,
        () => null
      ),
  ]);
  return { members, cfg: normalizeAccessConfig(access, seeded), projectName };
}

export const TeamScreen: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const { containerRef, dataTheme } = useHostChrome();
  const { t, loading } = useTeamTranslations();
  const project = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);
  const projectId = typeof project === 'string' && project ? project : null;
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme}>
      {loading ? (
        <Skeleton className={styles.skeleton} />
      ) : (
        <OrganizationProvider>
          <InScope t={t} bridge={bridge} projectId={projectId} container={containerRef} />
        </OrganizationProvider>
      )}
    </div>
  );
};

TeamScreen.displayName = 'TeamScreen';

interface ScopeProps {
  t: ScreenText;
  bridge: ChildMfeBridge | null;
  projectId: string | null;
  container: React.RefObject<HTMLDivElement | null>;
}

function InScope({ t, bridge, projectId, container }: ScopeProps) {
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('loading')}</p>;
  if (!projectId) return <p className={styles.muted}>{t('no_project')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;
  // Keyed by the scope: another project is another read, from nothing.
  return <Team key={`${org.id}:${projectId}`} t={t} bridge={bridge} org={org} projectId={projectId} container={container} />;
}

function Team({
  t,
  bridge,
  org,
  projectId,
  container,
}: Omit<ScopeProps, 'projectId'> & { org: OrganizationRef; projectId: string }) {
  const [people, setPeople] = useState<Member[] | null>(null);
  const [cfg, setCfg] = useState<AccessConfig | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<GrantDef | null>(null);

  useEffect(() => {
    let live = true;
    readTeam(org.id, projectId).then(
      (read) => {
        if (!live) return;
        setPeople(read.members);
        setCfg(read.cfg);
        setProjectName(read.projectName);
      },
      // Nobody could be read: say why, and show no team rather than an empty one.
      (e: unknown) => live && setError(errText(e))
    );
    return () => {
      live = false;
    };
  }, [org.id, projectId]);

  const save = async (next: AccessConfig) => {
    setBusy(true);
    setError(null);
    try {
      await apiRegistry
        .getService(AccountsApiService)
        .putTenantMetadata<AccessConfig>(org.id, ACCESS_CONFIG_TYPE)
        .fetch(next);
      setCfg(next);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const all = useMemo(() => people ?? [], [people]);
  const project = { id: projectId, name: projectName ?? t('this_project') };
  const roleBased = cfg?.model === 'roles';
  const teamGrants = grantsForProject(cfg, projectId);
  const granted = new Set(teamGrants.map((g) => g.subjectId));
  const candidates = all.filter((p) => !granted.has(p.id));
  const personName = (g: GrantDef) => holderName(g, all);

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        {people !== null && cfg !== null && (
          <div className={styles.chips} data-team-status>
            {roleBased ? (
              <Badge variant={teamGrants.length > 0 ? 'secondary' : 'warning'} data-team-count>
                {t.count('people', teamGrants.length)}
              </Badge>
            ) : (
              <Badge variant="info" title={t('tenant_hint')}>
                {t('tenant_access')}
              </Badge>
            )}
          </div>
        )}
        {roleBased && (
          <div className={styles.headerAction}>
            <Button
              disabled={busy || candidates.length === 0}
              title={candidates.length === 0 ? t('everyone_on_team') : undefined}
              onClick={() => setAdding(true)}
              data-team-add-open
            >
              {t('add')}
            </Button>
          </div>
        )}
      </header>
      <div className={styles.about}>
        <p>{t('about_1', { project: project.name, org: org.name })}</p>
        <p>{t('about_2', { org: org.name })}</p>
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {people === null || cfg === null ? (
        error ? null : (
          <p className={styles.muted}>{t('loading_team')}</p>
        )
      ) : !roleBased ? (
        <div className={styles.empty} data-team-tenant>
          <strong>{t('tenant_title', { org: org.name })}</strong>
          <span className={styles.muted}>{t('tenant_body')}</span>
          <Button variant="outline" onClick={() => openScreen(bridge, ACCESS_ROUTE)}>
            {t('open_access')}
          </Button>
        </div>
      ) : teamGrants.length === 0 ? (
        <div className={styles.empty} data-team-empty>
          <strong>{t('empty_title')}</strong>
          <div className={styles.chips}>
            <Button disabled={candidates.length === 0} onClick={() => setAdding(true)}>
              {t('add')}
            </Button>
            <Button variant="ghost" onClick={() => openScreen(bridge, PEOPLE_ROUTE)}>
              {t('open_people')}
            </Button>
          </div>
        </div>
      ) : (
        <Table data-team-list>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_person')}</TableHead>
              <TableHead>{t('col_role')}</TableHead>
              <TableHead>{t('col_scope')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...teamGrants]
              .sort((a, b) => personName(a).localeCompare(personName(b)))
              .map((g) => {
                const person = all.find((p) => p.id === g.subjectId);
                const orgWide = g.scopeType === 'org';
                return (
                  <TableRow key={g.id} data-team-grant={g.id}>
                    <TableCell>
                      <div className={styles.pcell}>
                        <span className={styles.photo} aria-hidden>
                          {initials(personName(g))}
                        </span>
                        <div>
                          <div className={styles.pname}>{personName(g)}</div>
                          <div className={styles.muted}>{person?.email ?? ''}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        size="sm"
                        aria-label={t('role_of', { name: personName(g) })}
                        value={g.roleKey}
                        disabled={busy || orgWide}
                        onChange={(e) => void save(withGrantRole(cfg, g.id, e.target.value))}
                      >
                        {cfg.roles.map((r) => (
                          <NativeSelectOption key={r.key} value={r.key}>
                            {r.name}
                          </NativeSelectOption>
                        ))}
                        {!cfg.roles.some((r) => r.key === g.roleKey) && (
                          <NativeSelectOption value={g.roleKey}>{g.roleKey}</NativeSelectOption>
                        )}
                      </NativeSelect>
                    </TableCell>
                    <TableCell className={styles.muted}>{orgWide ? t('scope_org') : t('scope_project')}</TableCell>
                    <TableCell className={styles.actions}>
                      {orgWide ? (
                        <span className={styles.muted} title={t('in_access_title')}>
                          {t('in_access')}
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(g)}>
                          {t('remove')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      )}

      {adding && cfg && (
        <AddDialog
          t={t}
          cfg={cfg}
          org={org}
          project={project}
          candidates={candidates}
          busy={busy}
          container={container}
          onClose={() => setAdding(false)}
          onAdd={async (member, roleKey) => {
            const grant = projectGrant(member, roleKey, project, Date.now(), cfg.grants.length);
            if (await save(withGrant(cfg, grant))) setAdding(false);
          }}
        />
      )}

      {removing && cfg && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !busy) setRemoving(null);
          }}
        >
          <DialogContent container={container} closeLabel={t('close')} data-team-remove>
            <DialogHeader>
              <DialogTitle>{t('remove_title', { name: personName(removing), project: project.name })}</DialogTitle>
              <DialogDescription>{t('remove_body')}</DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void save(withoutGrant(cfg, removing.id)).then((ok) => {
                    if (ok) setRemoving(null);
                  })
                }
                data-team-remove-go
              >
                {t('remove_confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function AddDialog({
  t,
  cfg,
  org,
  project,
  candidates,
  busy,
  container,
  onClose,
  onAdd,
}: {
  t: ScreenText;
  cfg: AccessConfig;
  org: OrganizationRef;
  project: { id: string; name: string };
  candidates: Member[];
  busy: boolean;
  container: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onAdd: (member: Member, roleKey: string) => void;
}) {
  const [pick, setPick] = useState('');
  const [role, setRole] = useState('');
  const fallback = defaultTeamRole(cfg);
  const member = candidates.find((p) => p.id === pick);
  const roleKey = role || fallback?.key;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent container={container} closeLabel={t('close')} data-team-add-dialog>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (member && roleKey) onAdd(member, roleKey);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('add_title', { project: project.name })}</DialogTitle>
          </DialogHeader>
          <NativeSelect aria-label={t('person')} value={pick} onChange={(e) => setPick(e.target.value)}>
            <NativeSelectOption value="">{t('pick_person', { org: org.name })}</NativeSelectOption>
            {candidates.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t('role')} value={role} onChange={(e) => setRole(e.target.value)}>
            <NativeSelectOption value="">{t('role_default', { role: fallback?.name ?? t('role_none') })}</NativeSelectOption>
            {cfg.roles.map((r) => (
              <NativeSelectOption key={r.key} value={r.key}>
                {r.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy || !member || !roleKey} data-team-add>
              {t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
