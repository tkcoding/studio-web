/**
 * Project › Timeline, the prototype's `project-timeline.tsx`: the project's
 * milestones on a time axis, with a "today" line, counted by status in the
 * header, each one editable and removable, and Add milestone.
 *
 * Built on the Studio domain model alone (ADR-0066): `milestone` objects in
 * the project's scope, read with one `POST /query` (counted by status in the
 * same request) and written with `POST /mutate`. The type is
 * project-lifecycle's (ADR-0070 §7), so the section declares it needs it
 * (`presentation.needs`) and the shell hides the tab where it is not
 * installed. Opened anyway (an old address), it says the model has no
 * milestones rather than failing; and where the objects route refuses the
 * type although the model still lists it (left dormant, or not installed
 * here: `typeAbsence`), it says so and offers no writes. Read again when
 * milestones or the model change (`domain.objects_changed`,
 * `domain.model_changed`).
 */

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gears-frontx/ui-kit';
import {
  domainChanged,
  errorMessage,
  refusalText,
  typeAbsence,
  useOrganization,
  useStudioEventRefresh,
  type ScreenText,
  type TypeAbsence,
} from '@constructor-studio/mfe-shared';
import { ActivityApiService } from '../../api/ActivityApiService';
import { modelOf, shown, type DomainModel, type ModelField } from '../../model/fields';
import {
  MILESTONE,
  MILESTONE_LIMIT,
  badgeOf,
  day,
  extraFields,
  hasMilestone,
  milestoneFields,
  milestoneQuery,
  todayIndex,
  today as todayOf,
  toneOf,
  type Milestone,
} from '../../model/timeline';
import { MilestoneDialog } from './MilestoneDialog';
import styles from '../Screen.module.css';

const errText = (e: unknown) => refusalText(e) ?? errorMessage(e);

type ModelRead = { model: DomainModel } | { error: string } | null;

export const TimelineScreen: React.FC<{
  projectId: string;
  t: ScreenText;
  /** Where dialogs portal: inside this screen's themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
}> = ({ projectId, t, container }) => {
  const { org, loading: orgLoading } = useOrganization();
  const orgId = org?.id ?? null;
  const [modelRead, setModelRead] = useState<ModelRead>(null);
  const [items, setItems] = useState<Milestone[] | null>(null);
  const [counts, setCounts] = useState<{ key: unknown[]; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** The objects route refused the type itself: dormant, or not installed here. */
  const [absent, setAbsent] = useState<TypeAbsence | null>(null);
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const [removing, setRemoving] = useState<Milestone | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  const watched = useMemo(() => domainChanged([MILESTONE], { model: true }), []);
  useStudioEventRefresh(watched, () => setRevision((n) => n + 1));

  const model = modelRead && 'model' in modelRead ? modelRead.model : null;
  const declared = hasMilestone(model);
  // The model may still list the type while the objects route already refuses it.
  const installed = declared && absent === null;
  const fields = useMemo(() => milestoneFields(model), [model]);

  // The model first: without the type there is nothing to ask for.
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    apiRegistry
      .getService(ActivityApiService)
      .domainTypes({ orgId })
      .fetch({ staleTime: 0 })
      .then((res) => alive && setModelRead({ model: modelOf(res) }))
      .catch((e: unknown) => alive && setModelRead({ error: errText(e) }));
    return () => {
      alive = false;
    };
  }, [orgId, revision]);

  // Read again after a save or a delete here, as after one elsewhere (`revision`).
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!orgId || !declared) return;
    let alive = true;
    apiRegistry
      .getService(ActivityApiService)
      .queryDomain(orgId)
      .fetch(milestoneQuery(projectId))
      .then((res) => {
        if (!alive) return;
        setError(null);
        setAbsent(null);
        setItems((res.items ?? []).map((r) => ({ id: r.id, value: (r.value ?? {}) as Record<string, unknown> })));
        setCounts(res.groups ?? []);
        setTotal(res.total ?? 0);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const why = typeAbsence(e);
        setAbsent(why);
        setError(why ? null : t('milestones_failed', { error: errText(e) }));
        setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [orgId, projectId, declared, revision, reads, t]);

  const remove = async (m: Milestone) => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await apiRegistry
        .getService(ActivityApiService)
        .mutateDomain(orgId)
        .fetch({ operations: [{ op: 'delete', id: m.id }] });
      setReads((n) => n + 1);
    } catch (e) {
      setError(t('delete_failed', { error: errText(e) }));
    } finally {
      setRemoving(null);
      setBusy(false);
    }
  };

  const on = todayOf();
  const todayAt = items ? todayIndex(items, on) : -1;
  const label = (status: unknown) =>
    status === null || status === undefined ? t('no_status') : String(status).replace(/_/g, ' ');

  const body = () => {
    if (!orgId) return orgLoading ? <p className={styles.muted}>{t('loading_milestones')}</p> : null;
    if (modelRead === null) return <p className={styles.muted}>{t('loading_milestones')}</p>;
    if ('error' in modelRead) return <p className={styles.error}>{t('model_failed', { error: modelRead.error })}</p>;
    if (!installed) {
      return (
        <p className={styles.muted} data-timeline-no-type={absent?.reason ?? 'absent'}>
          {absent?.reason === 'dormant' ? t('milestone_type_dormant') : t('no_milestone_type')}
        </p>
      );
    }
    if (items === null) return <p className={styles.muted}>{t('loading_milestones')}</p>;
    if (items.length === 0) {
      return error ? null : (
        <p className={styles.muted} data-timeline-empty>
          {t('no_milestones')}
        </p>
      );
    }
    return (
      <ol className={styles.timeline} data-timeline>
        {items.map((m, i) => {
          const date = day(m.value.target_at);
          const badge = badgeOf(m, on);
          const name = shown(m.value.name ?? m.value.title);
          return (
            <Fragment key={m.id}>
              {i === todayAt && <TodayMark t={t} />}
              <li className={styles.milestone} data-milestone={m.id}>
                <span className={styles.date}>{date || t('no_date')}</span>
                <span className={styles.dot} aria-hidden data-tone={toneOf(badge)} />
                <span className={styles.what}>
                  <strong>{name}</strong>
                  <Badge variant={toneOf(badge)} data-milestone-status>
                    {badge === 'late' ? t('late') : label(badge)}
                  </Badge>
                  {extraFields(fields, m).map((f: ModelField) => (
                    <span key={f.name} className={styles.sub}>
                      {f.name.replace(/_/g, ' ')}: {shown(m.value[f.name])}
                    </span>
                  ))}
                </span>
                <span className={styles.actions}>
                  <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                    {t('edit')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRemoving(m)}>
                    {t('delete')}
                  </Button>
                </span>
              </li>
            </Fragment>
          );
        })}
        {todayAt === items.length && <TodayMark t={t} />}
      </ol>
    );
  };

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('timeline_title')}</h2>
        <div className={`${styles.chips} ${styles.grow}`}>
          {installed &&
            counts.map((g) => (
              <Badge key={String(g.key[0])} variant="secondary" data-timeline-count>
                {t('status_count', { status: label(g.key[0]), count: g.count })}
              </Badge>
            ))}
        </div>
        <Button onClick={() => setEditing('new')} disabled={!installed} data-timeline-add>
          {t('add_milestone')}
        </Button>
      </header>
      <p className={styles.about}>{t('timeline_about')}</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {body()}
      {items && total > items.length && (
        <p className={styles.muted}>{t('milestones_incomplete', { count: MILESTONE_LIMIT })}</p>
      )}
      {editing && orgId && installed && (
        <MilestoneDialog
          t={t}
          container={container}
          orgId={orgId}
          projectId={projectId}
          fields={fields}
          milestone={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReads((n) => n + 1);
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !busy) setRemoving(null);
          }}
        >
          <DialogContent container={container} closeLabel={t('close')} data-timeline-delete>
            <DialogHeader>
              <DialogTitle>{t('delete_title', { name: shown(removing.value.name ?? removing.value.title) })}</DialogTitle>
              <DialogDescription>{t('delete_note')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button variant="destructive" onClick={() => void remove(removing)} disabled={busy}>
                {t('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

TimelineScreen.displayName = 'TimelineScreen';

function TodayMark({ t }: { t: ScreenText }) {
  return (
    <li className={styles.todayMark} data-timeline-today>
      {t('today')}
    </li>
  );
}

