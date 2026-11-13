/**
 * A registry of the organization, opened from its place: what its
 * environments do with it, its repositories -- each opened to its versions,
 * read only when it is opened, as a registry may hold thousands -- and, on a
 * tab beside them, the orphans: what is in it that no project or record of
 * Studio accounts for, and what Studio recorded that it no longer has. A
 * version that runs somewhere is not deleted. The prototype's
 * registry-browser-view.tsx (00828880); the words are registry-browser.ts's
 * and images.ts's (English).
 */

import { useEffect, useState } from 'react';
import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Tabs, TabsList, TabsTrigger } from '@gears-frontx/ui-kit';
import type { OrgRegistry, RegistryOrphan, RegistryRepository, RegistryTag } from '../../api/types';
import { imageRefusalText, shortDigest, sizeText, whereItRuns } from '../../model/images';
import {
  ORPHAN_REASON,
  REGISTRY_KIND,
  orphanGroups,
  orphanSummary,
  repositoryRows,
  roleWords,
  sortTags,
  versionDeletion,
} from '../../model/registry-browser';
import { Confirm, errText, relTime, useApi, useInfra } from './parts';
import styles from './InfrastructureScreen.module.css';

/** The image refusal a failed request carries: images.ts reads a problem
 *  document from `body`, where the FrontX client keeps it in `response.data`. */
function refusal(e: unknown): string | null {
  const data = (e as { response?: { data?: unknown } } | null)?.response?.data;
  return imageRefusalText({ body: data });
}

export function RegistryBrowser({ connectionId }: { connectionId: string }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [tab, setTab] = useState<'repositories' | 'orphans'>('repositories');
  const [registry, setRegistry] = useState<OrgRegistry | null>(null);
  const [repos, setRepos] = useState<RegistryRepository[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<RegistryOrphan[] | null>(null);
  const [orphansError, setOrphansError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .orgRegistries({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((r) => live && setRegistry(r.items.find((x) => x.connection_id === connectionId) ?? null))
      .catch(() => live && setRegistry(null));
    api
      .registryRepositories({ organizationId: org.id, connectionId })
      .fetch({ staleTime: 0 })
      .then((r) => {
        if (!live) return;
        setRepos(r.items);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setRepos([]);
        setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, org.id, connectionId, round]);

  // The orphans are a walk of the whole registry: asked for only once the tab is opened.
  useEffect(() => {
    if (tab !== 'orphans' || orphans !== null) return;
    let live = true;
    api
      .registryOrphans({ organizationId: org.id, connectionId })
      .fetch({ staleTime: 0 })
      .then((r) => live && setOrphans(r.items))
      .catch((e: unknown) => {
        if (!live) return;
        setOrphans([]);
        setOrphansError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, tab, orphans, org.id, connectionId]);

  return (
    <div className={styles.stack} data-registry-browser={connectionId}>
      {registry && (
        <p className={styles.muted} data-registry-role>
          {REGISTRY_KIND[registry.kind]} · {roleWords(registry.role)}
          {registry.prefixes.length > 0 && (
            <>
              {' · '}
              {t('registry_under')}{' '}
              {registry.prefixes.map((p) => (
                <code key={p}>{p} </code>
              ))}
            </>
          )}
        </p>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v === 'orphans' ? 'orphans' : 'repositories')}>
        <TabsList variant="line" aria-label={t('registry_tabs')}>
          <TabsTrigger value="repositories" data-registry-tab="repositories">
            {t('registry_repositories')}
            {repos && repos.length > 0 && <Badge variant="secondary">{repos.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="orphans" data-registry-tab="orphans">
            {t('registry_orphans')}
            {orphans && orphans.length > 0 && <Badge variant="warning">{orphans.length}</Badge>}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'repositories' ? (
        <>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {repos === null ? (
            <p className={styles.hint}>{t('registry_reading')}</p>
          ) : repos.length === 0 && !error ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('registry_empty')}</EmptyTitle>
                <EmptyDescription>{t('registry_empty_body')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className={styles.list} data-registry-repositories>
              {repositoryRows(repos).map((r) => (
                <li key={r.name} data-registry-repository={r.name}>
                  <button
                    type="button"
                    className={styles.link}
                    aria-expanded={open === r.name}
                    onClick={() => setOpen(open === r.name ? null : r.name)}
                  >
                    {open === r.name ? '▾' : '▸'} <code>{r.name}</code>
                  </button>{' '}
                  <span className={styles.muted}>
                    {r.owner} · {t('recorded_count', { count: r.recorded })}
                  </span>
                  {open === r.name && (
                    <RepositoryTags
                      connectionId={connectionId}
                      repository={r.name}
                      onDeleted={() => setRound((n) => n + 1)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div data-registry-orphans>
          {orphansError && (
            <p role="alert" className={styles.error}>
              {orphansError}
            </p>
          )}
          {orphans === null ? (
            <p className={styles.hint}>{t('registry_walking')}</p>
          ) : (
            <>
              <p className={styles.muted} data-registry-orphans-summary>
                {orphanSummary(orphans)}
              </p>
              {orphanGroups(orphans).map((g) => (
                <div key={g.reason} data-orphan-reason={g.reason}>
                  <h4 className={styles.subhead}>
                    {ORPHAN_REASON[g.reason].title} · {g.items.length}
                  </h4>
                  <p className={styles.muted}>{ORPHAN_REASON[g.reason].next}</p>
                  <ul className={styles.list}>
                    {g.items.map((o) => (
                      <li key={`${o.repository}@${o.digest ?? o.tags.join(',')}`}>
                        <code>{o.repository}</code>
                        {o.tags.length > 0 && <span className={styles.muted}> · {o.tags.join(', ')}</span>}
                        {o.digest && <span className={styles.muted}> · {shortDigest(o.digest)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One repository's versions, read when it is opened, newest first. */
function RepositoryTags({
  connectionId,
  repository,
  onDeleted,
}: {
  connectionId: string;
  repository: string;
  onDeleted: () => void;
}) {
  const { t, org, language } = useInfra();
  const api = useApi();
  const [tags, setTags] = useState<RegistryTag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RegistryTag | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .registryTags({ organizationId: org.id, connectionId, repository })
      .fetch({ staleTime: 0 })
      .then((r) => live && setTags(sortTags(r.items)))
      .catch((e: unknown) => {
        if (!live) return;
        setTags([]);
        setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, org.id, connectionId, repository, round]);

  const what = (v: RegistryTag) => v.tags[0] ?? (v.digest ? shortDigest(v.digest) : t('this_version'));

  return (
    <div className={styles.nested} data-registry-tags={repository}>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}
      {tags === null ? (
        <p className={styles.hint}>{t('versions_reading')}</p>
      ) : tags.length === 0 && !error ? (
        <p className={styles.muted}>{t('no_version')}</p>
      ) : (
        <ul className={styles.list}>
          {tags.map((v) => {
            const deletion = versionDeletion(v);
            return (
              <li key={v.digest ?? v.tags.join(',')} data-registry-version={v.digest ?? undefined}>
                <div className={styles.line}>
                  {v.tags.length > 0 ? (
                    v.tags.map((x) => <code key={x}>{x}</code>)
                  ) : (
                    <span className={styles.muted}>{t('no_tag')}</span>
                  )}
                  <span className={styles.muted}>
                    {v.digest ? <code>{shortDigest(v.digest)}</code> : t('no_digest')}
                    {v.size_bytes != null ? ` · ${sizeText(v.size_bytes)}` : ''}
                    {v.pushed_at ? ` · ${relTime(v.pushed_at, language)}` : ''}
                  </span>
                  {v.image_id ? (
                    <Badge variant="success" title={t('recorded_title')}>
                      {t('recorded')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" title={t('not_recorded_title')}>
                      {t('not_recorded')}
                    </Badge>
                  )}
                  <span className={styles.grow} />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!deletion.allowed}
                    title={deletion.reason ?? t('delete_version_title')}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(v);
                    }}
                    data-registry-version-delete
                  >
                    {t('delete')}
                  </Button>
                </div>
                {v.running_in.length > 0 && <div className={styles.muted}>{whereItRuns(v.running_in)}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {deleting && (
        <Confirm
          title={t('delete_version_confirm', { what: what(deleting), repository })}
          body={t('delete_version_body')}
          confirmLabel={t('delete')}
          busy={busy}
          error={deleteError}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            setDeleteError(null);
            try {
              if (!deleting.digest) throw new Error(t('no_digest_to_delete'));
              await api.deleteRegistryVersion(org.id, connectionId, repository, deleting.digest).fetch(undefined);
              setDeleting(null);
              setNotice(t('deleting_version'));
              setRound((n) => n + 1);
              onDeleted();
            } catch (e) {
              setDeleteError(refusal(e) ?? errText(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
