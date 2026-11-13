/**
 * Admin › Project tenants — the prototype's `WorkspacesView` (`App.tsx`)
 * carried over (ADR-0069): the raw list of workspace tenants behind the
 * projects, across every organization, so the hierarchy stays administrable —
 * open one, create one in an organization, delete one.
 *
 * A platform administrator's: it reads the platform root's organizations, and
 * the backend refuses that to anybody else; the section shows the refusal.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiRegistry, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  STUDIO_ACTION_WORKSPACES_PUBLISH,
  TENANT_TYPES,
  sendToHost,
  type Tenant,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import { PLATFORM_ROOT_TENANT_ID } from '../../model/members';
import { ErrorLine, Header, errText, useAdmin, useConfirm } from './common';
import styles from './Admin.module.css';

interface Row extends Tenant {
  orgId: string;
  orgName: string;
}

export function TenantsSection() {
  const { t, bridge } = useAdmin();
  const accounts = apiRegistry.getService(AccountsApiService);
  const api = apiRegistry.getService(AdminApiService);
  const [ask, confirmDialog] = useConfirm();
  const [orgs, setOrgs] = useState<Tenant[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [query, setQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [selfManagedOnly, setSelfManagedOnly] = useState(false);
  const [descending, setDescending] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = (
          (await accounts.getOrganizations({ tenantId: PLATFORM_ROOT_TENANT_ID }).fetch({ staleTime: 0 }))?.items ?? []
        ).filter((o) => o.tenant_type === TENANT_TYPES.organization);
        // A self-managed organization raises the barrier by design — don't even ask.
        const nested = await Promise.all(
          list.map(async (org): Promise<Row[]> => {
            if (org.self_managed) return [];
            try {
              const page = await accounts.getWorkspaces({ organizationId: org.id }).fetch({ staleTime: 0 });
              return (page?.items ?? []).map((w) => ({ ...w, orgId: org.id, orgName: org.name }));
            } catch {
              return []; // barrier or no access — the organization stays, its contents don't
            }
          })
        );
        if (!live) return;
        setOrgs(list);
        setRows(nested.flat());
        setReadError(null);
        if (list.length === 1) setOrgId((cur) => cur || list[0].id);
      } catch (e) {
        if (!live) return;
        setRows([]);
        setReadError(errText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [accounts, tick]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTenant.fetch({ name: name.trim(), parent_id: orgId, tenant_type: TENANT_TYPES.workspace });
      setName('');
      refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  /** The shell owns the levels: name the workspace and it moves there. */
  const open = (w: Row) =>
    sendToHost(bridge, {
      type: STUDIO_ACTION_WORKSPACES_PUBLISH,
      target: FRONTX_SCREEN_DOMAIN,
      payload: { kind: 'selected', workspace: { id: w.id, name: w.name }, organizationId: w.orgId },
    });

  const q = query.trim().toLowerCase();
  const visible = (rows ?? [])
    .filter((w) => !q || w.name.toLowerCase().includes(q) || w.orgName.toLowerCase().includes(q))
    .filter((w) => !orgFilter || w.orgId === orgFilter)
    .filter((w) => !selfManagedOnly || w.self_managed)
    .sort((a, b) => (descending ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));

  return (
    <>
      <Header title={t('tenants_title')} info={<p>{t('tenants_about')}</p>} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <Card data-tenants>
        <CardContent className={styles.cardBody}>
          {rows === null ? (
            <p className={styles.muted}>{t('reading')}</p>
          ) : readError ? (
            <div className={styles.inline} data-tenants-refused>
              <ErrorLine>{readError}</ErrorLine>
              <Button size="sm" variant="outline" onClick={refresh}>
                {t('retry')}
              </Button>
            </div>
          ) : (
            <>
              <div className={styles.toolbar}>
                <Input
                  className={styles.search}
                  value={query}
                  placeholder={t('tenants_search')}
                  aria-label={t('tenants_search')}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <NativeSelect
                  size="sm"
                  aria-label={t('tenants_filter_org')}
                  value={orgFilter}
                  onChange={(e) => setOrgFilter(e.target.value)}
                >
                  <NativeSelectOption value="">{t('tenants_every_org')}</NativeSelectOption>
                  {orgs.map((o) => (
                    <NativeSelectOption key={o.id} value={o.id}>
                      {o.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <label className={styles.check}>
                  <Checkbox checked={selfManagedOnly} onCheckedChange={(v) => setSelfManagedOnly(v === true)} />
                  {t('tenants_self_managed_only')}
                </label>
                <NativeSelect
                  size="sm"
                  aria-label={t('tenants_sort')}
                  value={descending ? 'desc' : 'asc'}
                  onChange={(e) => setDescending(e.target.value === 'desc')}
                >
                  <NativeSelectOption value="asc">{t('tenants_sort_asc')}</NativeSelectOption>
                  <NativeSelectOption value="desc">{t('tenants_sort_desc')}</NativeSelectOption>
                </NativeSelect>
              </div>
              {rows.length === 0 ? (
                <p className={styles.muted}>{t('tenants_empty')}</p>
              ) : visible.length === 0 ? (
                <p className={styles.muted}>{t('tenants_no_match')}</p>
              ) : (
                <ul className={styles.rows}>
                  {visible.map((w) => (
                    <li key={w.id} data-tenant={w.id}>
                      <div className={styles.grow}>
                        <div className={styles.name}>{w.name}</div>
                        <div className={styles.sub}>{w.orgName}</div>
                      </div>
                      <Badge variant="secondary">{t('tenants_tenant')}</Badge>
                      {w.self_managed && <Badge variant="warning">{t('org_self_managed')}</Badge>}
                      <Button size="sm" variant="outline" onClick={() => open(w)} data-tenant-open>
                        {t('open')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('tenants_delete')}
                        onClick={() =>
                          ask(
                            {
                              title: t('tenants_delete_confirm', { name: w.name }),
                              body: t('tenants_delete_body'),
                              confirmLabel: t('delete'),
                            },
                            async () => {
                              await api.deleteTenant(w.id).fetch(undefined);
                              refresh();
                            }
                          )
                        }
                        data-tenant-delete
                      >
                        {t('delete')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <form className={styles.inline} onSubmit={(e) => void create(e)}>
                <Input
                  className={styles.search}
                  placeholder={t('tenants_new_name')}
                  aria-label={t('tenants_new_name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <NativeSelect aria-label={t('tenants_org')} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  <NativeSelectOption value="">{t('tenants_org_pick')}</NativeSelectOption>
                  {orgs.map((o) => (
                    <NativeSelectOption key={o.id} value={o.id}>
                      {o.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button type="submit" disabled={busy || !name.trim() || !orgId} data-tenant-create>
                  {t('create')}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </>
  );
}
