/**
 * Admin › All identities — the prototype's `IdentityDirectory`
 * (`identity-directory.tsx`) carried over (ADR-0069): everyone whose identity
 * exists in Studio Keycloak, including people waiting for organization
 * access; where Studio records them as belonging and what Keycloak still says;
 * and, per row, putting them in an organization with a role.
 *
 * A platform administrator's alone. The menu offers it to everyone and the
 * backend refuses the others; the section shows that refusal rather than
 * guessing who may.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
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
import { AccountsApiService, TENANT_TYPES, type Tenant } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type { MembershipRole, PlatformIdentity } from '../../api/types';
import {
  PLATFORM_ROOT_TENANT_ID,
  currentOrg,
  idpDrift,
  initials,
  orgMemberships,
  roleIn,
} from '../../model/members';
import { ErrorLine, Header, errText, useAdmin, when } from './common';
import styles from './Admin.module.css';

type Access = '' | PlatformIdentity['status'];

export function IdentitiesSection() {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [identities, setIdentities] = useState<PlatformIdentity[] | null>(null);
  const [organizations, setOrganizations] = useState<Tenant[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, MembershipRole>>({});
  const [query, setQuery] = useState('');
  const [access, setAccess] = useState<Access>('');
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.platformIdentities.fetch({ staleTime: 0 }),
      accounts.getOrganizations({ tenantId: PLATFORM_ROOT_TENANT_ID }).fetch({ staleTime: 0 }),
    ]).then(
      ([{ items }, page]) => {
        if (!live) return;
        setIdentities(items);
        setOrganizations((page?.items ?? []).filter((o) => o.tenant_type === TENANT_TYPES.organization));
        setReadError(null);
      },
      (e: unknown) => {
        if (!live) return;
        setIdentities([]);
        setReadError(errText(e));
      }
    );
    return () => {
      live = false;
    };
  }, [api, accounts, tick]);

  const roleLabel = (role: string) => (['owner', 'admin', 'member'].includes(role) ? t(`role_${role}`) : role);
  const targetOf = (i: PlatformIdentity) => targets[i.id] ?? currentOrg(i);
  const roleOf = (i: PlatformIdentity): MembershipRole =>
    roles[i.id] ?? ((roleIn(i, targetOf(i)) as MembershipRole | undefined) || 'member');

  async function assign(identity: PlatformIdentity) {
    const tenantId = targetOf(identity);
    if (!tenantId) return;
    setBusyId(identity.id);
    setError(null);
    try {
      await api.assignIdentity(identity.id).fetch({ tenant_id: tenantId, role: roleOf(identity) });
      // The row now starts from what the server has, not from the picks.
      setTargets(({ [identity.id]: _target, ...rest }) => rest);
      setRoles(({ [identity.id]: _role, ...rest }) => rest);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
    }
  }

  const list = identities ?? [];
  const waiting = list.filter((i) => i.status === 'unassigned').length;
  const q = query.trim().toLowerCase();
  const shown = list
    .filter((i) => !access || i.status === access)
    .filter(
      (i) =>
        !q ||
        [i.display_name, i.username, i.email, i.home_tenant_name, i.status, ...(i.memberships ?? []).map((m) => m.org_name)]
          .filter((s): s is string => !!s)
          .some((s) => s.toLowerCase().includes(q))
    )
    .sort((x, y) => (x.display_name || x.username).localeCompare(y.display_name || y.username));

  return (
    <>
      <Header
        title={t('ids_title')}
        info={
          <>
            <p>{t('ids_about')}</p>
            <p>{t('ids_about_audit')}</p>
          </>
        }
        status={
          list.length > 0 && (
            <>
              <Badge variant="secondary">{t.count('ids_count', list.length)}</Badge>
              {waiting > 0 && <Badge variant="warning">{t.count('ids_waiting_count', waiting)}</Badge>}
            </>
          )
        }
      />
      {error && <ErrorLine>{error}</ErrorLine>}
      <Card data-identities>
        <CardContent className={styles.cardBody}>
          <div className={styles.toolbar}>
            <Input
              className={styles.search}
              value={query}
              placeholder={t('ids_search')}
              aria-label={t('ids_search')}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(['', 'unassigned', 'assigned', 'platform_admin'] as const).map((s) => (
              <Button
                key={s || 'all'}
                size="sm"
                variant={access === s ? 'secondary' : 'ghost'}
                aria-pressed={access === s}
                onClick={() => setAccess(s)}
              >
                {s ? t(`directory_${s}`) : t('everyone')}
              </Button>
            ))}
          </div>
          {identities === null ? (
            <p className={styles.muted}>{t('reading')}</p>
          ) : readError ? (
            <div className={styles.inline} data-identities-refused>
              <ErrorLine>{readError}</ErrorLine>
              <Button size="sm" variant="outline" onClick={load}>
                {t('retry')}
              </Button>
            </div>
          ) : list.length === 0 ? (
            <p className={styles.muted}>{t('ids_empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('ids_col_identity')}</TableHead>
                  <TableHead>{t('ids_col_provider')}</TableHead>
                  <TableHead>{t('ids_col_access')}</TableHead>
                  <TableHead>{t('ids_col_assignment')}</TableHead>
                  <TableHead>{t('ids_col_first_seen')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((identity) => {
                  const name = identity.display_name || identity.username;
                  const held = orgMemberships(identity);
                  const drift = idpDrift(identity);
                  const target = targetOf(identity);
                  const role = roleOf(identity);
                  const standing = target ? roleIn(identity, target) : undefined;
                  const unchanged = standing !== undefined && standing === role;
                  return (
                    <TableRow key={identity.id} data-identity={identity.id}>
                      <TableCell>
                        <div className={styles.person}>
                          <span className={styles.avatar}>{initials(name)}</span>
                          <div>
                            <div className={styles.name}>{name}</div>
                            <div className={styles.sub}>{identity.email || identity.username}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={styles.sub}>{identity.identity_provider || 'local'}</TableCell>
                      <TableCell>
                        {identity.status === 'platform_admin' && <Badge variant="info">{t('directory_platform_admin')}</Badge>}
                        {held === null ? (
                          // Studio could not be asked: the IdP's word, labelled as such.
                          identity.status === 'assigned' ? (
                            <>
                              <Badge variant="secondary">{identity.home_tenant_name || t('directory_assigned')}</Badge>
                              <div className={styles.sub}>
                                {identity.organization_role ? `${roleLabel(identity.organization_role)} · ` : ''}
                                {t('ids_per_keycloak')}
                              </div>
                            </>
                          ) : identity.status === 'unassigned' ? (
                            <Badge variant="warning">{t('directory_unassigned')}</Badge>
                          ) : null
                        ) : held.length === 0 ? (
                          identity.status !== 'platform_admin' && <Badge variant="warning">{t('directory_unassigned')}</Badge>
                        ) : (
                          held.map((m) => (
                            <div key={m.org_id}>
                              <Badge variant={m.status === 'active' ? 'secondary' : 'warning'} title={m.org_id}>
                                {m.org_name || m.org_id.slice(0, 8)}
                              </Badge>
                              <div className={styles.sub}>
                                {roleLabel(m.role)}
                                {m.status !== 'active' ? ` · ${t('standing_suspended').toLowerCase()}` : ''}
                              </div>
                            </div>
                          ))
                        )}
                        {drift && (
                          <div className={styles.sub} title={t('ids_drift_hint')}>
                            {drift.kind === 'home'
                              ? t('ids_drift_home', { name: drift.name || t('ids_another_org') })
                              : t('ids_drift_role', { role: roleLabel(drift.name) })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {identity.status === 'platform_admin' ? (
                          <span className={styles.sub}>{t('ids_admin_everywhere')}</span>
                        ) : (
                          <div className={styles.inline}>
                            <NativeSelect
                              size="sm"
                              aria-label={t('ids_org_for', { name })}
                              value={target}
                              onChange={(e) => setTargets((cur) => ({ ...cur, [identity.id]: e.target.value }))}
                            >
                              <NativeSelectOption value="" disabled>
                                {organizations.length === 0 ? t('ids_no_orgs') : t('ids_choose_org')}
                              </NativeSelectOption>
                              {organizations.map((o) => (
                                <NativeSelectOption key={o.id} value={o.id}>
                                  {o.name}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <NativeSelect
                              size="sm"
                              aria-label={t('ids_role_for', { name })}
                              value={role}
                              onChange={(e) =>
                                setRoles((cur) => ({ ...cur, [identity.id]: e.target.value as MembershipRole }))
                              }
                            >
                              <NativeSelectOption value="member">{t('role_member')}</NativeSelectOption>
                              <NativeSelectOption value="admin">{t('role_admin')}</NativeSelectOption>
                              <NativeSelectOption value="owner">{t('role_owner')}</NativeSelectOption>
                            </NativeSelect>
                            <Button
                              size="sm"
                              disabled={busyId !== null || !target || unchanged}
                              title={unchanged ? t('ids_already', { role: roleLabel(role) }) : undefined}
                              onClick={() => void assign(identity)}
                              data-identity-assign
                            >
                              {busyId === identity.id ? t('saving') : standing !== undefined ? t('ids_update') : t('ids_assign')}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={styles.sub}>{when(identity.first_seen_at_epoch_ms, language)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
