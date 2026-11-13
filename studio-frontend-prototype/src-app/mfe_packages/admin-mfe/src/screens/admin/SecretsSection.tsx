/**
 * Admin › Secrets — the prototype's `SecretsView` (`App.tsx`) carried over
 * (ADR-0069): repository credentials in credstore. Values are write-only;
 * credstore has no list endpoint, so the section lists the references this
 * organization's workspaces name (their settings' root token, the connections
 * behind their sources), probes each with a read, and rotates or deletes one.
 * Anything saved outside the portal does not appear.
 */

import React, { useEffect, useState } from 'react';
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
  PROJECT_CONFIG_TYPE,
  responseStatus,
  useOrganization,
  type OrganizationRef,
  type ProjectConfig,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type { Connection, WorkspaceSettings } from '../../api/types';
import { knownSecretRefs, type SecretRow } from '../../model/secrets';
import { ErrorLine, Header, errText, useAdmin, useConfirm } from './common';
import styles from './Admin.module.css';

export const WS_SETTINGS_TYPE = 'gts.cf.core.am.tenant_metadata.v1~cf.studio.workspace.settings.v1~';
/** Repository credentials are workspace-scoped (tenant sharing): the api_key type. */
export const PAT_SECRET_TYPE = 'gts.cf.core.credstore.secret.v1~cf.core.credstore.api_key.v1~';

type Health = 'ok' | 'broken' | 'checking';

export function SecretsSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;
  return <Secrets key={org.id} org={org} />;
}

function Secrets({ org }: { org: OrganizationRef }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [ask, confirmDialog] = useConfirm();
  const [rows, setRows] = useState<SecretRow[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [status, setStatus] = useState<Record<string, Health>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const workspaces = (await accounts.getWorkspaces({ organizationId: org.id }).fetch({ staleTime: 0 }))?.items ?? [];
        const each = await Promise.all(
          workspaces.map(async (ws) => {
            const [settings, config, connections] = await Promise.all([
              accounts
                .getTenantMetadata<WorkspaceSettings>({ tenantId: ws.id, metadataType: WS_SETTINGS_TYPE })
                .fetch({ staleTime: 0 })
                .catch(() => null),
              accounts
                .getTenantMetadata<ProjectConfig>({ tenantId: ws.id, metadataType: PROJECT_CONFIG_TYPE })
                .fetch({ staleTime: 0 })
                .catch(() => null),
              api
                .connections({ tenant: ws.id })
                .fetch({ staleTime: 0 })
                .then((p) => p.items)
                .catch((): Connection[] => []),
            ]);
            return {
              name: ws.name,
              rootTokenRef: settings?.value?.root_token_ref,
              sources: config?.value?.sources,
              connections,
            };
          })
        );
        if (live) setRows(knownSecretRefs(each));
      } catch (e) {
        if (!live) return;
        setRows([]);
        setReadError(errText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [api, accounts, org.id]);

  async function check(ref: string) {
    setStatus((s) => ({ ...s, [ref]: 'checking' }));
    const r: Health = await api
      .secret({ reference: ref })
      .fetch({ staleTime: 0 })
      .then(
        () => 'ok' as const,
        () => 'broken' as const
      );
    setStatus((s) => ({ ...s, [ref]: r }));
  }

  async function rotate(ref: string) {
    const value = newValue.trim();
    if (!value) return;
    setError(null);
    try {
      try {
        await api.createSecret.fetch({ reference: ref, value, sharing: 'tenant', type: PAT_SECRET_TYPE });
      } catch (e) {
        // 409: the reference exists. Rotate it instead — the unconditional overwrite.
        if (responseStatus(e) !== 409) throw e;
        await api.rotateSecret(ref).fetch({ value, sharing: 'tenant', type: PAT_SECRET_TYPE });
      }
      setRotating(null);
      setNewValue('');
      await check(ref);
    } catch (e) {
      setError(errText(e));
    }
  }

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !q || [r.ref, ...r.usedBy].some((s) => s.toLowerCase().includes(q)));

  return (
    <>
      <Header title={t('secrets_title')} info={<p>{t('secrets_about')}</p>} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <Card data-secrets>
        <CardContent className={styles.cardBody}>
          <Input
            className={styles.search}
            value={query}
            placeholder={t('secrets_search')}
            aria-label={t('secrets_search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {rows === null ? (
            <p className={styles.muted}>{t('reading')}</p>
          ) : readError ? (
            <ErrorLine>{readError}</ErrorLine>
          ) : rows.length === 0 ? (
            <p className={styles.muted}>{t('secrets_empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('secrets_col_ref')}</TableHead>
                  <TableHead>{t('secrets_col_used')}</TableHead>
                  <TableHead>{t('secrets_col_health')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <React.Fragment key={r.ref}>
                    <TableRow data-secret={r.ref}>
                      <TableCell>
                        <code className={styles.mono}>{r.ref}</code>
                      </TableCell>
                      <TableCell className={styles.sub}>{r.usedBy.join(', ')}</TableCell>
                      <TableCell>
                        {status[r.ref] === 'ok' ? (
                          <Badge variant="success">{t('secrets_readable')}</Badge>
                        ) : status[r.ref] === 'broken' ? (
                          <Badge variant="danger" title={t('secrets_broken_hint')}>
                            {t('secrets_broken')}
                          </Badge>
                        ) : (
                          <span className={styles.sub}>
                            {status[r.ref] === 'checking' ? t('secrets_checking') : t('secrets_not_checked')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className={styles.inline}>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={status[r.ref] === 'checking'}
                            onClick={() => void check(r.ref)}
                            data-secret-check
                          >
                            {t('secrets_check')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setNewValue('');
                              setRotating(rotating === r.ref ? null : r.ref);
                            }}
                            data-secret-rotate
                          >
                            {t('secrets_rotate')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              ask(
                                {
                                  title: t('secrets_delete_confirm', { ref: r.ref }),
                                  body: t('secrets_delete_body'),
                                  confirmLabel: t('delete'),
                                },
                                async () => {
                                  await api.deleteSecret(r.ref).fetch(undefined);
                                  setStatus((st) => ({ ...st, [r.ref]: 'broken' }));
                                }
                              )
                            }
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {rotating === r.ref && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <form
                            className={styles.inline}
                            onSubmit={(e) => {
                              e.preventDefault();
                              void rotate(r.ref);
                            }}
                          >
                            <Input
                              className={styles.search}
                              type="password"
                              autoFocus
                              aria-label={t('secrets_new_value_for', { ref: r.ref })}
                              placeholder={t('secrets_new_value')}
                              value={newValue}
                              onChange={(e) => setNewValue(e.target.value)}
                            />
                            <Button type="submit" size="sm" disabled={!newValue.trim()} data-secret-save>
                              {t('save')}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setRotating(null)}>
                              {t('cancel')}
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </>
  );
}
