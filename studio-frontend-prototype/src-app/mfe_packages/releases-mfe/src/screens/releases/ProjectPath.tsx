/**
 * The project's path to running (#1050), on top of Releases (kit
 * `product-releases`): Specs → Product → Build → Image → Environment →
 * Running, each with its state, why in plain words, what is missing as a
 * checklist, and one action. The server decides Product to Running
 * (`GET /project-path`); Specs is the size of the spec mapping's plan. A
 * failed step shows its cause and the actions that fix it (#1054). Product,
 * Builds and the rest of Releases stay for the detail.
 */

import { useState } from 'react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import type { FailureCause, PathAction, PathCheck, PathStep, PathStepState } from '../../api/types';
import { intentOf, type Intent } from '../../model/path';
import { useReleases } from './parts';
import styles from './ReleasesScreen.module.css';

const STATE_BADGE: Record<PathStepState, 'success' | 'info' | 'danger' | 'warning' | 'secondary'> = {
  done: 'success',
  active: 'info',
  failed: 'danger',
  blocked: 'warning',
  next: 'info',
  later: 'secondary',
};

/** Whether the dictionary had `key`: a missing one comes back as the key. */
const translated = (value: string, key: string) => value !== key && !value.endsWith(`:${key}`);

/** A button for an action, labelled in the screen's language by its kind;
 *  the server's label when the dictionary has none. */
export function ActionButton({
  action,
  deploymentId,
  onIntent,
  variant = 'default',
}: {
  action: Pick<PathAction, 'kind' | 'label'> & Partial<PathAction>;
  deploymentId?: string | null;
  onIntent: (intent: Intent, action: Partial<PathAction>) => void;
  variant?: 'default' | 'outline' | 'ghost';
}) {
  const { t } = useReleases();
  const intent = intentOf(action, deploymentId);
  if (intent.kind === 'none') return null;
  const key = `action_${action.kind}`;
  const label = t(key);
  return (
    <Button size="sm" variant={variant} onClick={() => onIntent(intent, action)} data-path-action={action.kind}>
      {translated(label, key) ? label : action.label}
    </Button>
  );
}

/** Why a build or a deploy failed, and the actions that fix it (#1054). */
export function CauseView({
  cause,
  deploymentId,
  onIntent,
}: {
  cause: FailureCause;
  deploymentId?: string | null;
  onIntent: (intent: Intent, action: Partial<PathAction>) => void;
}) {
  const { t } = useReleases();
  const key = `cause_${cause.code}`;
  const summary = t(key, { gear: cause.gear ?? '', key: cause.key ?? '' });
  return (
    <div className={styles.cause} data-failure-cause={cause.code}>
      <b>{translated(summary, key) ? summary : cause.summary}</b>
      {cause.lines.length > 0 && (
        <pre className={`${styles.log} ${styles.pre}`} aria-label={t('cause_lines')}>
          {cause.lines.join('\n')}
        </pre>
      )}
      <div className={styles.row}>
        {cause.actions.map((a, i) => (
          <ActionButton
            key={`${a.kind}-${i}`}
            action={a}
            deploymentId={deploymentId}
            onIntent={onIntent}
            variant={i === 0 ? 'default' : 'outline'}
          />
        ))}
      </div>
    </div>
  );
}

function Checklist({ items, onIntent }: { items: PathCheck[]; onIntent: (intent: Intent, a: Partial<PathAction>) => void }) {
  const { t } = useReleases();
  return (
    <ul className={styles.checklist} aria-label={t('path_checklist')} data-path-checklist>
      {items.map((c, i) => (
        <li key={`${c.code}-${i}`} data-check={c.code} data-check-done={c.done || undefined}>
          <Badge variant={c.done ? 'success' : 'warning'}>{c.done ? t('check_done') : t('check_missing')}</Badge>
          <span>{c.text}</span>
          {!c.done && c.action && <ActionButton action={c.action} onIntent={onIntent} variant="outline" />}
        </li>
      ))}
    </ul>
  );
}

/** What the Specs step says: it is read here, not by the server. */
function specsReason(t: ReturnType<typeof useReleases>['t'], step: PathStep, count: number | null): string {
  if (step.state === 'later') return t('path_specs_unknown');
  return count && count > 0 ? t.count('path_specs_some', count) : t('path_specs_none');
}

export function ProjectPathView({
  steps,
  current,
  specsCount,
  onIntent,
}: {
  steps: PathStep[];
  current: string;
  specsCount: number | null;
  onIntent: (intent: Intent, action: Partial<PathAction>) => void;
}) {
  const { t } = useReleases();
  const [picked, setPicked] = useState<string | null>(null);
  const open = steps.find((s) => s.id === (picked ?? current)) ?? steps[0];
  const reason = (s: PathStep) => (s.id === 'specs' ? specsReason(t, s, specsCount) : s.reason);
  return (
    <section className={styles.card} data-project-path data-path-current={current}>
      <h2 className={styles.cardTitle}>{t('path_title')}</h2>
      <ol className={styles.path}>
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`${styles.pathStep} ${styles[`pathStep_${s.state}`] ?? ''}`}
              aria-pressed={s.id === open?.id}
              aria-current={s.id === current ? 'step' : undefined}
              onClick={() => setPicked(s.id)}
              data-path-step={s.id}
              data-path-state={s.state}
            >
              <b>{t(`path_step_${s.id}`)}</b>
              <Badge variant={STATE_BADGE[s.state]}>{t(`path_state_${s.state}`)}</Badge>
            </button>
          </li>
        ))}
      </ol>
      {open && (
        <div className={styles.stack} data-path-open={open.id}>
          <p data-path-reason>{reason(open)}</p>
          {open.checklist.length > 0 && <Checklist items={open.checklist} onIntent={onIntent} />}
          {open.cause && <CauseView cause={open.cause} deploymentId={open.deployment_id} onIntent={onIntent} />}
          {!open.cause && open.action && (
            <div className={styles.row}>
              <ActionButton action={open.action} deploymentId={open.deployment_id} onIntent={onIntent} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
