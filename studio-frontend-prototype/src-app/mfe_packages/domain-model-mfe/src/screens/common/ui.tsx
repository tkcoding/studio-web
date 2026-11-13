/**
 * What every part of the Project domain model tab shares: where it is mounted, the
 * gear's own words for a refusal, and the prototype's small UI pieces
 * (`ui-standard.tsx`: StatusChip, PageHeader, EmptyState, InfoPopover,
 * KpiTile) drawn with the UI kit.
 */

import React, { createContext, useContext, type ReactNode } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@gears-frontx/ui-kit';
import { errorMessage, refusalText } from '@constructor-studio/mfe-shared';
import { factKey, type FactReview } from '../../model/review-state';
import type { SpecModelFact } from '../../model/spec-model';
import styles from './common.module.css';

/** The gear's own words for a refusal, else the error's message (the prototype's `message`). */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** A fact's review key: the server's (`fact_key`, the browser's FNV-64 ported bit for bit), else the browser's. */
export const keyOf = (f: SpecModelFact): string => (f as SpecModelFact & { fact_key?: string }).fact_key || factKey(f);

/** Where the tab is mounted. */
export interface Scope {
  projectId: string;
  /** The project's workspace: where a pasted material is kept. */
  workspaceId: string | null;
  orgId: string | null;
  language: string;
  bridge: ChildMfeBridge;
  /** Where popovers and dialogs portal: inside the themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
}

export const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('useScope outside the Project domain model kit');
  return scope;
}

/** The prototype's six tones. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'running';

const VARIANT: Record<Tone, 'success' | 'warning' | 'danger' | 'info' | 'secondary'> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'secondary',
  running: 'info',
};

/** A state as a pill (the prototype's StatusChip); a button when it does something. */
export function StatusChip({
  tone = 'neutral',
  onClick,
  title,
  children,
  ...rest
}: {
  tone?: Tone;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  const badge = (
    <Badge variant={VARIANT[tone]} dot={tone === 'running'} title={onClick ? undefined : title} {...(onClick ? {} : rest)}>
      {children}
    </Badge>
  );
  if (!onClick) return badge;
  return (
    <button type="button" className={styles.chipButton} onClick={onClick} title={title} {...rest}>
      {badge}
    </button>
  );
}

/** A page's title, its explanation, a status line and its actions (the prototype's PageHeader). */
export function PageHeader({
  title,
  info,
  status,
  actions,
}: {
  title: ReactNode;
  info?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderMain}>
        <div className={styles.row}>
          <h2 className={styles.pageTitle}>{title}</h2>
          {info && <InfoPopover>{info}</InfoPopover>}
        </div>
        {status && <div className={styles.row}>{status}</div>}
      </div>
      {actions && <div className={styles.row}>{actions}</div>}
    </header>
  );
}

/** Nothing here yet, and what to do about it (the prototype's EmptyState). */
export function EmptyState({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <Empty data-empty-state>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {body && <EmptyDescription>{body}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyActions>{action}</EmptyActions>}
    </Empty>
  );
}

/** "What is this?": an explanation a click away (the prototype's InfoPopover). */
export function InfoPopover({ children, label }: { children: ReactNode; label?: string }) {
  const scope = useContext(ScopeContext);
  return (
    <Popover>
      <PopoverTrigger className={label ? styles.infoText : styles.info} aria-label={label ?? '?'}>
        {label ?? '?'}
      </PopoverTrigger>
      <PopoverContent container={scope?.container.current ?? null} align="start" className={styles.popover}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** A number with what it counts, opening what it counts (the prototype's KpiTile). */
export function KpiTile({
  label,
  value,
  sub,
  tone,
  onOpen,
  why,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  onOpen?: () => void;
  why?: string;
}) {
  const body = (
    <>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${tone ? styles[`tone_${tone}`] : ''}`}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </>
  );
  return onOpen ? (
    <button type="button" className={styles.kpi} onClick={onOpen} title={why}>
      {body}
    </button>
  ) : (
    <div className={styles.kpi} title={why}>
      {body}
    </div>
  );
}

/** A row of tabs or a segmented choice: one is on (the prototype's `.dm-tabs` and `.dm-seg`). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  role = 'tablist',
}: {
  items: { id: T; label: ReactNode; title?: string; count?: number }[];
  value: T | null;
  onChange: (id: T) => void;
  label: string;
  role?: 'tablist' | 'group';
}) {
  return (
    <div className={role === 'tablist' ? styles.tabs : styles.seg} role={role} aria-label={label}>
      {items.map((it) => (
        <Button
          key={it.id}
          type="button"
          role={role === 'tablist' ? 'tab' : undefined}
          size="sm"
          variant={value === it.id ? 'secondary' : 'ghost'}
          aria-selected={role === 'tablist' ? value === it.id : undefined}
          aria-pressed={role === 'group' ? value === it.id : undefined}
          title={it.title}
          onClick={() => onChange(it.id)}
        >
          {it.label}
          {it.count !== undefined && <span className={styles.count}>{it.count}</span>}
        </Button>
      ))}
    </div>
  );
}

/** A loading line (the prototype's `.empty`). */
export function Loading({ children }: { children: ReactNode }) {
  return <p className={styles.muted}>{children}</p>;
}

/** A failure in the gear's words (the prototype's `.error`). */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      {children}
    </p>
  );
}

/** A note under a heading (the prototype's `.hint`). */
export function Hint({ children, ...rest }: { children: ReactNode } & Record<`data-${string}`, string | number | undefined>) {
  return (
    <p className={styles.hint} {...rest}>
      {children}
    </p>
  );
}

/** The review context's type, re-exported so screens import it from one place. */
export type { FactReview };
