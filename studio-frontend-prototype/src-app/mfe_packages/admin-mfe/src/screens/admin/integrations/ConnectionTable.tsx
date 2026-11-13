/**
 * The connections as a table — the prototype's `ConnectionList` (`App.tsx` at
 * 00828880): kind chips and a provider filter, a search, one row per
 * connection with its health, what uses it and its scope; Test again, Edit,
 * Browse repositories and Remove; the editor and the repository browser open
 * under their row; "Not connected yet" names the kinds nothing is connected
 * for. Health is asked once when the list shows and kept five minutes, across
 * visits; a forced test always asks.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  NativeSelect,
  NativeSelectOption,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { useListState, type OrganizationRef, type ScreenText } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import type { ConnectorProvider, StoredConnection } from '../../../api/types';
import {
  CATEGORY_KEYS,
  GEAR_REPOSITORY,
  HEALTH_TTL_MS,
  MISSING_EXPLAINED,
  missingCategories,
  nonDefaultAddress,
} from '../../../model/connections';
import { errText, useAdmin, useConfirm } from '../common';
import { ConnectorLogo, LogoSlot } from './ConnectorLogo';
import { EditConnection } from './EditConnection';
import { RepoBrowser } from './RepoBrowser';
import styles from '../Admin.module.css';
import own from './Integrations.module.css';

type Health = { state: 'ok' | 'bad' | 'testing'; text: string; at: number };

/** Each connection's last answer, kept across visits to the page. */
const healthCache = new Map<string, Health>();

/** "8 min ago", "yesterday": when a health answer came. */
export function ago(at: number, now: number, t: ScreenText): string {
  const secs = Math.round((now - at) / 1000);
  if (secs < 60) return t('int_just_now');
  const mins = Math.round(secs / 60);
  if (mins < 60) return t.count('int_minutes_ago', mins);
  const hours = Math.round(mins / 60);
  if (hours < 24) return t.count('int_hours_ago', hours);
  const days = Math.round(hours / 24);
  if (days === 1) return t('int_yesterday');
  if (days < 30) return t.count('int_days_ago', days);
  return t.count('int_months_ago', Math.round(days / 30));
}

type SortKey = 'connection' | 'kind';

/** Where the connection list keeps its search, filters and sort in the address. */
export const CONNECTIONS_LIST_PREFIX = 'conn.';

export function ConnectionTable({
  org,
  providers,
  connections,
  loading,
  sourcesTick,
  envUses,
  adding,
  onAdd,
  onSourcesChanged,
  onChanged,
  onNote,
}: {
  org: OrganizationRef;
  providers: ConnectorProvider[];
  connections: StoredConnection[];
  loading: boolean;
  sourcesTick: number;
  /** Environments by the cluster or registry connection they deploy with. */
  envUses: Map<string, string[]>;
  /** Whether the picker is open above. */
  adding: boolean;
  /** Open the provider picker, on one kind or on all. */
  onAdd: (category?: string) => void;
  onSourcesChanged: () => void;
  onChanged: () => void;
  onNote: (text: string) => void;
}) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [ask, confirmDialog] = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Search, kind, connector and sort in the address under `conn.`, as the prototype's
  // `DataTable list="connections" urlPrefix="conn."` kept them: shared, and back on Back.
  const [list, listCtl] = useListState(CONNECTIONS_LIST_PREFIX);
  const query = list.q;
  const kind = list.filters.kind ?? null;
  const provider = list.filters.provider ?? '';
  const sort: { key: SortKey; desc: boolean } | null =
    list.sort && (list.sort.key === 'connection' || list.sort.key === 'kind')
      ? { key: list.sort.key, desc: list.sort.dir === 'desc' }
      : null;
  const setQuery = listCtl.setQ;
  const setKind = (value: string | null) => listCtl.setFilter('kind', value);
  const setProvider = (value: string) => listCtl.setFilter('provider', value);
  const [health, setHealth] = useState<Record<string, Health>>(() => Object.fromEntries(healthCache.entries()));
  // "checked 3 min ago" moves on without a re-read: the instant is state, ticked every 30 s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const nameOf = (p: string) => providers.find((x) => x.provider === p)?.display_name ?? p;
  const categoryOf = (p: string) => providers.find((x) => x.provider === p)?.category;
  const categoryTitle = (p: string) => {
    const key = categoryOf(p);
    return key && (CATEGORY_KEYS as readonly string[]).includes(key) ? t(`int_cat_${key}`) : t('int_cat_other');
  };
  const defaultUrl = (p: string) => providers.find((x) => x.provider === p)?.default_base_url ?? '';
  // A row stored on an ancestor is shared with sibling tenants: removing it affects them too.
  // The gear says so on the list read with ancestors (#1043); else the holder tells.
  const inheritedOf = (c: StoredConnection) => c.inherited ?? c.owner_tenant_id !== org.id;
  const browsable = (c: StoredConnection) => categoryOf(c.provider) === 'source_code';

  const probe = useCallback(
    (c: StoredConnection) =>
      api
        .testConnection(c.id, org.id)
        .fetch(undefined)
        .then(
          (r): Health => ({
            state: 'ok',
            text: r.display_name ? `${r.account} (${r.display_name})` : r.account,
            at: Date.now(),
          }),
          (e: unknown): Health => ({ state: 'bad', text: errText(e), at: Date.now() })
        )
        .then((v) => {
          healthCache.set(c.id, v);
          setHealth((h) => ({ ...h, [c.id]: v }));
        }),
    [api, org.id]
  );

  const retest = (c: StoredConnection) => {
    setHealth((h) => ({
      ...h,
      [c.id]: { state: 'testing', text: h[c.id]?.text ?? t('int_checking'), at: h[c.id]?.at ?? Date.now() },
    }));
    void probe(c);
  };

  // Ask what has no fresh answer, once per list of connections.
  const ids = connections.map((c) => c.id).join(',');
  useEffect(() => {
    const at = Date.now();
    for (const c of connections) {
      const known = healthCache.get(c.id);
      if (!known || at - known.at > HEALTH_TTL_MS) void probe(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per list of ids, as the prototype asked
  }, [ids, probe]);

  const missing = loading ? [] : missingCategories(providers, connections);
  const providersPresent = [...new Set(connections.map((c) => c.provider))];
  const kindsPresent = CATEGORY_KEYS.filter((key) => connections.some((c) => categoryOf(c.provider) === key));

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const kept = connections.filter(
      (c) =>
        (!kind || categoryOf(c.provider) === kind) &&
        (!provider || c.provider === provider) &&
        (!q || [c.label, c.account, c.base_url, nameOf(c.provider)].some((f) => (f ?? '').toLowerCase().includes(q)))
    );
    if (!sort) return kept;
    const by =
      sort.key === 'connection'
        ? (a: StoredConnection, b: StoredConnection) => a.label.localeCompare(b.label)
        : (a: StoredConnection, b: StoredConnection) => categoryTitle(a.provider).localeCompare(categoryTitle(b.provider));
    return [...kept].sort((a, b) => (sort.desc ? by(b, a) : by(a, b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read `providers`, listed
  }, [connections, providers, kind, provider, q, sort?.key, sort?.desc]);

  const sortBy = (key: SortKey) => listCtl.toggleSort(key);
  const sortMark = (key: SortKey) => (sort?.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');

  const usedBy = (c: StoredConnection) => {
    if (c.provider === 'kubernetes' || c.provider === 'registry') {
      const names = envUses.get(c.id);
      return <span className={styles.sub}>{names?.length ? t('int_used_envs', { names: names.join(', ') }) : t('int_used_none')}</span>;
    }
    if (c.provider === GEAR_REPOSITORY) return <span className={styles.sub}>{t('int_used_gear_repos')}</span>;
    return <span className={styles.sub}>—</span>;
  };

  const scopeWord = (scope: string) =>
    ['organization', 'workspace', 'personal'].includes(scope) ? t(`int_scope_${scope}`) : scope;

  return (
    <Card data-connections>
      <CardContent className={styles.cardBody}>
        <div className={styles.toolbar}>
          <h3 className={styles.subtitle}>{t('int_connections')}</h3>
          <span className={own.spacer} />
          <Input
            className={styles.search}
            type="search"
            value={query}
            placeholder={t('int_search')}
            aria-label={t('int_search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button size="sm" disabled={adding} onClick={() => onAdd()} data-connection-add>
            {t('int_add')}
          </Button>
        </div>
        {kindsPresent.length > 0 && (
          <div className={styles.inline} role="group" aria-label={t('int_kind')}>
            <Button size="sm" variant={kind === null ? 'secondary' : 'ghost'} onClick={() => setKind(null)}>
              {t('int_every_kind')}
            </Button>
            {kindsPresent.map((key) => (
              <Button
                key={key}
                size="sm"
                variant={kind === key ? 'secondary' : 'ghost'}
                onClick={() => setKind(kind === key ? null : key)}
                data-kind-chip={key}
              >
                {t(`int_cat_${key}`)}
              </Button>
            ))}
            {providersPresent.length > 1 && (
              <NativeSelect aria-label={t('int_provider')} value={provider} onChange={(e) => setProvider(e.target.value)}>
                <NativeSelectOption value="">{t('int_every_provider')}</NativeSelectOption>
                {providersPresent.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {nameOf(p)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>
        )}

        {loading ? (
          <p className={styles.muted}>{t('reading')}</p>
        ) : connections.length === 0 ? (
          <div data-connections-empty>
            <p className={styles.subtitle}>{t('int_empty_title', { name: org.name })}</p>
            <p className={styles.muted}>{t('int_empty_body')}</p>
          </div>
        ) : rows.length === 0 ? (
          <p className={styles.muted}>{t('int_no_match')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className={own.sortHead} onClick={() => sortBy('connection')}>
                    {t('int_col_connection')}
                    {sortMark('connection')}
                  </button>
                </TableHead>
                <TableHead>
                  <button type="button" className={own.sortHead} onClick={() => sortBy('kind')}>
                    {t('int_col_kind')}
                    {sortMark('kind')}
                  </button>
                </TableHead>
                <TableHead>{t('int_col_answers')}</TableHead>
                <TableHead>{t('int_col_used')}</TableHead>
                <TableHead>{t('int_col_scope')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const h = health[c.id];
                const address = nonDefaultAddress(c.base_url, defaultUrl(c.provider));
                const answer = h
                  ? h.text.replace(` (${c.base_url})`, '').replace(` (${c.base_url.replace(/\/$/, '')})`, '')
                  : t('int_checking');
                return (
                  <React.Fragment key={c.id}>
                    <TableRow data-connection={c.id}>
                      <TableCell>
                        <span className={own.lead}>
                          <LogoSlot>
                            <ConnectorLogo provider={c.provider} label={nameOf(c.provider)} />
                          </LogoSlot>
                          <span className={own.stack}>
                            <span className={own.name}>
                              <StatusDot
                                tone={h?.state === 'ok' ? 'success' : h?.state === 'bad' ? 'danger' : 'neutral'}
                                live={!h || h.state === 'testing'}
                              />
                              {c.label}
                            </span>
                            <span className={styles.sub}>
                              {nameOf(c.provider)}
                              {address ? ` · ${address}` : ''}
                            </span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className={styles.sub}>{categoryTitle(c.provider)}</TableCell>
                      <TableCell>
                        <span
                          className={h?.state === 'bad' ? own.bad : h?.state === 'ok' ? own.ok : styles.sub}
                          title={h?.text}
                          data-connection-answer={h?.state ?? 'testing'}
                        >
                          {answer}
                        </span>
                        {h && h.state !== 'testing' && (
                          <span className={styles.sub}> · {t('int_checked', { when: ago(h.at, Math.max(now, h.at), t) })}</span>
                        )}
                      </TableCell>
                      <TableCell>{usedBy(c)}</TableCell>
                      <TableCell>
                        <Badge variant={c.scope === 'personal' ? 'outline' : 'secondary'}>
                          {inheritedOf(c) ? t('int_scope_shared', { scope: scopeWord(c.scope) }) : scopeWord(c.scope)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className={styles.inline}>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={h?.state === 'testing'}
                            onClick={() => retest(c)}
                            data-connection-test
                          >
                            {h?.state === 'testing' ? t('int_checking') : t('int_test_again')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            // Inherited connections are edited where they are defined.
                            disabled={inheritedOf(c)}
                            onClick={() => {
                              setOpen(null);
                              setEditing(editing === c.id ? null : c.id);
                            }}
                            data-connection-edit
                          >
                            {editing === c.id ? t('int_close_editor') : t('int_edit')}
                          </Button>
                          {browsable(c) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(null);
                                setOpen(open === c.id ? null : c.id);
                              }}
                              data-connection-browse
                            >
                              {open === c.id ? t('int_hide_repos') : t('int_browse_repos')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              ask(
                                {
                                  title: inheritedOf(c)
                                    ? t('int_remove_shared_title', { label: c.label })
                                    : t('int_remove_title', { label: c.label }),
                                  body: inheritedOf(c) ? t('int_remove_shared_body') : t('int_remove_body'),
                                  confirmLabel: t('remove'),
                                },
                                async () => {
                                  await api.deleteConnection(c.id, org.id).fetch(undefined);
                                  onChanged();
                                }
                              )
                            }
                            data-connection-remove
                          >
                            {t('remove')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {editing === c.id ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <EditConnection
                            org={org}
                            connection={c}
                            onNote={onNote}
                            onDone={(changed) => {
                              setEditing(null);
                              if (changed) {
                                // A rotated credential invalidates the cached answer: it was for the old token.
                                healthCache.delete(c.id);
                                retest(c);
                                onChanged();
                              }
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ) : open === c.id && browsable(c) ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <RepoBrowser
                            org={org}
                            connection={c}
                            sourcesTick={sourcesTick}
                            onSourcesChanged={onSourcesChanged}
                            onNote={onNote}
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}

        {missing.length > 0 && (
          <div className={own.missing} data-connections-missing>
            <span className={styles.sub}>{t('int_missing')}</span>
            {missing.map((key) => (
              <span key={key}>
                <b>{t(`int_cat_${key}`)}</b>{' '}
                <span className={styles.sub}>
                  — {MISSING_EXPLAINED.includes(key) ? t(`int_missing_${key}`) : t('int_missing_other')}
                </span>{' '}
                <Button size="sm" variant="link" onClick={() => onAdd(key)} data-missing-add={key}>
                  {t('int_add_kind')}
                </Button>
              </span>
            ))}
          </div>
        )}
      </CardContent>
      {confirmDialog}
    </Card>
  );
}
