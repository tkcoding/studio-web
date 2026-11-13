/**
 * What every screen of the Product kit shares: where it is mounted (the
 * project, its workspace and organization, the bridge), the gear's own words
 * for a refusal, and the prototype's small UI pieces (`ui-standard.tsx`:
 * StatusChip, PageHeader, EmptyState) drawn with the UI kit.
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
} from '@gears-frontx/ui-kit';
import { errorMessage, openScreen, refusalText } from '@constructor-studio/mfe-shared';
import styles from './product.module.css';

/** The gear's own words for a refusal, else the error's message (the prototype's `errText`). */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** Where a screen is mounted. */
export interface Scope {
  projectId: string;
  workspaceId: string | null;
  /** The organization on screen; null when the shell has not said. */
  orgId: string | null;
  /** The screen's language, for dates. */
  language: string;
  bridge: ChildMfeBridge;
  /** Where dialogs portal: inside the themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
}

export const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('useScope outside the Product kit');
  return scope;
}

/**
 * The portal's project tabs a Product screen opens (the prototype's
 * `onOpenTab`). Releases is not ported yet: `/releases` is the route its kit
 * (`product-releases`) is to take, and opens nothing until it does.
 */
export const PROJECT_ROUTES = {
  releases: '/releases',
  product: '/product',
  components: '/project-components',
  specs: '/projects/specs',
  sources: '/projects/sources',
  tests: '/tests',
} as const;

/** Open another tab of the project. */
export function openTab(bridge: ChildMfeBridge, tab: keyof typeof PROJECT_ROUTES): void {
  openScreen(bridge, PROJECT_ROUTES[tab]);
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
} & Record<`data-${string}`, string | undefined>) {
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
        <h2 className={styles.pageTitle}>{title}</h2>
        {status && <div className={styles.row}>{status}</div>}
        {info && <div className={styles.info}>{info}</div>}
      </div>
      {actions && <div className={styles.row}>{actions}</div>}
    </header>
  );
}

/** Nothing here yet, and what to do about it (the prototype's EmptyState). */
export function EmptyState({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {body && <EmptyDescription>{body}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyActions>{action}</EmptyActions>}
    </Empty>
  );
}

/** A row of tabs: one is on (the prototype's `.doc-views`). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  dataAttr,
}: {
  items: { id: T; label: ReactNode; title?: string; state?: string; dot?: Tone }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** The data attribute each tab carries its id in, for tests and probes. */
  dataAttr?: string;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((it) => (
        <Button
          key={it.id}
          type="button"
          role="tab"
          size="sm"
          variant={value === it.id ? 'secondary' : 'ghost'}
          aria-selected={value === it.id}
          title={it.title}
          onClick={() => onChange(it.id)}
          {...(dataAttr ? { [dataAttr]: it.id } : {})}
          data-flow-state={it.state}
        >
          {it.dot && <span className={`${styles.dot} ${styles[`dot_${it.dot}`]}`} aria-hidden />}
          {it.label}
        </Button>
      ))}
    </div>
  );
}
