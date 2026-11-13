/**
 * The small pieces the kit's screens share: the prototype's chip tones as kit
 * Badge variants, its "?" info popover, and its page header (a title, a status
 * line read from data, the explanation behind "?", and one primary action).
 */

import React from 'react';
import { Badge, Popover, PopoverContent, PopoverTrigger } from '@gears-frontx/ui-kit';
import styles from './ComponentsScreen.module.css';

/** Where the kit's popups portal: inside this screen's themed shadow root. */
export type Container = React.RefObject<HTMLDivElement | null>;

/** The prototype's chip tones. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'running';

const VARIANT: Record<Tone, 'success' | 'warning' | 'danger' | 'info' | 'secondary'> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'secondary',
  running: 'info',
};

/** The registry's state tones (`registry.ts`'s STATE_TONE) as chip tones. */
export function toneOf(name: string | undefined): Tone {
  return name === 'ok' || name === 'warn' || name === 'danger' || name === 'info' ? name : 'neutral';
}

/** A state as a pill; with `onClick`, a chip that filters. */
export function StatusChip({
  tone = 'neutral',
  title,
  onClick,
  pressed,
  children,
  ...rest
}: {
  tone?: Tone;
  title?: string;
  onClick?: () => void;
  pressed?: boolean;
  children: React.ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const badge = (
    <Badge variant={VARIANT[tone]} title={onClick ? undefined : title} dot={tone === 'running'} {...(onClick ? {} : rest)}>
      {children}
    </Badge>
  );
  if (!onClick) return badge;
  return (
    <button type="button" className={styles.chipButton} onClick={onClick} aria-pressed={pressed} title={title} {...rest}>
      {badge}
    </button>
  );
}

/** A "?" that opens a short explanation. */
export function InfoPopover({
  label,
  container,
  children,
}: {
  label: string;
  container: Container;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger className={styles.info} aria-label={label}>
        ?
      </PopoverTrigger>
      <PopoverContent container={container} align="start" className={styles.infoBody}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** The page's one header. */
export function PageHeader({
  title,
  status,
  info,
  infoLabel,
  actions,
  container,
}: {
  title: string;
  status?: React.ReactNode;
  info?: React.ReactNode;
  infoLabel: string;
  actions?: React.ReactNode;
  container: Container;
}) {
  return (
    <header className={styles.header} data-page-header={title}>
      <h1 className={styles.title}>{title}</h1>
      {info && (
        <InfoPopover label={infoLabel} container={container}>
          {info}
        </InfoPopover>
      )}
      {status && <div className={styles.status}>{status}</div>}
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

/** An outbound link: opens in a new tab. */
export function OutLink({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noreferrer" title={title} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}
