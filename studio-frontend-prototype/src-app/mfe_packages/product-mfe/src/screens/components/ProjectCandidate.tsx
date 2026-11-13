/**
 * A project's candidate, as its Components tab offers it ("could become a
 * gear"): the registry's evidence for it, and Declare it for this project's
 * occurrence (the prototype's `ProjectCandidate` and `DeclareCandidate` in
 * component-registry.tsx, ADR-0041 P3). Declare it previews the files a pull
 * request would add beside the candidate's code, then opens it; the entry
 * stays a candidate until the registry reads the merged declaration.
 */

import { useEffect, useState } from 'react';
import { Button, Input } from '@gears-frontx/ui-kit';
import { responseStatus } from '@constructor-studio/mfe-shared';
import { productApi } from '../../api/client';
import type { RegistryDeclareResult, RegistryEntry } from '../../api/types';
import { useComponentsTranslations } from '../../i18n';
import { errText } from '../common';
import { declareRefusal, detectedProjects, evidenceLines } from './registryLines';
import styles from './ProjectComponentsInventory.module.css';

export function ProjectCandidate({ name, projectId }: { name: string; projectId: string }) {
  const { t } = useComponentsTranslations();
  const [entry, setEntry] = useState<RegistryEntry | null>(null);
  useEffect(() => {
    let live = true;
    productApi
      .registryEntry(name)
      .then((e) => live && setEntry(e))
      .catch(() => live && setEntry(null));
    return () => {
      live = false;
    };
  }, [name]);
  if (!entry || entry.state !== 'candidate') return null;
  return (
    <div className={styles.detail} data-project-candidate>
      <b>{t('why_gear', { score: String(entry.score ?? 0) })}</b>
      <ul className={styles.list}>
        {evidenceLines(entry).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <DeclareCandidate entry={entry} projectId={projectId} />
    </div>
  );
}

function DeclareCandidate({
  entry,
  projectId,
}: {
  entry: Pick<RegistryEntry, 'name' | 'occurrences'>;
  /** Declare the occurrence in this project, when the candidate is in several. */
  projectId?: string;
}) {
  const { t } = useComponentsTranslations();
  const [preview, setPreview] = useState<RegistryDeclareResult | null>(null);
  const [done, setDone] = useState<RegistryDeclareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const inProjects = detectedProjects(entry);
  const project = projectId ?? (inProjects.length > 1 ? inProjects[0] : undefined);

  const run = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await productApi.declareRegistry(entry.name, {
        dry_run: dry,
        project_id: project,
        description: description.trim() || undefined,
      });
      if (dry) setPreview(result);
      else {
        setDone(result);
        setPreview(null);
      }
    } catch (cause) {
      setError(declareRefusal(responseStatus(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div data-declare-done>
        <b>{t('declare_done')}</b> <code>{done.branch}</code> · <code>{done.repo}</code>
        {done.pr_url && (
          <>
            {' — '}
            <a href={done.pr_url} target="_blank" rel="noreferrer">
              {done.pr_url}
            </a>
          </>
        )}
        . {t('declare_done_after')}
      </div>
    );
  }
  return (
    <div className={styles.detail} data-declare-candidate>
      {!preview ? (
        <span>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(true)}>
            {busy ? t('preparing') : t('declare_it')}
          </Button>
        </span>
      ) : (
        <div className={styles.detail}>
          <div>
            {t('declare_preview', { branch: preview.branch, repo: preview.repo, path: preview.path })}
            {preview.manifest && (
              <>
                {' '}
                (<code>{preview.manifest}</code>)
              </>
            )}
          </div>
          {preview.files.map((f) => (
            <div key={f.path}>
              <code>{f.path}</code>
              <pre className={styles.pre}>{f.content}</pre>
            </div>
          ))}
          <label className={styles.row}>
            <b>{t('description')}</b>
            <Input
              value={description}
              onChange={(ev) => setDescription(ev.target.value)}
              placeholder={t('description_placeholder')}
              aria-label={t('description')}
            />
          </label>
          <div className={styles.row}>
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(false)}>
              {busy ? t('opening') : t('open_pr')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(true)}>
              {t('preview_again')}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div className={styles.error} data-declare-error>
          {error}
        </div>
      )}
    </div>
  );
}
