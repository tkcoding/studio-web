/**
 * Platform › Publication requests (ADR-0042 §4), the prototype's
 * `publication-requests.tsx`: every organization's requests to give a gear
 * to the platform, answered by a platform curator — a platform administrator
 * or one of the platform's gear curators. Publishing opens the pull request
 * into the platform's gear repository; preview it first. Declining says why.
 * The curators are on the same page: a curator reads the list, and only a
 * platform administrator changes it.
 */

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
} from '@gears-frontx/ui-kit';
import type { GearCurator, OrgMember, PublicationRequest, RegistryPublishPreview } from '../../api/types';
import { publishPreviewLines } from '../../model/registry';
import { api, errText, statusOf, useScope, type Text } from './common';
import { InfoPopover, PageHeader, StatusChip } from './parts';
import styles from './ComponentsScreen.module.css';

/** One request's key in the page's state. */
const keyOf = (r: PublicationRequest) => `${r.organization_id}/${r.name}`;

/** Who asked, in words: the name the server sent, else a short id. */
export function askedBy(r: Pick<PublicationRequest, 'requested_by' | 'requested_by_name'>): string {
  if (r.requested_by_name?.trim()) return r.requested_by_name.trim();
  const id = r.requested_by?.trim() ?? '';
  if (!id) return 'unknown user';
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id) ? `user ${id.slice(0, 8)}` : id;
}

/** "3 hours ago", in the screen's language. */
function relTime(iso: string, now: number, language: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const seconds = Math.round((at - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return rtf.format(Math.round(seconds / (30 * 86_400)), 'month');
}

export function PublicationRequests() {
  const { org, t, container, language } = useScope();
  const orgId = org?.id ?? null;
  const [items, setItems] = useState<PublicationRequest[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, RegistryPublishPreview>>({});
  // The platform gear repository each request goes into, by source id, as the curator picked it.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** When the list was read: what "ago" counts from. */
  const [readAt, setReadAt] = useState(0);

  useEffect(() => {
    let live = true;
    api()
      .publicationRequests({ org: orgId })
      .fetch({ staleTime: 0 })
      .then((r) => {
        if (!live) return;
        setReadAt(Date.now());
        setItems(r.items);
        setRefused(false);
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (statusOf(e) === 403) setRefused(true);
        else setError(errText(e));
        setItems([]);
      });
    return () => {
      live = false;
    };
  }, [orgId, tick]);

  const answer = async (r: PublicationRequest, action: 'publish' | 'decline_publication', dryRun = false) => {
    const key = keyOf(r);
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const target = action === 'publish' ? targets[key] : undefined;
      const after = await api()
        .answerPublication(r.organization_id, r.name)
        .fetch({
          action,
          ...(dryRun ? { dry_run: true } : {}),
          ...(target ? { target } : {}),
          ...(action === 'decline_publication' ? { reason: reason.trim() } : {}),
          ...(r.version ? { version: r.version } : {}),
        });
      if (dryRun) {
        const preview = after.publish_preview;
        if (preview) {
          setPreviews((p) => ({ ...p, [key]: preview }));
          if (preview.source_id) setTargets((x) => ({ ...x, [key]: preview.source_id as string }));
        } else setError(t('cannot_preview'));
        return;
      }
      setDone(
        action === 'publish'
          ? t('published_done', { name: r.name, pr: after.contribution?.pr_url ?? t('pr_opened') })
          : t('declined_done', { name: r.name })
      );
      setDeclining(null);
      setReason('');
      setTick((n) => n + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.stack} data-publication-requests>
      <PageHeader
        title={t('publications_title')}
        info={<p>{t('publications_info')}</p>}
        infoLabel={t('about', { title: t('publications_title') })}
        container={container}
        status={
          refused ? (
            <StatusChip tone="warn">{t('no_access')}</StatusChip>
          ) : items !== null ? (
            <StatusChip tone={items.length > 0 ? 'warn' : 'ok'} data-publication-count>
              {items.length > 0 ? t('n_open', { count: items.length }) : t('none_open')}
            </StatusChip>
          ) : null
        }
      />
      {refused ? (
        <Empty data-publication-refused>
          <EmptyHeader>
            <EmptyTitle>{t('publications_refused')}</EmptyTitle>
            <EmptyDescription>{t('publications_refused_body')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {error && <p className={styles.error}>{error}</p>}
          {done && <p className={styles.hint}>{done}</p>}
          {items === null ? (
            <Skeleton className={styles.skeleton} />
          ) : items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('no_open_requests')}</EmptyTitle>
                <EmptyDescription>{t('no_open_requests_body')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className={styles.cardList}>
              {items.map((r) => {
                const key = keyOf(r);
                const preview = previews[key];
                return (
                  <li key={key}>
                    <Card data-publication-request={key}>
                      <CardContent className={styles.stack}>
                        <div className={styles.row}>
                          <b>{r.name}</b>
                          {r.version && <StatusChip tone="neutral">v{r.version.replace(/^v/, '')}</StatusChip>}
                          <span className={styles.sub}>
                            {t('asked_line', {
                              org: r.organization_name ?? r.organization_id,
                              who: askedBy(r),
                              when: relTime(r.at, readAt, language),
                            })}
                          </span>
                        </div>
                        {r.reason && <div>“{r.reason}”</div>}
                        {preview && (
                          <div className={styles.hint} data-publication-preview>
                            {publishPreviewLines(preview).map((line) => (
                              <div key={line}>{line}</div>
                            ))}
                          </div>
                        )}
                        {preview && (preview.targets?.length ?? 0) > 1 && (
                          <label className={styles.formRow} data-publication-target>
                            {t('into')}
                            <NativeSelect
                              value={targets[key] ?? preview.source_id ?? ''}
                              onChange={(e) => {
                                const value = e.target.value;
                                setTargets((x) => ({ ...x, [key]: value }));
                                // Another repository is another pull request: preview it again.
                                setPreviews((p) => {
                                  const next = { ...p };
                                  delete next[key];
                                  return next;
                                });
                              }}
                            >
                              {(preview.targets ?? []).map((x) => (
                                <NativeSelectOption key={x.source_id} value={x.source_id}>
                                  {t('target_option', { id: x.source_id, repo: x.repo, count: x.gears_in_category })}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </label>
                        )}
                        <div className={styles.row}>
                          <Button variant="outline" size="sm" disabled={busy === key} onClick={() => void answer(r, 'publish', true)}>
                            {preview ? t('preview_again') : t('preview')}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy === key || !preview}
                            title={preview ? t('publish_title') : t('preview_first')}
                            onClick={() => void answer(r, 'publish')}
                            data-publication-publish
                          >
                            {t('publish')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy === key}
                            onClick={() => setDeclining(declining === key ? null : key)}
                          >
                            {t('decline_ellipsis')}
                          </Button>
                        </div>
                        {declining === key && (
                          <div className={styles.row}>
                            <Input
                              className={styles.grow}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder={t('decline_reason_placeholder')}
                              aria-label={t('reason')}
                            />
                            <Button
                              size="sm"
                              disabled={busy === key || !reason.trim()}
                              onClick={() => void answer(r, 'decline_publication')}
                              data-publication-decline
                            >
                              {t('decline')}
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
          <Curators orgId={orgId} t={t} />
        </>
      )}
    </section>
  );
}

function Curators({ orgId, t }: { orgId: string | null; t: Text }) {
  const { container } = useScope();
  const [items, setItems] = useState<GearCurator[] | null>(null);
  const [mayManage, setMayManage] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api()
      .curators({ org: orgId })
      .fetch({ staleTime: 0 })
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setMayManage(r.may_manage);
      })
      .catch((e: unknown) => {
        if (live) setError(errText(e));
      });
    // The organization in context: its members are offered as curators.
    if (orgId)
      api()
        .members(orgId)
        .then((m) => {
          if (live) setMembers(m);
        })
        .catch(() => {
          if (live) setMembers([]);
        });
    return () => {
      live = false;
    };
  }, [orgId]);

  const save = async (next: GearCurator[]) => {
    setError(null);
    try {
      const r = await api().saveCurators(orgId).fetch({ items: next });
      setItems(r.items);
    } catch (e) {
      setError(errText(e));
    }
  };

  const candidates = members.filter((m) => !(items ?? []).some((c) => c.id === m.user_id));
  return (
    <Card data-gear-curators>
      <CardHeader>
        <CardTitle className={styles.row}>
          {t('curators_title')}
          <InfoPopover label={t('curators_about')} container={container}>
            <p>{t('curators_info')}</p>
          </InfoPopover>
        </CardTitle>
      </CardHeader>
      <CardContent className={styles.stack}>
        {error && <p className={styles.error}>{error}</p>}
        {items === null ? (
          error ? null : <Skeleton className={styles.skeletonSmall} />
        ) : items.length === 0 ? (
          <div>
            <b>{t('no_curators')}</b> <span className={styles.sub}>{t('no_curators_body')}</span>
          </div>
        ) : (
          <ul className={styles.plainList}>
            {items.map((c) => (
              <li key={c.id} className={styles.row}>
                {c.name ?? c.id}
                {mayManage && (
                  <Button variant="ghost" size="sm" onClick={() => void save(items.filter((x) => x.id !== c.id))}>
                    {t('remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {mayManage && (
          <div className={styles.row}>
            <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('person_to_add')}>
              <NativeSelectOption value="">{t('add_person')}</NativeSelectOption>
              {candidates.map((m) => (
                <NativeSelectOption key={m.user_id} value={m.user_id}>
                  {m.display_name || m.email || m.user_id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={!pick}
              onClick={() => {
                const m = members.find((x) => x.user_id === pick);
                void save([...(items ?? []), { id: pick, name: m?.display_name || m?.email || null }]);
                setPick('');
              }}
            >
              {t('add')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
