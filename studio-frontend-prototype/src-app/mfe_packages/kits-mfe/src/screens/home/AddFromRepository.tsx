/**
 * Organization › Kits › "Add a kit from a repository" (ADR-0068 §4, phase 7).
 * The organization's kit administrator picks one of its own shared
 * connections, names the repository, the kit's directory and a ref, and reads
 * the kit there first: what it brings and the commit it would be pinned to.
 * Only then is it added to the organization's shelf. The server reads and
 * checks the manifest (`kit.json`, else `.cf-studio-kit.toml`); a refusal is
 * shown as the server words it.
 */

import { useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Input } from '@gears-frontx/ui-kit';
import { errorMessage } from '@constructor-studio/mfe-shared';
import {
  ConnectionsApiService,
  KitsApiService,
  shelfConnections,
  type Connection,
  type KitDetail,
  type ShelfSource,
} from '../../api/KitsApiService';
import { contentsSummary } from './KitDetailView';
import type { useHomeTranslations } from '../../i18n';
import styles from './HomeScreen.module.css';

type Text = ReturnType<typeof useHomeTranslations>['t'];

export function AddFromRepository({
  organizationId,
  t,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  t: Text;
  onAdded: (kit: KitDetail) => void;
  onCancel: () => void;
}) {
  const api = apiRegistry.getService(KitsApiService);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [repository, setRepository] = useState('');
  const [path, setPath] = useState('');
  const [ref, setRef] = useState('');
  const [slug, setSlug] = useState('');
  const [preview, setPreview] = useState<KitDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiRegistry
      .getService(ConnectionsApiService)
      .connections({ organizationId })
      .fetch({ staleTime: 0 })
      .then(
        (r) => {
          if (!alive) return;
          const own = shelfConnections(r.items ?? [], organizationId);
          setConnections(own);
          if (own.length > 0) setConnectionId(own[0].id);
        },
        () => alive && setConnections([])
      );
    return () => {
      alive = false;
    };
  }, [organizationId]);

  const source = (): ShelfSource => ({
    connection_id: connectionId,
    repository: repository.trim(),
    ...(path.trim() ? { path: path.trim() } : {}),
    ...(ref.trim() ? { ref: ref.trim() } : {}),
    ...(slug.trim() ? { slug: slug.trim() } : {}),
  });

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await step();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const read = () =>
    run(async () => {
      setPreview(await api.previewShelfKit(organizationId).fetch(source()));
    });
  const add = () =>
    run(async () => {
      onAdded(await api.addShelfKit(organizationId).fetch(source()));
    });

  const ready = connectionId !== '' && repository.trim().includes('/');

  return (
    <section className={styles.addForm} data-add-from-repository>
      <h3 className={styles.cardTitle}>{t('add_title')}</h3>
      <p className={styles.cardText}>{t('add_hint')}</p>
      {connections === null ? (
        <p className={styles.note}>…</p>
      ) : connections.length === 0 ? (
        <p className={styles.note} data-no-connections>
          {t('add_no_connections')}
        </p>
      ) : (
        <div className={styles.addFields}>
          <label>
            {t('add_connection')}
            <select
              value={connectionId}
              onChange={(e) => {
                setConnectionId(e.target.value);
                setPreview(null);
              }}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.provider})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('add_repository')}
            <Input
              value={repository}
              placeholder="owner/name"
              onChange={(e) => {
                setRepository(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            {t('add_path')}
            <Input
              value={path}
              placeholder="kits/ops"
              onChange={(e) => {
                setPath(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            {t('add_ref')}
            <Input
              value={ref}
              placeholder="main"
              onChange={(e) => {
                setRef(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            {t('add_slug')}
            <Input value={slug} onChange={(e) => { setSlug(e.target.value); setPreview(null); }} />
          </label>
        </div>
      )}
      {preview && (
        <div className={styles.addPreview} data-shelf-preview={preview.kit.slug}>
          <b>{preview.kit.name}</b> <code>{preview.kit.slug}</code>
          <p className={styles.cardText}>{preview.kit.description}</p>
          <p className={styles.summary}>{contentsSummary(preview.contents, t) || t('sum_nothing')}</p>
          {preview.origin && (
            <p className={styles.note}>
              {t('origin_pinned', {
                commit: preview.origin.commit.slice(0, 12),
                file: preview.origin.manifest_file,
              })}
            </p>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('add_cancel')}
        </Button>
        <Button variant="outline" size="sm" disabled={!ready || busy} onClick={() => void read()}>
          {t('add_read')}
        </Button>
        <Button size="sm" disabled={!preview || busy} onClick={() => void add()}>
          {t('add_confirm')}
        </Button>
      </div>
    </section>
  );
}
