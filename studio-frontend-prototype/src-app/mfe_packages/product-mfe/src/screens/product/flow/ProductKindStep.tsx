/**
 * The Product page's first step: what the product is (the prototype's
 * `product-kind-view.tsx`). The proposal -- the kind the project's specs, its
 * own components and the product record point to, with the reasons read --
 * and the kept choice are the server's (`GET`/`PUT /studio-product/v1/product-kind`);
 * the prototype read the proposal in the browser. A member confirms it or
 * picks another. Marked experimental: the server's rules are word matches and
 * counts. The kinds, their descriptions and the reasons are the server's
 * English sentences.
 */

import { useEffect, useState } from 'react';
import { Button } from '@gears-frontx/ui-kit';
import { productApi } from '../../../api/client';
import type { ProductKindAnswer } from '../../../api/types';
import { kindTitle, type ProductKind } from '../../../model/product-kind';
import { useFlowTranslations } from '../../../i18n';
import { errText, StatusChip, useScope } from '../../common';
import common from '../../product.module.css';
import styles from './flow.module.css';

export function ProductKindStep() {
  const { projectId } = useScope();
  const { t } = useFlowTranslations();
  const [read, setRead] = useState<ProductKindAnswer | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ProductKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    productApi
      .productKind(projectId)
      .then((answer) => {
        if (!live) return;
        setRead(answer);
        // Open on a project that has not decided: it is the first step.
        setOpen(!answer.choice);
      })
      .catch((e) => live && setReadErr(errText(e)));
    return () => {
      live = false;
    };
  }, [projectId]);

  if (readErr) return <div className={common.error}>{t('kind_read_failed', { error: readErr })}</div>;
  if (!read) return null;
  const choice = read.choice ?? null;
  const proposal = { kind: read.proposed, reasons: read.reasons, alternatives: read.alternatives };
  const title = (id: ProductKind) => kindTitle(read.kinds, id);
  const chosen = picked ?? choice?.kind ?? proposal.kind;

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRead(await productApi.confirmProductKind(projectId, chosen));
      setPicked(null);
      setOpen(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={common.card} data-product-kind={choice?.kind ?? 'undecided'}>
      <div className={common.row}>
        <span className={styles.strong}>{t('kind_title')}</span>
        <StatusChip tone="warn" title={t('experimental_title')}>
          {t('experimental')}
        </StatusChip>
        {choice ? (
          <StatusChip tone="ok" data-product-kind-confirmed="">
            {title(choice.kind)}
          </StatusChip>
        ) : (
          <StatusChip tone="info" data-product-kind-proposed={proposal.kind}>
            {t('proposed', { kind: title(proposal.kind) })}
          </StatusChip>
        )}
        <span className={`${common.muted} ${common.small} ${common.grow}`}>{read.status}</span>
        <Button
          type="button"
          size="sm"
          variant={choice ? 'ghost' : 'default'}
          onClick={() => setOpen((o) => !o)}
          data-product-kind-open
        >
          {open ? t('close') : choice ? t('change') : t('decide')}
        </Button>
      </div>
      {open && (
        <div className={common.stack}>
          <div>
            <div className={`${styles.strong} ${common.small}`}>{t('why', { kind: title(proposal.kind) })}</div>
            <ul className={styles.reasons} data-product-kind-reasons>
              {proposal.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div role="radiogroup" aria-label={t('kind_title')} className={common.stack}>
            {[proposal.kind, ...proposal.alternatives].map((id) => {
              const k = read.kinds.find((x) => x.id === id) ?? { id, title: id, what: '', builds: '' };
              return (
                <label key={k.id} className={`${styles.kindOption} ${chosen === k.id ? styles.kindChosen : ''}`}>
                  <input
                    type="radio"
                    name={`pkind-${projectId}`}
                    checked={chosen === k.id}
                    onChange={() => setPicked(k.id)}
                    data-product-kind-option={k.id}
                  />
                  <span>
                    <div className={styles.strong}>
                      {k.title}
                      {k.id === proposal.kind && <span className={common.muted}> · {t('proposed_mark')}</span>}
                    </div>
                    <div className={common.small}>{k.what}</div>
                    <div className={`${common.muted} ${common.small}`}>{k.builds}</div>
                  </span>
                </label>
              );
            })}
          </div>
          {err && <div className={common.error}>{err}</div>}
          <div className={common.row}>
            <Button
              type="button"
              size="sm"
              disabled={busy || (!!choice && chosen === choice.kind)}
              onClick={() => void confirm()}
              data-product-kind-confirm
            >
              {busy
                ? t('saving')
                : chosen === proposal.kind
                  ? t('confirm', { kind: title(chosen) })
                  : t('use', { kind: title(chosen) })}
            </Button>
            <span className={`${common.muted} ${common.small}`}>{t('kept_note')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
