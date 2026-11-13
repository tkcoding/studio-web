/**
 * The repositories a source-code connection reaches — the prototype's
 * `RepoBrowser` (`App.tsx` at 00828880): search, tick, choose how shared edits
 * land, add. What is added goes into the tenant's project config `sources[]`
 * (`attachReposToWorkspace`), the record every session clones from, and the
 * tenant's catalogue is asked to read them (not waited on). On the
 * organization's page that tenant is the organization, as it was in the
 * prototype. One already listed shows as attached and cannot be ticked.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Badge, Button, Checkbox, Input, NativeSelect, NativeSelectOption } from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  PROJECT_CONFIG_TYPE,
  type OrganizationRef,
  type ProjectConfig,
  type ProjectSource,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import type { RemoteRepo, StoredConnection } from '../../../api/types';
import { hasRepository, supportsPullRequests, withPicked, type ShareMode } from '../../../model/connections';
import { ErrorLine, errText, useAdmin } from '../common';
import styles from '../Admin.module.css';
import own from './Integrations.module.css';

export function RepoBrowser({
  org,
  connection,
  sourcesTick,
  onSourcesChanged,
  onNote,
}: {
  org: OrganizationRef;
  connection: StoredConnection;
  /** Reload the attached set when sources change elsewhere on the page. */
  sourcesTick: number;
  onSourcesChanged: () => void;
  onNote: (text: string) => void;
}) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [search, setSearch] = useState('');
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState<ProjectSource[]>([]);
  const [shareMode, setShareMode] = useState<ShareMode>('branch');

  const readConfig = useCallback(
    () =>
      accounts
        .getTenantMetadata<ProjectConfig>({ tenantId: org.id, metadataType: PROJECT_CONFIG_TYPE })
        .fetch({ staleTime: 0 })
        .then((entry) => entry?.value ?? {}),
    [accounts, org.id]
  );

  const loadAttached = useCallback(
    () =>
      readConfig()
        .then((config) => setAttached(config.sources ?? []))
        .catch(() => setAttached([])),
    [readConfig]
  );

  const load = useCallback(
    (q: string) =>
      api
        .connectionRepositories({ id: connection.id, tenant: org.id, search: q })
        .fetch({ staleTime: 0 })
        .then(
          (r) => {
            setError(null);
            setRepos(r.items ?? []);
          },
          (e: unknown) => {
            setError(errText(e));
            setRepos([]);
          }
        ),
    [api, connection.id, org.id]
  );

  useEffect(() => {
    void load('');
    void loadAttached();
  }, [load, loadAttached, sourcesTick]);

  const picks = (repos ?? []).filter((r) => checked[r.id]);
  const pullRequests = supportsPullRequests(connection);
  const effectiveShareMode: ShareMode = pullRequests ? shareMode : 'branch';

  const attach = async () => {
    if (picks.length === 0) return;
    setBusy(true);
    try {
      const current = await readConfig();
      const { sources, added } = withPicked(current.sources, connection, picks, effectiveShareMode);
      if (added > 0) {
        await accounts.putTenantMetadata<ProjectConfig>(org.id, PROJECT_CONFIG_TYPE).fetch({ ...current, sources });
        // The catalogue reads them now; a sync that cannot be queued must not undo the save.
        void api
          .syncProjectCatalogue(org.id)
          .fetch(undefined)
          .catch(() => undefined);
      }
      onNote(t.count('int_attached', added, { name: org.name }));
      setChecked({});
      void loadAttached();
      onSourcesChanged();
    } catch (e) {
      onNote(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={own.form} data-repo-browser>
      <form
        className={styles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
      >
        <Input
          className={styles.grow}
          value={search}
          placeholder={t('int_repos_search')}
          aria-label={t('int_repos_search')}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline">
          {t('int_search_go')}
        </Button>
      </form>

      {error && <ErrorLine>{error}</ErrorLine>}
      {repos === null ? (
        <p className={styles.muted}>{t('int_repos_loading')}</p>
      ) : repos.length === 0 ? (
        <p className={styles.muted}>{t('int_repos_none')}</p>
      ) : (
        <ul className={own.repos}>
          {repos.map((r) => {
            const isAttached = hasRepository(attached, r.clone_url);
            return (
              <li key={r.id} data-repo={r.full_path}>
                <Checkbox
                  aria-label={r.full_path}
                  disabled={isAttached}
                  checked={isAttached || Boolean(checked[r.id])}
                  onCheckedChange={(v) => setChecked((c) => ({ ...c, [r.id]: v === true }))}
                />
                <span className={`${own.stack} ${styles.grow}`}>
                  <span>{r.full_path}</span>
                  <span className={styles.sub}>
                    {r.default_branch ?? t('int_default_branch')}
                    {r.description ? ` · ${r.description}` : ''}
                  </span>
                </span>
                {isAttached ? (
                  <Badge variant="success">{t('int_attached_mark')}</Badge>
                ) : (
                  r.visibility && <Badge variant="outline">{r.visibility}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className={own.actions}>
        <span className={own.spacer} />
        <span className={styles.sub} title={t('int_share_title')}>
          {t('int_share_label')}
        </span>
        <NativeSelect
          aria-label={t('int_share_label')}
          value={effectiveShareMode}
          onChange={(e) => setShareMode(e.target.value as ShareMode)}
        >
          <NativeSelectOption value="branch">{t('int_share_branch')}</NativeSelectOption>
          <NativeSelectOption value="pull_request" disabled={!pullRequests}>
            {pullRequests ? t('int_share_pr') : t('int_share_pr_github')}
          </NativeSelectOption>
        </NativeSelect>
        <Button size="sm" disabled={picks.length === 0 || busy} onClick={() => void attach()} data-repo-attach>
          {busy
            ? t('int_attaching')
            : picks.length
              ? t.count('int_add_n_to', picks.length, { name: org.name })
              : t('int_add_to_name', { name: org.name })}
        </Button>
      </div>
    </div>
  );
}
