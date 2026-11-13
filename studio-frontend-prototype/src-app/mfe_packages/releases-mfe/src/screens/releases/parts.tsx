/**
 * What the parts of Project › Releases share: the screen's context
 * (translations, language, the project, its organization, the dialog
 * container, the bridge), the API, how an error and a time are said, the
 * names of the people records point at, a deploy's state as a badge, and the
 * confirmation before something that cannot be undone. Ported from the
 * prototype's format.ts, user-names.ts and ui-standard.tsx (00828880).
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRegistry, type ChildMfeBridge } from '@gears-frontx/react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
} from '@gears-frontx/ui-kit';
import { errorMessage, refusalText } from '@constructor-studio/mfe-shared';
import { ReleasesApiService } from '../../api/ReleasesApiService';
import type { Deployment } from '../../api/types';
import { STATE_LABELS, stateTone } from '../../model/environments';
import type { useReleasesTranslations } from '../../i18n';
import styles from './ReleasesScreen.module.css';

export type Text = ReturnType<typeof useReleasesTranslations>['t'];

/** What every part of the screen reads: set once by the screen. */
export interface ReleasesContextValue {
  t: Text;
  language: string;
  projectId: string;
  /** The project's organization, from its targets; '' until they are read. */
  organizationId: string;
  /** Where dialogs portal: inside this screen's themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
  bridge: ChildMfeBridge | null;
}

const ReleasesContext = createContext<ReleasesContextValue | null>(null);

export const ReleasesProvider = ReleasesContext.Provider;

export function useReleases(): ReleasesContextValue {
  const value = useContext(ReleasesContext);
  if (!value) throw new Error('useReleases outside the Releases screen');
  return value;
}

export function useApi(): ReleasesApiService {
  return apiRegistry.getService(ReleasesApiService);
}

/** The gear's own words for a refusal, else the error's message. */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** "3 h ago", in the screen's language. */
export function relTime(iso: string | null | undefined, language: string): string {
  const at = Date.parse(iso ?? '');
  if (Number.isNaN(at)) return '—';
  const seconds = Math.round((at - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return rtf.format(Math.round(seconds / (30 * 86_400)), 'month');
}

/** A time as "3 h ago", with the instant itself on hover (the prototype's `When`). */
export function When({ iso }: { iso: string | null | undefined }) {
  const { language } = useReleases();
  if (!iso) return <span className={styles.muted}>—</span>;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString(language)}>
      {relTime(iso, language)}
    </time>
  );
}

/** The prototype's chip tones, as Badge variants. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'running';
export const TONE_BADGE: Record<Tone, 'success' | 'warning' | 'danger' | 'info' | 'secondary'> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'secondary',
  running: 'info',
};

/** A deploy state's tone as a Badge variant. */
export const STATE_BADGE: Record<ReturnType<typeof stateTone>, 'success' | 'warning' | 'danger' | 'secondary'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  idle: 'secondary',
};

export function StateBadge({ d }: { d: Deployment }) {
  return (
    <Badge variant={STATE_BADGE[stateTone(d.state)]} data-deployment-state={d.state}>
      {STATE_LABELS[d.state] ?? d.state}
    </Badge>
  );
}

/** A line saying something went wrong, as an alert. */
export function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className={styles.error}>
      {children}
    </div>
  );
}

/* ── Who a user id is (the prototype's user-names.ts) ── */

/** Names by user id, as the tenants' user lists gave them. */
export type PeopleNames = ReadonlyMap<string, string>;

const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A user's name as people read it: the name the record carries, else the
 *  one the tenants' lists give, else a short label -- never the whole UUID.
 *  A value that is not an id (a login, an e-mail) is shown as it is. */
export function personLabel(
  id: string | null | undefined,
  name: string | null | undefined,
  known: PeopleNames,
  t: Text
): string {
  if (name?.trim()) return name.trim();
  const who = id?.trim() ?? '';
  if (!who) return t('unknown_user');
  const found = known.get(who.toLowerCase());
  if (found) return found;
  if (!ID.test(who)) return who;
  return t('unknown_user_id', { id: who.replace(/-/g, '').slice(0, 4) });
}

/** The names the tenants' user lists give, merged (the organization's and
 *  the project's); a failed ask is no names, not an error. */
export function usePeople(tenantIds: readonly (string | null | undefined)[]): PeopleNames {
  const api = useApi();
  const key = [...new Set(tenantIds.filter((x): x is string => !!x))].sort().join(',');
  const [names, setNames] = useState<PeopleNames>(new Map());
  useEffect(() => {
    if (!key) return;
    let live = true;
    const one = async (tenantId: string) => {
      const out = new Map<string, string>();
      let cursor: string | undefined;
      for (let page = 0; page < 50; page++) {
        const p = await api.tenantUsers({ tenantId, cursor }).fetch({ staleTime: 60_000 });
        for (const u of p.items ?? []) {
          const n = u.display_name?.trim() || u.username?.trim() || u.email?.trim();
          if (n) out.set(u.id.toLowerCase(), n);
        }
        cursor = p.page_info?.next_cursor ?? undefined;
        if (!cursor) break;
      }
      return out;
    };
    void Promise.all(key.split(',').map((id) => one(id).catch(() => new Map<string, string>()))).then((lists) => {
      if (!live) return;
      const merged = new Map<string, string>();
      for (const l of lists) for (const [id, n] of l) merged.set(id, n);
      setNames(merged);
    });
    return () => {
      live = false;
    };
  }, [api, key]);
  return names;
}

/** Ask before something that cannot be undone (the prototype's
 *  `window.confirm`). Stays open while it runs and when it fails, saying
 *  why; the caller closes it on success. */
export function Confirm({
  title,
  body,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, container } = useReleases();
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent container={container}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <ErrorLine>{error}</ErrorLine>}
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm} data-confirm>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
