/**
 * A starter gear for a capability nobody has built (the prototype's
 * `ScaffoldModal` in documents.tsx, as Project › Components opens it). The
 * skeleton is generated server-side: the dialog asks for it with `dry_run` to
 * show it and say which repository it would go to, then asks again to write
 * it. The name, what it is for and its subsystem can be changed before the
 * push: a draft from the project domain model is a proposal, not a decision.
 */

import { useEffect, useState, type RefObject } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@gears-frontx/ui-kit';
import { productApi } from '../../api/client';
import type { ScaffoldFile } from '../../api/types';
import { subsystemOf } from '../../model/product-configurator';
import { gearSlug } from '../../model/scaffold';
import { useComponentsTranslations } from '../../i18n';
import { errText } from '../common';
import { scaffoldTargetLine } from './registryLines';
import styles from './ProjectComponentsInventory.module.css';

export function ScaffoldDialog({
  capability,
  projectId,
  problem: givenProblem,
  declares,
  lead,
  category: givenCategory,
  categories,
  container,
  onClose,
}: {
  capability: string;
  /** The project the gear is for: its route picks the repository. */
  projectId: string;
  /** What the specs ask of the gear. */
  problem?: string;
  /** Capability keys written into its manifest, so it declares them. */
  declares?: string[];
  /** A line above the form saying what the gear is drafted from. */
  lead?: string;
  /** The subsystem proposed for it; blank is the server's `platform`. */
  category?: string;
  categories?: string[];
  container: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const { t } = useComponentsTranslations();
  // What is typed, and what the preview was last asked with: the preview
  // asks the server, so it follows a field when the field is left.
  const [typedName, setTypedName] = useState(capability);
  const [typedProblem, setTypedProblem] = useState(givenProblem ?? '');
  const [asked, setAsked] = useState({ name: capability, problem: givenProblem });
  const capabilityName = asked.name.trim() || capability;
  const problem = asked.problem;
  const commit = () => setAsked({ name: typedName, problem: typedProblem.trim() || undefined });
  const [category, setCategory] = useState(givenCategory ?? '');
  const [active, setActive] = useState(0);
  const [openPr, setOpenPr] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ branch: string; pr_url?: string | null } | null>(null);
  const [files, setFiles] = useState<ScaffoldFile[] | null>(null);
  const [where, setWhere] = useState<{ target?: string | null; repo?: string | null } | null>(null);
  const slug = gearSlug(capabilityName);
  const declared = (declares ?? []).join(',');

  // The preview is the server's own answer, asked for with nothing written.
  useEffect(() => {
    let alive = true;
    productApi
      .scaffoldGearToRepo(projectId, {
        slug: capabilityName,
        problem,
        capabilities: declared ? declared.split(',') : undefined,
        category: category || undefined,
        dry_run: true,
      })
      .then((r) => {
        if (!alive) return;
        setPushErr(null);
        setFiles(r.files);
        setWhere({ target: r.target, repo: r.repo });
      })
      .catch((e) => {
        if (alive) setPushErr(errText(e));
      });
    return () => {
      alive = false;
    };
  }, [projectId, capabilityName, problem, category, declared]);

  const file = files?.[active];
  const push = async () => {
    setPushing(true);
    setPushErr(null);
    commit();
    try {
      const r = await productApi.scaffoldGearToRepo(projectId, {
        slug: typedName.trim() || capability,
        problem: typedProblem.trim() || undefined,
        capabilities: declares,
        category: category || undefined,
        open_pr: openPr,
      });
      setResult({ branch: r.branch, pr_url: r.pr_url });
      if (r.repo) setWhere({ target: r.target, repo: r.repo });
    } catch (e) {
      setPushErr(errText(e));
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !pushing && onClose()}>
      <DialogContent container={container} closeLabel={t('close')} className={styles.wide} data-scaffold>
        <DialogHeader>
          <DialogTitle>
            {t('scaffold_title')} <code>cf-gears-{slug}</code>
          </DialogTitle>
          {lead && <DialogDescription>{lead}</DialogDescription>}
        </DialogHeader>
        {!result && (
          <div className={styles.form} data-scaffold-draft>
            <label htmlFor="scaffold-name">{t('scaffold_name')}</label>
            <Input
              id="scaffold-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
            <label htmlFor="scaffold-problem">{t('scaffold_for')}</label>
            <Textarea
              id="scaffold-problem"
              rows={3}
              value={typedProblem}
              onChange={(e) => setTypedProblem(e.target.value)}
              onBlur={commit}
            />
            {categories && categories.length > 0 && (
              <>
                <label htmlFor="scaffold-category">{t('scaffold_subsystem')}</label>
                <NativeSelect id="scaffold-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <NativeSelectOption value="">{t('scaffold_platform')}</NativeSelectOption>
                  {categories.map((c) => (
                    <NativeSelectOption key={c} value={c}>
                      {subsystemOf({ category: c })}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </>
            )}
          </div>
        )}
        <p className={styles.muted}>{t('scaffold_about', { name: capabilityName, slug })}</p>
        <p data-scaffold-target>
          <b>{t('scaffold_where')}</b> {where ? scaffoldTargetLine(where.target, where.repo) : t('asking')}
        </p>
        <div className={styles.row}>
          {result ? (
            <span data-scaffold-pushed>
              {t('scaffold_pushed', { branch: result.branch })}
              {result.pr_url && (
                <>
                  {' · '}
                  <a href={result.pr_url} target="_blank" rel="noreferrer">
                    {t('scaffold_open_pr')}
                  </a>
                </>
              )}
            </span>
          ) : (
            <>
              <Button type="button" onClick={() => void push()} disabled={pushing}>
                {pushing ? t('pushing') : t('push')}
              </Button>
              <label className={styles.row}>
                <Checkbox checked={openPr} onCheckedChange={(v) => setOpenPr(v === true)} />
                {t('scaffold_with_pr')}
              </label>
              {where && !where.repo && <span className={styles.muted}>{t('scaffold_needs_repo')}</span>}
            </>
          )}
          {pushErr && <span className={styles.error}>{pushErr}</span>}
        </div>
        <div className={styles.files}>
          <div className={styles.fileList}>
            {(files ?? []).map((f, i) => (
              <Button
                key={f.path}
                type="button"
                size="sm"
                variant={i === active ? 'secondary' : 'ghost'}
                onClick={() => setActive(i)}
                className={styles.fileButton}
              >
                {f.path.replace(new RegExp(`^.*/${slug}/`), '')}
              </Button>
            ))}
          </div>
          <div className={styles.detail}>
            <div className={styles.row}>
              <code className={styles.muted}>{file?.path ?? (files ? '—' : t('asking'))}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!file}
                onClick={() => file && navigator.clipboard?.writeText(file.content).catch(() => undefined)}
              >
                {t('copy')}
              </Button>
            </div>
            <pre className={styles.pre}>{file?.content ?? ''}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
