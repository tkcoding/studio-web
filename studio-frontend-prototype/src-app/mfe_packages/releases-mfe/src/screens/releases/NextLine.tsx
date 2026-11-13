/**
 * The one line a part of the product's way out opens on (the prototype's
 * pipeline-line.tsx at 00828880): where the project stands and what comes
 * next. The prototype's button to another tab is left out: the hints
 * Releases draws only ever point at Releases itself. The sentence is the
 * model's (pipeline.ts), English.
 */

import type { PipelineHint } from '../../model/pipeline';
import { useReleases } from './parts';
import styles from './ReleasesScreen.module.css';

export function NextLine({ hint }: { hint: PipelineHint }) {
  const { t } = useReleases();
  return (
    <div className={`${styles.next} ${styles[`next_${hint.tone}`]}`} role="status" data-next-step={hint.tone}>
      <b>{t('next')}</b>
      <span>{hint.text}</span>
    </div>
  );
}
