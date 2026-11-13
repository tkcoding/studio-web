/**
 * The project's glossary as a document of its repository (glossary-view.ts,
 * planGlossary): found and put in order when the documents keep one, created
 * when they do not, and proposed as docs/glossary.md in one pull request.
 * Ported from the prototype's glossary-document.tsx.
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import type { GlossaryDoc, GlossaryDocRow, SpecModelWrite } from '../../api/types';
import { planGlossary, type DocChange, type GlossaryRow, type PlannedRow } from '../../model/glossary-view';
import type { SpecModelFact } from '../../model/spec-model';
import { useGlossaryTranslations } from '../../i18n';
import { DataTable } from '../common/DataTable';
import { errText } from '../common/ui';
import common from '../common/common.module.css';
import styles from './glossary.module.css';

const CHANGE_KEY: Record<DocChange, string> = { kept: 'change_kept', filled: 'change_filled', added: 'change_added' };
const CHANGE_VARIANT: Record<DocChange, 'secondary' | 'info' | 'success'> = {
  kept: 'secondary',
  filled: 'info',
  added: 'success',
};

export function GlossaryDocument({
  rows,
  defOf,
  settled,
  load,
  propose,
}: {
  rows: GlossaryRow[];
  /** The definition a term goes by. */
  defOf: (r: GlossaryRow) => SpecModelFact | null;
  /** A term a member settled: its name or its definition. */
  settled: (r: GlossaryRow) => boolean;
  load: () => Promise<GlossaryDoc>;
  propose: (rows: GlossaryDocRow[]) => Promise<SpecModelWrite>;
}) {
  const { t } = useGlossaryTranslations();
  const [doc, setDoc] = useState<GlossaryDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SpecModelWrite | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (live) setDoc(d);
      })
      .catch((e: unknown) => {
        if (live) setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [load]);
  const plan = useMemo(
    () => (doc ? planGlossary(doc.found?.rows ?? [], rows, defOf, { settled }) : []),
    [doc, rows, defOf, settled]
  );
  if (error) return <p className={common.hint}>{t('doc_unreadable', { error })}</p>;
  if (!doc) return <p className={common.hint}>{t('doc_looking')}</p>;

  const found = doc.found;
  const n = (c: DocChange) => plan.filter((p) => p.change === c).length;
  const kept = plan.filter((p) => !left.has(p.row.term));
  const where = found ? (
    found.whole ? (
      <code>{found.path}</code>
    ) : (
      <>
        <code>{found.path}</code>, “{found.heading}”
      </>
    )
  ) : null;
  const toggleLeft = (term: string) =>
    setLeft((s) => {
      const next = new Set(s);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });

  return (
    <section className={`${common.card} ${styles.doc}`} data-glossary-doc>
      <div className={styles.docHead}>
        <div>
          <div className={styles.h}>{t('doc_title')}</div>
          {found ? (
            <p>
              {t('doc_kept_in')} {where}: {t.count('terms', found.rows.length)}.{' '}
              {!found.whole && (
                <>
                  {t('doc_moves_to')} <code>{doc.path}</code>
                  {t('doc_moves_why')}{' '}
                </>
              )}
              {t.count('doc_adds', n('added'))} {t.count('doc_fills', n('filled'))}
            </p>
          ) : (
            <p>
              {t('doc_none')} <code>{doc.path}</code> {t.count('doc_none_from', n('added'))}
            </p>
          )}
        </div>
        {!done && (
          <Button type="button" size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen((o) => !o)}>
            {open ? t('close') : found ? t('doc_put_in_order') : t('doc_create')}
          </Button>
        )}
      </div>
      {done && (
        <p className={styles.docDone}>
          {t('doc_proposed')} <code>{done.path}</code>:{' '}
          {done.pr_url ? (
            <a href={done.pr_url} target="_blank" rel="noreferrer">
              {done.pr_url}
            </a>
          ) : (
            <code>{done.branch}</code>
          )}
        </p>
      )}
      {open && !done && (
        <>
          <DataTable<PlannedRow>
            list="glossary-doc"
            urlPrefix="gd."
            rows={plan}
            rowKey={(p) => p.row.term}
            rowLabel={(p) => p.row.term}
            pageSize={15}
            empty={{ title: t('doc_no_term') }}
            filters={[
              {
                id: 'change',
                allLabel: t('every_row'),
                kind: 'chips',
                options: (['kept', 'filled', 'added'] as DocChange[]).map((c) => ({ value: c, label: t(CHANGE_KEY[c]) })),
                match: (p, v) => p.change === v,
              },
            ]}
            columns={[
              {
                id: 'term',
                header: t('col_term'),
                compare: (a, b) => a.row.term.localeCompare(b.row.term),
                cell: (p) => (
                  <span className={left.has(p.row.term) ? styles.docLeft : undefined}>
                    <b>{p.row.term}</b>
                    {p.row.source && <div className={styles.sub}>{p.row.source}</div>}
                  </span>
                ),
              },
              {
                id: 'def',
                header: t('col_definition'),
                cell: (p) => <span className={`${styles.sub} ${styles.docDef}`}>{p.row.definition || '—'}</span>,
              },
              {
                id: 'aliases',
                header: t('col_aliases'),
                cell: (p) => <span className={styles.sub}>{p.row.aliases.join(', ') || '—'}</span>,
              },
              {
                id: 'apart',
                header: t('col_not_same_as'),
                cell: (p) => <span className={styles.sub}>{p.row.not_same_as.join(', ') || '—'}</span>,
              },
              {
                id: 'change',
                header: t('col_change'),
                cell: (p) =>
                  left.has(p.row.term) ? (
                    <span className={styles.sub}>{t('left_out')}</span>
                  ) : (
                    <span>
                      <Badge variant={CHANGE_VARIANT[p.change]} data-change={p.change}>
                        {t(CHANGE_KEY[p.change])}
                      </Badge>
                      {p.filled.length > 0 && <div className={styles.sub}>{p.filled.join('; ')}</div>}
                      {p.change === 'added' && <div className={styles.sub}>{t.count('said_times', p.facts)}</div>}
                    </span>
                  ),
              },
            ]}
            actions={(p) => [
              {
                label: left.has(p.row.term) ? t('put_back') : t('leave_out'),
                onSelect: () => toggleLeft(p.row.term),
              },
            ]}
          />
          <div className={common.actions}>
            <Button
              type="button"
              size="sm"
              disabled={busy || kept.length === 0}
              onClick={() => {
                setBusy(true);
                setProposeError(null);
                propose(kept.map((p) => p.row))
                  .then(setDone)
                  .catch((e: unknown) => setProposeError(errText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t('proposing') : t.count('doc_propose', kept.length)}
            </Button>
            <span className={common.hint}>
              {found && !found.whole
                ? t('doc_writes_links', { path: doc.path, from: found.path })
                : t('doc_writes', { path: doc.path })}{' '}
              {t('doc_kept_as_written')}
            </span>
            {proposeError && <span className={common.error}>{proposeError}</span>}
          </div>
        </>
      )}
    </section>
  );
}
