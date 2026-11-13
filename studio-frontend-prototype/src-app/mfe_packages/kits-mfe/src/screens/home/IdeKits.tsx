/**
 * Project › Kits › In the IDE: the old prototype's project Kits tab
 * (`kits.tsx`, `section="kits"`). The official kits `cfs` installs into the
 * project's checkouts, what the project asked for, and where each one was
 * actually written (`model/ideKits.ts`).
 *
 * The browser never runs a kit's scripts: a request goes to studio-kits, which
 * asks the trusted `cfs` runner in the project's IDE session. Without a
 * running session the repository list answers 503 — said as "open the IDE",
 * not as an error — and an install is still recorded, then written into the
 * project repository by the IDE when it can. Reconcile runs once a visit for a
 * kit meant for every repository, which is how a repository added later gets
 * it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import { errorMessage, refusalText, responseStatus } from '@constructor-studio/mfe-shared';
import { KitsApiService, type CatalogKit } from '../../api/KitsApiService';
import {
  reconcileKey,
  repositoryLabel,
  statusTone,
  targetRepository,
  toReconcile,
  type KitInstallation,
  type ProjectRepository,
} from '../../model/ideKits';
import type { useHomeTranslations } from '../../i18n';
import styles from './HomeScreen.module.css';

type Text = ReturnType<typeof useHomeTranslations>['t'];

const problemOf = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** One read of the tab: each part `null` when it could not be read. */
interface Loaded {
  catalog: CatalogKit[] | null;
  installations: KitInstallation[] | null;
  error: string | null;
  repositories: ProjectRepository[] | null;
  /** Why the repositories are unknown: no session (503), or another failure's words. */
  note: string | null;
}

export const IdeKits: React.FC<{ projectId: string; t: Text }> = ({ projectId, t }) => {
  const api = apiRegistry.getService(KitsApiService);
  const [catalog, setCatalog] = useState<CatalogKit[] | null>(null);
  const [installed, setInstalled] = useState<KitInstallation[]>([]);
  const [repositories, setRepositories] = useState<ProjectRepository[] | null>(null);
  /** Why the repositories are unknown: no session (503), or another failure. */
  const [repositoriesNote, setRepositoriesNote] = useState<'no-session' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const reconciled = useRef(new Set<string>());

  const readInstallations = useCallback(
    async () => (await api.ideInstallations({ projectId }).fetch({ staleTime: 0 }))?.items ?? [],
    [api, projectId]
  );

  /**
   * One read of everything, and the rollout a session makes possible; no
   * state is touched until it is all in (`apply`), so the effect below only
   * subscribes to an answer.
   */
  const load = useCallback(async (): Promise<Loaded> => {
    const read: Loaded = { catalog: null, installations: null, error: null, repositories: null, note: null };
    try {
      const [kits, installations] = await Promise.all([api.ideCatalog.fetch({ staleTime: 0 }), readInstallations()]);
      read.catalog = kits?.items ?? [];
      read.installations = installations;
    } catch (e) {
      read.error = problemOf(e);
    }

    // Apart from the catalogue: no session is the ordinary state of this page,
    // and must not blank the kit list.
    try {
      read.repositories = (await api.ideRepositories({ projectId }).fetch({ staleTime: 0 }))?.items ?? [];
    } catch (e) {
      read.note = responseStatus(e) === 503 ? 'no-session' : problemOf(e);
    }
    if (!read.repositories || !read.installations) return read;

    const pending = toReconcile(read.installations, reconciled.current);
    if (pending.length === 0) return read;
    for (const installation of pending) {
      reconciled.current.add(reconcileKey(installation.kit_slug, installation.version));
      try {
        await api.reconcileIdeInstallation(projectId, installation.kit_slug).fetch({});
      } catch {
        // Each repository's outcome is recorded on the installation either way.
      }
    }
    try {
      read.installations = await readInstallations();
    } catch {
      // Keep what was read before the rollout.
    }
    return read;
  }, [api, projectId, readInstallations]);

  const apply = useCallback((read: Loaded) => {
    setError(read.error);
    setCatalog((previous) => read.catalog ?? previous ?? []);
    if (read.installations) setInstalled(read.installations);
    setRepositories(read.repositories);
    setRepositoriesNote(read.note);
  }, []);

  const reload = useCallback(async () => apply(await load()), [apply, load]);

  useEffect(() => {
    let alive = true;
    void load().then((read) => {
      if (alive) apply(read);
    });
    return () => {
      alive = false;
    };
  }, [load, apply]);

  const bySlug = useMemo(() => new Map(installed.map((i) => [i.kit_slug, i])), [installed]);
  const everyRepository = (slug: string): boolean => scopes[slug] ?? bySlug.get(slug)?.scope === 'all-repositories';
  const versionOf = (kit: CatalogKit): string => versions[kit.slug] ?? bySlug.get(kit.slug)?.version ?? kit.default_version;

  const install = async (kit: CatalogKit) => {
    const version = versionOf(kit).trim();
    if (!version) return;
    setBusy(kit.slug);
    setError(null);
    try {
      const scope = everyRepository(kit.slug) ? 'all-repositories' : 'project';
      await api.requestIdeInstallation(projectId).fetch({ kit_slug: kit.slug, version, install_mode: 'copy', scope });
      if (scope === 'all-repositories') {
        // One call reaches every repository: nothing to choose, nothing to write first.
        reconciled.current.add(reconcileKey(kit.slug, version));
        await api.reconcileIdeInstallation(projectId, kit.slug).fetch({});
      } else {
        const repository = targetRepository(targets[kit.slug], bySlug.get(kit.slug), repositories);
        await api.materializeIdeInstallation(projectId, kit.slug).fetch(repository ? { repository_id: repository } : {});
      }
      await reload();
    } catch (e) {
      // The request may be recorded and the write failed: read again, then say why.
      await reload();
      setError(
        responseStatus(e) === 503 || repositoriesNote === 'no-session'
          ? t('ide_install_no_session', { error: problemOf(e) })
          : problemOf(e)
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slug: string) => {
    setBusy(slug);
    setError(null);
    try {
      await api.removeIdeInstallation(projectId, slug).fetch(undefined);
      setConfirming(null);
      await reload();
    } catch (e) {
      setError(problemOf(e));
    } finally {
      setBusy(null);
    }
  };

  const installedCount = catalog ? catalog.filter((kit) => bySlug.has(kit.slug)).length : 0;
  const anyFailed = installed.some((i) => i.status === 'failed');

  return (
    <section className={styles.ide} data-ide-kits>
      <div className={styles.ideHead}>
        <h3 className={styles.cardTitle}>{t('ide_title')}</h3>
        <Badge variant="info">{t('ide_experimental')}</Badge>
        {catalog !== null && catalog.length > 0 && (
          <Badge variant={installedCount > 0 ? 'success' : 'secondary'} data-ide-count>
            {t('ide_count', { installed: String(installedCount), total: String(catalog.length) })}
          </Badge>
        )}
        {anyFailed && <Badge variant="destructive">{t('ide_failed_any')}</Badge>}
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void reload()}>
          {t('ide_refresh')}
        </Button>
      </div>
      <p className={styles.cardText}>{t('ide_hint')}</p>
      {repositoriesNote && (
        <p className={styles.note} role="status" data-ide-no-session={repositoriesNote === 'no-session' ? '' : undefined}>
          {repositoriesNote === 'no-session' ? t('ide_no_session') : t('ide_repositories_failed', { error: repositoriesNote })}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error} data-ide-error>
          {error}
        </p>
      )}
      {catalog === null ? (
        <p className={styles.note}>{t('ide_loading')}</p>
      ) : catalog.length === 0 ? (
        <p className={styles.note} data-ide-empty>
          {t('ide_empty')}
        </p>
      ) : (
        <ul className={styles.grid}>
          {catalog.map((kit) => {
            const installation = bySlug.get(kit.slug);
            const isBusy = busy === kit.slug;
            const several = !!repositories && repositories.length > 1;
            return (
              <li key={kit.slug} className={styles.card} data-ide-kit={kit.slug}>
                <div className={styles.badges}>
                  <Badge variant="secondary">{kit.publisher}</Badge>
                  {installation && (
                    <Badge variant={statusTone(installation.status)} dot data-ide-status={installation.status}>
                      {t(`ide_status_${installation.status}`)}
                    </Badge>
                  )}
                </div>
                <h4 className={styles.cardTitle}>{kit.name}</h4>
                <p className={styles.cardText}>{kit.description}</p>
                <dl className={styles.facts}>
                  {kit.repository_url && (
                    <>
                      <dt>{t('repository')}</dt>
                      <dd>
                        <a href={kit.repository_url} target="_blank" rel="noreferrer">
                          {kit.repository_url.replace('https://', '')}
                        </a>
                      </dd>
                    </>
                  )}
                  <dt>{t('ide_manifest')}</dt>
                  <dd>
                    <code>{kit.manifest_path}</code>
                  </dd>
                </dl>
                <div className={styles.addFields}>
                  <label>
                    {t('ide_version')}
                    <input
                      className={styles.input}
                      value={versionOf(kit)}
                      onChange={(e) => setVersions((current) => ({ ...current, [kit.slug]: e.target.value }))}
                    />
                  </label>
                  {several && (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={everyRepository(kit.slug)}
                        onChange={(e) => setScopes((current) => ({ ...current, [kit.slug]: e.target.checked }))}
                      />
                      {t('ide_every_repository')}
                    </label>
                  )}
                  {several && !everyRepository(kit.slug) && (
                    <label>
                      {t('ide_repository')}
                      <select
                        value={targetRepository(targets[kit.slug], installation, repositories) ?? ''}
                        onChange={(e) => setTargets((current) => ({ ...current, [kit.slug]: e.target.value }))}
                      >
                        {repositories!.map((repository) => (
                          <option key={repository.repository_id} value={repository.repository_id}>
                            {repository.kind === 'project'
                              ? `${repository.label} · ${t('ide_whole_project')}`
                              : repository.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {installation && (
                  <p className={styles.note} data-ide-requested>
                    {t('ide_requested', {
                      version: installation.version,
                      mode: installation.install_mode,
                      at: new Date(installation.requested_at).toLocaleString(),
                    })}
                    {installation.scope === 'all-repositories' && ` · ${t('ide_every_repository')}`}
                  </p>
                )}
                {installation?.materializations && installation.materializations.length > 0 && (
                  <ul className={styles.detailList} data-ide-materializations>
                    {installation.materializations.map((entry) => (
                      <li key={entry.repository_id} data-materialized={entry.status}>
                        {repositoryLabel(entry, repositories, t('ide_whole_project'))} · <code>{entry.version}</code> ·{' '}
                        {new Date(entry.materialized_at).toLocaleString()}
                        {entry.status === 'failed' && (
                          <>
                            {' '}
                            <Badge variant="destructive">{t('ide_status_failed')}</Badge>
                            {entry.failure_reason && <span className={styles.error}> {entry.failure_reason}</span>}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {installation?.failure_reason && (
                  <p className={styles.error} data-ide-failure>
                    {installation.failure_reason}
                  </p>
                )}
                <div className={styles.actions}>
                  <Button size="sm" disabled={isBusy} onClick={() => void install(kit)}>
                    {isBusy ? t('ide_installing') : installation ? t('ide_reinstall') : t('ide_install')}
                  </Button>
                  {installation &&
                    (confirming === kit.slug ? (
                      <span className={styles.confirm} data-ide-confirm>
                        {t('ide_remove_confirm')}
                        <Button variant="destructive" size="sm" disabled={isBusy} onClick={() => void remove(kit.slug)}>
                          {t('ide_remove')}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => setConfirming(null)}>
                          {t('add_cancel')}
                        </Button>
                      </span>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => setConfirming(kit.slug)}>
                        {t('ide_remove')}
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

IdeKits.displayName = 'IdeKits';
