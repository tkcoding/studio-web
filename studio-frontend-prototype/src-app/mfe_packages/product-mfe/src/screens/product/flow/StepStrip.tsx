/**
 * Steps in the order they are done, as compact chips in a row; one opens
 * below (the prototype's `StepFlow` with `look="strip"`, ui-standard.tsx).
 * A step with `onSelect` goes elsewhere rather than opening.
 */

import type { ReactNode } from 'react';
import styles from './flow.module.css';

export type StepState = 'done' | 'warn' | 'failed' | 'current' | 'todo' | 'later';

export interface StripStep {
  id: string;
  title: string;
  state: StepState;
  status?: ReactNode;
  body?: ReactNode;
  onSelect?: () => void;
}

const TONE: Record<StepState, string> = {
  done: styles.ok,
  warn: styles.warn,
  failed: styles.bad,
  current: styles.current,
  todo: '',
  later: '',
};
const MARK: Record<StepState, string> = { done: '✓', warn: '!', failed: '✗', current: '•', todo: '', later: '' };

export function StepStrip({
  steps,
  label,
  open,
  onOpen,
}: {
  steps: StripStep[];
  /** The flow's accessible name. */
  label: string;
  /** The step opened below (controlled). */
  open: string | null;
  onOpen: (id: string | null) => void;
}) {
  const shown = steps.find((s) => s.id === open && s.body);
  return (
    <div className={styles.strip} role="group" aria-label={label} data-step-flow="strip">
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`${styles.step} ${TONE[s.state]} ${open === s.id ? styles.on : ''}`}
              aria-expanded={s.body ? open === s.id : undefined}
              onClick={() => (s.onSelect ? s.onSelect() : onOpen(open === s.id ? null : s.id))}
              title={typeof s.status === 'string' ? s.status : undefined}
              data-step={s.id}
              data-step-state={s.state}
            >
              <span className={styles.mark} aria-hidden>
                {MARK[s.state]}
              </span>
              <span className={styles.n}>{i + 1}</span>
              {s.title}
              {s.onSelect && <span aria-hidden> →</span>}
            </button>
          </li>
        ))}
      </ol>
      {shown && (
        <div className={styles.detail} data-step-detail={shown.id}>
          {shown.status && <div className={styles.status}>{shown.status}</div>}
          {shown.body}
        </div>
      )}
    </div>
  );
}
