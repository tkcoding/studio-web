/**
 * What the parts of Organization › Infrastructure share: the screen's context
 * (translations, language, organization, the dialog container), a place's
 * mark, one deployment as a line, the rollout and logs read from the cluster,
 * a cluster's readiness and the names of the people records point at. Ported
 * from the prototype's environments-screen.tsx and user-names.ts (00828880).
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
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
import { Box, Cloud, FlaskConical } from 'lucide-react';
import { InfrastructureApiService } from '../../api/InfrastructureApiService';
import type { ContainerLog, DeployEnvironment, Deployment, DeploymentStatus, EnvironmentReadiness } from '../../api/types';
import { STATE_LABELS, readinessBadge, shortCommit, stateTone } from '../../model/environments';
import type { useInfrastructureTranslations } from '../../i18n';
import styles from './InfrastructureScreen.module.css';

export type Text = ReturnType<typeof useInfrastructureTranslations>['t'];

/** What every part of the screen reads: set once by the screen. */
export interface InfraContextValue {
  t: Text;
  language: string;
  org: { id: string; name: string };
  /** Where dialogs and sheets portal: inside this screen's themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
}

const InfraContext = createContext<InfraContextValue | null>(null);

export const InfraProvider = InfraContext.Provider;

export function useInfra(): InfraContextValue {
  const value = useContext(InfraContext);
  if (!value) throw new Error('useInfra outside the Infrastructure screen');
  return value;
}

export function useApi(): InfrastructureApiService {
  return apiRegistry.getService(InfrastructureApiService);
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

/** What a place is: a cluster or a Constructor Research project products run
 *  on, or a registry their images come from (ADR-0056 §1). */
export type PlaceKind = 'cluster' | 'research' | 'registry';

/** A place's kind as its mark: the same one on its card, on a rung of the ladder and in its panel. */
export function PlaceIcon({ kind, size = 16 }: { kind: PlaceKind; size?: number }) {
  const { t } = useInfra();
  const label = t(`kind_${kind}`);
  if (kind === 'research') return <FlaskConical size={size} aria-label={label} />;
  if (kind === 'registry') return <Box size={size} aria-label={label} />;
  return <Cloud size={size} aria-label={label} />;
}

/** A deploy state's tone as a Badge variant. */
export const STATE_BADGE: Record<ReturnType<typeof stateTone>, 'success' | 'warning' | 'danger' | 'secondary'> = {
  ok: 'success',
  warn: 'warning',
  bad: 'danger',
  idle: 'secondary',
};

/** A readiness badge's tone (environments.ts) as a Badge variant. */
const READINESS_BADGE: Record<'ok' | 'info' | 'warn' | 'danger', 'success' | 'info' | 'warning' | 'danger'> = {
  ok: 'success',
  info: 'info',
  warn: 'warning',
  danger: 'danger',
};

export function StateBadge({ d }: { d: Deployment }) {
  return (
    <Badge variant={STATE_BADGE[stateTone(d.state)]} data-deployment-state={d.state}>
      {STATE_LABELS[d.state] ?? d.state}
    </Badge>
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
  const head = who.replace(/-/g, '').slice(0, 4);
  return t('unknown_user_id', { id: head });
}

/** The names the tenants' user lists give, merged (the organization's and its
 *  workspaces'); a failed ask (the caller may not list a tenant's users) is no
 *  names, not an error. */
export function usePeople(tenantIds: readonly string[]): PeopleNames {
  const api = useApi();
  const key = [...new Set(tenantIds.filter(Boolean))].sort().join(',');
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
    void Promise.all(key.split(',').map((t) => one(t).catch(() => new Map<string, string>()))).then((lists) => {
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

/** One deployment as a row: what, where, who, when. */
export function DeploymentLine({ d, showProject, people }: { d: Deployment; showProject: boolean; people: PeopleNames }) {
  const { t, language } = useInfra();
  return (
    <div className={styles.deployment}>
      <div className={styles.line}>
        <StateBadge d={d} />
        <b>{d.product}</b>
        {/* Beside the environment, not in it (ADR-0055), and it goes on its own. */}
        {d.preview && (
          <Badge variant="outline" title={t('preview_title')}>
            {t('preview_badge', { name: d.preview.name })}
          </Badge>
        )}
        {(d.action ?? 'install') === 'uninstall' && <Badge variant="outline">{t('taken_out')}</Badge>}
        {showProject && <span className={styles.muted}>{d.project_name}</span>}
        <span className={styles.muted}>
          → {d.environment_name} · <code>{d.namespace}</code>
          {d.commit && (
            <>
              {' '}
              · <code>{shortCommit(d.commit)}</code>
            </>
          )}{' '}
          · {personLabel(d.requested_by, d.requested_by_name, people, t)} · {relTime(d.requested_at, language)}
          {d.decided_at && (
            <>
              {' '}
              ·{' '}
              {t(d.state === 'declined' ? 'declined_by' : 'approved_by', {
                who: personLabel(d.decided_by, d.decided_by_name, people, t),
              })}
            </>
          )}
        </span>
      </div>
      {d.reason && <div className={styles.muted}>“{d.reason}”</div>}
      {d.outcome && <div className={`${styles.muted} ${styles.outcome}`}>{d.outcome}</div>}
    </div>
  );
}

/** The rollout read back from the cluster, on demand, and the end of its containers' logs. */
export function StatusButton({ d, research }: { d: Deployment; research: boolean }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<ContainerLog[] | null>(null);
  const [readingLogs, setReadingLogs] = useState(false);
  const place = t(research ? 'status_place_research' : 'status_place_cluster');
  const readLogs = async () => {
    if (logs) {
      setLogs(null);
      return;
    }
    setReadingLogs(true);
    setError(null);
    try {
      setLogs((await api.deploymentLogs({ organizationId: org.id, id: d.id }).fetch({ staleTime: 0 })).containers);
    } catch (e) {
      setError(errText(e));
    } finally {
      setReadingLogs(false);
    }
  };
  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.deploymentStatus({ organizationId: org.id, id: d.id }).fetch({ staleTime: 0 }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.status}>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void read()} data-deployment-status>
          {busy ? t('status_asking', { place }) : status ? t('status_again') : t('status_in', { place })}
        </Button>
        <Button size="sm" variant="ghost" disabled={readingLogs} onClick={() => void readLogs()} data-deployment-logs>
          {readingLogs ? t('logs_reading') : logs ? t('logs_hide') : t('logs')}
        </Button>
        {error && (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        )}
      </div>
      {status && (
        <ul className={styles.workloads}>
          {status.workloads.length === 0 && <li className={styles.muted}>{t('no_workloads', { namespace: d.namespace })}</li>}
          {status.workloads.map((w) => (
            <li key={w.name}>
              <Badge variant={w.ready >= w.desired ? 'success' : 'warning'}>
                {w.ready}/{w.desired}
              </Badge>{' '}
              {w.name} <span className={styles.muted}>{w.images.join(', ')}</span>
            </li>
          ))}
          {(status.problems ?? []).map((p) => (
            <li key={p} className={styles.error} data-deployment-problem>
              {p}
            </li>
          ))}
          {status.hosts.map((h) => (
            <li key={h}>
              <a href={`https://${h}`} target="_blank" rel="noreferrer">
                {h}
              </a>
            </li>
          ))}
        </ul>
      )}
      {logs && (
        <div data-deployment-logs-view>
          {logs.length === 0 && <p className={styles.muted}>{t('no_pods', { namespace: d.namespace })}</p>}
          {logs.map((l) => (
            <details key={`${l.pod}/${l.container}/${l.previous}`} open={logs.length === 1 || l.previous}>
              <summary>
                {l.pod} · {l.container}
                {l.previous ? ` ${t('logs_previous')}` : ''}
              </summary>
              <pre className={styles.log}>{l.text.trim() === '' ? t('logs_empty') : l.text}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ask before something that cannot be undone. Stays open while it runs and
 *  when it fails, saying why; the caller closes it on success. */
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
  const { t, container } = useInfra();
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent container={container}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
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

/** Whether a cluster is ready for Studio, per environment on it: asked when
 *  a person asks, not when the page opens -- each answer is a walk of the
 *  cluster's rights -- and never again by itself. The badge's words are the
 *  model's (English). */
export function PlaceReadiness({ environments }: { environments: DeployEnvironment[] }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [answers, setAnswers] = useState<Record<string, EnvironmentReadiness | { error: string }> | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    const pairs = await Promise.all(
      environments.map(async (e) => {
        try {
          const owner = e.project_id ? { projectId: e.project_id } : { organizationId: org.id };
          return [e.id, await api.environmentReadiness({ environmentId: e.id, ...owner }).fetch({ staleTime: 0 })] as const;
        } catch (err) {
          return [e.id, { error: errText(err) }] as const;
        }
      })
    );
    setAnswers(Object.fromEntries(pairs));
    setAsking(false);
  };
  return (
    <div className={styles.chipRow} data-place-readiness>
      {answers &&
        environments.map((e) => {
          const a = answers[e.id];
          if (!a) return null;
          const prefix = environments.length > 1 ? `${e.name}: ` : '';
          if ('error' in a)
            return (
              <Badge key={e.id} variant="secondary" title={a.error} data-readiness="unknown">
                {prefix}
                {t('readiness_unknown')}
              </Badge>
            );
          const badge = readinessBadge(a);
          return (
            <Badge key={e.id} variant={READINESS_BADGE[badge.tone]} title={badge.title} data-readiness={a.level}>
              {prefix}
              {badge.label}
            </Badge>
          );
        })}
      <button type="button" className={styles.link} disabled={asking} onClick={() => void ask()} data-readiness-check>
        {asking ? t('readiness_asking') : answers ? t('readiness_again') : t('readiness_check')}
      </button>
    </div>
  );
}
