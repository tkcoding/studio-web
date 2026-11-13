/**
 * The small pieces the Reports screen's parts share: the text function's
 * type, the prototype's chip tones as kit Badge variants, its "?" info
 * popover, its KPI tile, and the error words a refusal reads as.
 */

import React from 'react';
import { Badge, Popover, PopoverContent, PopoverTrigger } from '@gears-frontx/ui-kit';
import { errorMessage, refusalText } from '@constructor-studio/mfe-shared';
import type { useReportsTranslations } from '../../i18n';
import styles from './ReportsScreen.module.css';

export type Text = ReturnType<typeof useReportsTranslations>['t'];

/** Where the kit's popups portal: inside this screen's themed shadow root. */
export type Container = React.RefObject<HTMLDivElement | null>;

/** The prototype's chip tones. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const VARIANT: Record<Tone, 'success' | 'warning' | 'danger' | 'info' | 'secondary'> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'secondary',
};

/** A state as a pill. */
export function StatusChip({
  tone = 'neutral',
  title,
  children,
  ...rest
}: { tone?: Tone; title?: string; children: React.ReactNode } & Record<`data-${string}`, string | boolean>) {
  return (
    <Badge variant={VARIANT[tone]} title={title} {...rest}>
      {children}
    </Badge>
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

/** One number with its label. */
export function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'warn';
}) {
  return (
    <div className={`${styles.kpi} ${tone === 'warn' ? styles.kpiWarn : ''}`} data-kpi={label}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

/** The gear's own words for a refusal, else the error's message. */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** `2026-11-09T10:42:00Z` → `2026-11-09 10:42`. */
export const minute = (at: string): string => at.slice(0, 16).replace('T', ' ');
