/**
 * Admin › Organizations — the prototype's `OrganizationsTable`
 * (`org-admin.tsx`) and `OrganizationsView` (`App.tsx`) carried over
 * (ADR-0069): every organization the caller sees, with what tells two of the
 * same name apart (id, workspaces, owners, members); the organization the path
 * bar has picked — rename, logo, managed or self-managed (a dual-consent
 * conversion), delete; the access map of the caller's scope; the conversions
 * waiting on the caller's consent; and a new organization.
 *
 * The organization is picked in the path bar, as the prototype's admin header
 * picked it, so the table's rows do not switch it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  TENANT_TYPES,
  isNotFound,
  useOrganization,
  type Tenant,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type { Conversion, OrgMember } from '../../api/types';
import { PLATFORM_ROOT_TENANT_ID, duplicateNames, memberName } from '../../model/members';
import { ErrorLine, Header, errText, shortId, useAdmin, useConfirm } from './common';
import styles from './Admin.module.css';

/** A logo is a small mark: what the backend keeps at most. */
const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface Scope {
  home: Tenant | null;
  homeId: string;
  orgs: Tenant[];
  /** Each organization's workspaces; a self-managed one's are not asked for. */
  workspaces: Record<string, Tenant[]>;
}

const isOrganization = (t: Tenant) => t.tenant_type === TENANT_TYPES.organization;

/** What the caller administers: the platform root's organizations for a
 *  platform administrator, the ones they belong to otherwise (as the shell's
 *  switcher lists them). */
async function readScope(): Promise<Scope> {
  const accounts = apiRegistry.getService(AccountsApiService);
  const admin = apiRegistry.getService(AdminApiService);
  const me = await accounts.getMe.fetch({ staleTime: 0 });
  const homeId = me?.subject_tenant_id ?? '';
  const home = homeId
    ? await accounts
        .getTenant({ tenantId: homeId })
        .fetch({ staleTime: 0 })
        .catch((e: unknown) => (isNotFound(e) ? null : Promise.reject(e)))
    : null;
  let orgs: Tenant[];
  if (homeId === PLATFORM_ROOT_TENANT_ID) {
    orgs = ((await accounts.getOrganizations({ tenantId: homeId }).fetch({ staleTime: 0 }))?.items ?? []).filter(
      isOrganization
    );
  } else {
    const held = (await admin.myMemberships.fetch({ staleTime: 0 }).catch(() => ({ items: [] }))).items ?? [];
    const resolved = await Promise.all(
      held.map((m) =>
        accounts
          .getTenant({ tenantId: m.org_id })
          .fetch({ staleTime: 0 })
          .catch(() => null)
      )
    );
    orgs = resolved.filter((t): t is Tenant => !!t && isOrganization(t));
    if (home && isOrganization(home) && !orgs.some((o) => o.id === home.id)) orgs.unshift(home);
  }
  const pairs = await Promise.all(
    orgs.map(async (org): Promise<[string, Tenant[]]> => {
      // A self-managed organization raises the barrier by design: don't even ask.
      if (org.self_managed) return [org.id, []];
      try {
        return [org.id, (await accounts.getWorkspaces({ organizationId: org.id }).fetch({ staleTime: 0 }))?.items ?? []];
      } catch {
        return [org.id, []];
      }
    })
  );
  return { home, homeId, orgs, workspaces: Object.fromEntries(pairs) };
}

export function OrganizationsSection() {
  const { t } = useAdmin();
  const { org: picked } = useOrganization();
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    readScope().then(
      (s) => live && setScope(s),
      (e: unknown) => {
        if (!live) return;
        setError(errText(e));
        setScope({ home: null, homeId: '', orgs: [], workspaces: {} });
      }
    );
    return () => {
      live = false;
    };
  }, [tick]);

  const platform = scope?.homeId === PLATFORM_ROOT_TENANT_ID;
  const selected =
    scope?.orgs.find((o) => o.id === picked?.id) ??
    (scope?.home && isOrganization(scope.home) ? scope.home : scope?.orgs[0]) ??
    null;

  return (
    <>
      <Header
        title={t('org_title')}
        info={<p>{t('org_about')}</p>}
        action={
          <Button onClick={() => setCreating((c) => !c)} data-org-new>
            {t('org_new')}
          </Button>
        }
      />
      {error && <ErrorLine>{error}</ErrorLine>}
      {creating && scope && (
        <CreateOrganization
          parentId={scope.homeId}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
      {!scope ? (
        <p className={styles.muted}>{t('reading')}</p>
      ) : (
        <>
          {(platform || scope.orgs.length > 1) && (
            <OrganizationsTable orgs={scope.orgs} workspaces={scope.workspaces} selectedId={selected?.id ?? null} />
          )}
          {selected && (
            <OrganizationCard
              key={selected.id}
              org={selected}
              workspaces={scope.workspaces[selected.id] ?? []}
              isHome={selected.id === scope.home?.id}
              onChanged={refresh}
            />
          )}
          {scope.home && <AccessMap scope={scope} />}
          {scope.homeId && <InboundConversions parentId={scope.homeId} tick={tick} onChanged={refresh} />}
        </>
      )}
    </>
  );
}

function OrganizationsTable({
  orgs,
  workspaces,
  selectedId,
}: {
  orgs: Tenant[];
  workspaces: Record<string, Tenant[]>;
  selectedId: string | null;
}) {
  const { t } = useAdmin();
  const [members, setMembers] = useState<Record<string, OrgMember[] | 'denied'>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    const api = apiRegistry.getService(AdminApiService);
    void Promise.all(
      orgs.map(async (org) => {
        try {
          return [org.id, await api.orgMembers(org.id)] as const;
        } catch {
          // Not an owner of this one: its room is not ours to see.
          return [org.id, 'denied' as const] as const;
        }
      })
    ).then((pairs) => live && setMembers(Object.fromEntries(pairs)));
    return () => {
      live = false;
    };
  }, [orgs]);

  // Same-named organizations are the reason this table exists; flag them.
  const duplicates = useMemo(() => duplicateNames(orgs), [orgs]);
  const q = query.trim().toLowerCase();
  const shown = orgs
    .filter(
      (o) =>
        !q ||
        [o.name, o.id, ...(workspaces[o.id] ?? []).map((w) => w.name)].some((s) => s.toLowerCase().includes(q))
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Card data-org-table>
      <CardContent className={styles.cardBody}>
        <div className={styles.toolbar}>
          <h3 className={styles.subtitle}>{t('org_all')}</h3>
          <Input
            className={styles.search}
            value={query}
            placeholder={t('org_search')}
            aria-label={t('org_search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {orgs.length === 0 ? (
          <p className={styles.muted}>{t('org_none')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('org_col_name')}</TableHead>
                <TableHead>{t('org_col_workspaces')}</TableHead>
                <TableHead>{t('org_col_owners')}</TableHead>
                <TableHead className={styles.num}>{t('org_col_members')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((org) => {
                const room = members[org.id];
                const list = room && room !== 'denied' ? room : null;
                const owners = list?.filter((m) => m.role === 'owner' && m.status === 'active') ?? [];
                const ws = workspaces[org.id] ?? [];
                return (
                  <TableRow key={org.id} data-org-row={org.id}>
                    <TableCell>
                      <div className={selectedId === org.id ? styles.selected : undefined}>
                        <div className={styles.name}>
                          {org.name}{' '}
                          {duplicates.has(org.name.trim().toLowerCase()) && (
                            <Badge variant="warning" title={t('org_same_name_hint')}>
                              {t('org_same_name')}
                            </Badge>
                          )}
                        </div>
                        <div className={`${styles.sub} ${styles.mono}`} title={org.id}>
                          {shortId(org.id)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={styles.sub}>{ws.length ? ws.map((w) => w.name).join(', ') : '—'}</TableCell>
                    <TableCell className={styles.sub}>
                      {room === undefined ? (
                        '…'
                      ) : room === 'denied' ? (
                        t('org_not_yours')
                      ) : owners.length ? (
                        owners.map(memberName).join(', ')
                      ) : (
                        <Badge variant="warning">{t('no_owner')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className={styles.num}>{list ? list.length : room === 'denied' ? '—' : '…'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateOrganization({ parentId, onDone }: { parentId: string; onDone: () => void }) {
  const { t } = useAdmin();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRegistry
        .getService(AdminApiService)
        .createTenant.fetch({ name: name.trim(), parent_id: parentId, tenant_type: TENANT_TYPES.organization });
      setName('');
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-org-create>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('org_create_title')}</h3>
        <p className={styles.muted}>{t('org_create_about')}</p>
        <form className={styles.inline} onSubmit={(e) => void create(e)}>
          <Input
            className={styles.search}
            autoFocus
            aria-label={t('org_create_name')}
            placeholder={t('org_create_placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {t('org_create')}
          </Button>
        </form>
        <p className={styles.muted}>{t('org_create_hint')}</p>
        {error && <ErrorLine>{error}</ErrorLine>}
      </CardContent>
    </Card>
  );
}

function OrganizationCard({
  org,
  workspaces,
  isHome,
  onChanged,
}: {
  org: Tenant;
  workspaces: Tenant[];
  isHome: boolean;
  onChanged: () => void;
}) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [ask, confirmDialog] = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const saveRename = async () => {
    const next = renameTo.trim();
    if (!next || next === org.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.renameTenant(org.id).fetch({ name: next });
      setRenaming(false);
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const request = async () => {
    setError(null);
    try {
      await api
        .requestConversion(org.id)
        .fetch({ target_mode: org.self_managed ? 'managed' : 'self_managed', comment: 'Requested from the Studio portal' });
      setRequested(true);
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  const requestMode = () => {
    // The barrier is easy to raise and deliberately hard to lower — make sure
    // nobody locks themselves out by accident.
    if (org.self_managed) {
      void request();
      return;
    }
    ask(
      { title: t('org_self_managed_confirm_title', { name: org.name }), body: t('org_self_managed_confirm'), confirmLabel: t('org_to_self_managed') },
      request
    );
  };

  return (
    <>
      <Card data-org-card={org.id}>
        <CardContent className={styles.cardBody}>
          <div className={styles.inline}>
            {renaming ? (
              <>
                <Input
                  className={styles.search}
                  autoFocus
                  aria-label={t('org_rename')}
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                />
                <Button size="sm" disabled={busy || !renameTo.trim()} onClick={() => void saveRename()}>
                  {t('save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                  {t('cancel')}
                </Button>
              </>
            ) : (
              <>
                <h3 className={styles.subtitle}>{org.name}</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenameTo(org.name);
                    setRenaming(true);
                  }}
                  data-org-rename
                >
                  {t('org_rename')}
                </Button>
              </>
            )}
          </div>
          <ul className={styles.rows}>
            <li>
              <div className={styles.grow}>
                <div className={styles.sub}>{t('org_id')}</div>
                <code className={styles.mono}>{org.id}</code>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(org.id)}>
                {t('copy')}
              </Button>
            </li>
            <li>
              <LogoControl orgId={org.id} />
            </li>
            <li>
              <div className={styles.grow}>
                <div className={styles.sub}>{t('org_mode')}</div>
                <div className={styles.inline}>
                  <Badge variant="secondary">{t('org_type_organization')}</Badge>
                  <Badge variant={org.self_managed ? 'warning' : 'info'}>
                    {org.self_managed ? t('org_self_managed') : t('org_managed')}
                  </Badge>
                  {requested && <Badge variant="info">{t('org_conversion_requested')}</Badge>}
                </div>
              </div>
              {org.self_managed && !isHome ? (
                <span className={styles.sub} title={t('org_requested_inside_hint')}>
                  {t('org_requested_inside')}
                </span>
              ) : (
                <Button size="sm" variant="outline" title={t('org_mode_hint')} onClick={requestMode} data-org-mode>
                  {org.self_managed ? t('org_to_managed') : t('org_to_self_managed')}
                </Button>
              )}
            </li>
            <li>
              <div className={styles.grow}>
                <div className={styles.sub}>{t('org_workspaces')}</div>
                <div>{t.count('org_workspace_count', workspaces.length)}</div>
              </div>
            </li>
          </ul>
          {error && <ErrorLine>{error}</ErrorLine>}
        </CardContent>
      </Card>

      {!isHome && (
        <Card className={styles.danger} data-org-danger>
          <CardContent className={styles.cardBody}>
            <h3 className={styles.subtitle}>{t('danger_zone')}</h3>
            <ul className={styles.rows}>
              <li>
                <div className={styles.grow}>
                  <div className={styles.name}>{t('org_delete')}</div>
                  <div className={styles.sub}>{t('org_delete_about')}</div>
                </div>
                <Button
                  variant="destructive"
                  onClick={() =>
                    ask(
                      { title: t('org_delete_confirm', { name: org.name }), body: t('org_delete_confirm_body'), confirmLabel: t('org_delete') },
                      async () => {
                        await api.deleteTenant(org.id).fetch(undefined);
                        onChanged();
                      }
                    )
                  }
                  data-org-delete
                >
                  {t('org_delete')}
                </Button>
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
      {confirmDialog}
    </>
  );
}

/** Set or remove the organization's logo. The backend says who may; anybody else is told so. */
function LogoControl({ orgId }: { orgId: string }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const input = useRef<HTMLInputElement | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .logo({ orgId })
      .fetch({ staleTime: 0 })
      .then(
        (l) => live && setLogo(`data:${l.content_type};base64,${l.data}`),
        // None (404), or not readable here: the initial is shown either way.
        () => live && setLogo(null)
      );
    return () => {
      live = false;
    };
  }, [api, orgId]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setError(t('logo_bad_type'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t('logo_too_big', { size: Math.ceil(file.size / 1024), max: MAX_LOGO_BYTES / 1024 }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const kept = await api.setLogo(orgId).fetch({ content_type: file.type, data: btoa(binary) });
      setLogo(`data:${kept.content_type};base64,${kept.data}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteLogo(orgId).fetch(undefined);
      setLogo(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {logo ? <img className={styles.logo} src={logo} alt="" /> : <span className={styles.logo} />}
      <div className={styles.grow}>
        <div className={styles.sub}>{t('logo')}</div>
        <div className={styles.sub}>{t('logo_about')}</div>
        {error && <ErrorLine>{error}</ErrorLine>}
      </div>
      <input
        ref={input}
        type="file"
        accept={LOGO_TYPES.join(',')}
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()} data-org-logo>
        {busy ? t('saving') : logo ? t('logo_change') : t('logo_add')}
      </Button>
      {logo && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
          {t('logo_remove')}
        </Button>
      )}
    </>
  );
}

/** The tenant hierarchy IS the privilege system: the caller's home anchors
 *  their scope (its subtree), and self-managed raises a visibility barrier. */
function AccessMap({ scope }: { scope: Scope }) {
  const { t } = useAdmin();
  const home = scope.home;
  if (!home) return null;
  const homeIsOrg = isOrganization(home);
  return (
    <Card data-org-access-map>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('org_access_map')}</h3>
        <p className={styles.muted}>{t('org_access_map_about')}</p>
        <ul className={styles.tree}>
          <li>
            <strong>{home.name}</strong> <Badge variant="info">{t('org_you_are_here')}</Badge>
            <ul>
              {homeIsOrg
                ? (scope.workspaces[home.id] ?? []).map((w) => <li key={w.id}>{w.name}</li>)
                : scope.orgs.map((o) => (
                    <li key={o.id} className={o.self_managed ? styles.dim : undefined}>
                      {o.name}{' '}
                      {o.self_managed && (
                        <Badge variant="warning" title={t('org_barrier_hint')}>
                          {t('org_subtree_hidden')}
                        </Badge>
                      )}
                      {!o.self_managed && (
                        <ul>
                          {(scope.workspaces[o.id] ?? []).map((w) => (
                            <li key={w.id}>{w.name}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
            </ul>
          </li>
        </ul>
        <p className={styles.muted}>{t('org_access_map_enforcement')}</p>
      </CardContent>
    </Card>
  );
}

/** Mode conversions that need the caller's consent. Discovery is best-effort. */
function InboundConversions({ parentId, tick, onChanged }: { parentId: string; tick: number; onChanged: () => void }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [inbound, setInbound] = useState<Conversion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .inboundConversions({ parentId })
      .fetch({ staleTime: 0 })
      .then(
        (page) => live && setInbound((page.items ?? []).filter((c) => c.status === 'pending')),
        () => undefined
      );
    return () => {
      live = false;
    };
  }, [api, parentId, tick, mine]);

  const decide = async (c: Conversion, status: 'approved' | 'rejected') => {
    setError(null);
    try {
      await api.decideConversion(parentId, c.request_id ?? c.id ?? '').fetch({ status });
      setMine((n) => n + 1);
      onChanged(); // the self_managed flag may have flipped
    } catch (e) {
      setError(errText(e));
    }
  };

  if (inbound.length === 0 && !error) return null;
  return (
    <Card data-org-conversions>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('org_conversions')}</h3>
        {error && <ErrorLine>{error}</ErrorLine>}
        <ul className={styles.rows}>
          {inbound.map((c) => (
            <li key={c.request_id ?? c.id}>
              <div className={styles.grow}>
                <div className={styles.name}>
                  {c.child_tenant_name ?? c.tenant_id} → {c.target_mode}
                </div>
                <div className={styles.sub}>{t('org_conversion_expires', { at: c.expires_at ?? '—' })}</div>
              </div>
              <Button size="sm" onClick={() => void decide(c, 'approved')}>
                {t('approve')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void decide(c, 'rejected')}>
                {t('reject')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
