/**
 * Organization › Reports, the prototype's reports.tsx carried over (ADR-0069
 * §5): every report this Studio draws, configured once per organization.
 *
 * A report's source is a GitHub connection and the plan file in a repository;
 * the plan can name the board, its roots and its consumers itself, so the rest
 * of the form is only for a plan that does not yet. Refresh reads the plan
 * again and syncs the board (`reports.refresh`); a schedule does the same every
 * hour when switched on. The plan itself can be edited here (PlanEditor), and
 * the roadmap report draws its tables under its card (RoadmapReportBody).
 *
 * The sentences the models compose (a source's state, a publish's outcome,
 * a gear's demand) stay the models' English.
 */

import React, { useEffect, useRef, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyActions,
  EmptyHeader,
  EmptyTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
} from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  ConnectorsApiService,
  useHostChrome,
  useOrganization,
  type ConnectionDto,
} from '@constructor-studio/mfe-shared';
import { ReportsApiService, type ReportParams } from '../../api/ReportsApiService';
import { downloadReport } from '../../api/download';
import {
  canRefresh,
  draftOf,
  inputOf,
  needsAttention,
  stateOf,
  stateText,
  type Report,
  type ReportSchedule,
  type ReportSource,
  type SourceDraft,
  type SourceState,
} from '../../model/reports-model';
import { useReportsTranslations } from '../../i18n';
import { PlanEditor } from './PlanEditor';
import { RoadmapReportBody } from './RoadmapReportBody';
import { InfoPopover, StatusChip, errText, minute, type Container, type Text, type Tone } from './parts';
import styles from './ReportsScreen.module.css';

/** How long a refresh is waited on: 120 reads, 1.5 s apart. */
const POLLS = 120;
const POLL_MS = 1500;

export const ReportsScreen: React.FC = () => {
  const { org, loading: orgLoading } = useOrganization();
  const { containerRef, dataTheme } = useHostChrome();
  const { t, loading } = useReportsTranslations();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-org-reports>
      {loading || orgLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : !org ? (
        <p className={styles.muted}>{t('no_org')}</p>
      ) : (
        // Keyed by the organization: another organization is another read, from nothing.
        <OrgReports key={org.id} org={org} t={t} container={containerRef} />
      )}
    </div>
  );
};

ReportsScreen.displayName = 'ReportsScreen';

/** A source's state as a chip: its tone and a few words; the full sentence
 *  (stateText) rides in the chip's title and the configure dialog. */
function stateChip(st: SourceState, t: Text): { tone: Tone; text: string } {
  switch (st.kind) {
    case 'empty':
      return { tone: 'neutral', text: t('state_empty') };
    case 'unread':
      return { tone: 'info', text: t('state_unread') };
    case 'failed':
      return { tone: 'danger', text: t('state_failed') };
    case 'board-unread':
      return { tone: 'danger', text: t('state_board_unread') };
    case 'no-plan':
      return { tone: 'warn', text: t('state_no_plan') };
    case 'no-people':
      return { tone: 'warn', text: t('state_no_people') };
    case 'ready':
      return { tone: 'ok', text: t('state_ready', { at: minute(st.at) }) };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait on a run until it ends. `tenant` is the organization it was queued in. */
async function finished(runId: string, tenant: string, t: Text): Promise<{ ok: boolean; message: string | null }> {
  const api = apiRegistry.getService(ReportsApiService);
  for (let i = 0; i < POLLS; i++) {
    const run = await api.taskRun({ runId, tenant }).fetch({ staleTime: 0 });
    if (run.state === 'succeeded') return { ok: true, message: run.summary ?? null };
    if (run.state === 'failed' || run.state === 'cancelled') return { ok: false, message: run.last_error ?? run.state };
    await sleep(POLL_MS);
  }
  return { ok: false, message: t('still_running') };
}

function OrgReports({ org, t, container }: { org: { id: string; name: string }; t: Text; container: Container }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  /** Bumped by every change a card makes: the list is read again. */
  const [reads, setReads] = useState(0);

  // The organization on screen, not the caller's home tenant: the connection
  // list below is this organization's, so the report must be too.
  useEffect(() => {
    let live = true;
    apiRegistry
      .getService(ReportsApiService)
      .reports({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((r) => live && setReports(r.items))
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [org.id, reads]);

  useEffect(() => {
    let live = true;
    apiRegistry
      .getService(ConnectorsApiService)
      .connections({ tenantId: org.id })
      .fetch({ staleTime: 0 })
      .then((r) => live && setConnections(r.items.filter((c) => c.provider === 'github')))
      .catch(() => live && setConnections([]));
    // The organization's workspaces: what a plan's consumer project can be linked to.
    apiRegistry
      .getService(AccountsApiService)
      .getWorkspaces({ organizationId: org.id })
      .fetch()
      .then((page) => live && setProjects(page.items.map((w) => ({ id: w.id, name: w.name }))))
      .catch(() => live && setProjects([]));
    return () => {
      live = false;
    };
  }, [org.id]);

  const reload = () => setReads((n) => n + 1);
  const attention = (reports ?? []).filter((r) => needsAttention(stateOf(r.source))).length;
  const unconfigured = (reports ?? []).filter((r) => stateOf(r.source).kind === 'empty').length;
  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <div className={styles.chips}>
          {reports ? (
            <>
              <span className={styles.count} data-reports-count>
                {t.count('reports', reports.length)}
              </span>
              {unconfigured > 0 && <StatusChip tone="neutral">{t.count('not_configured', unconfigured)}</StatusChip>}
              {attention > 0 && <StatusChip tone="warn">{t.count('attention', attention)}</StatusChip>}
            </>
          ) : (
            !error && <span className={styles.muted}>{t('reading')}</span>
          )}
        </div>
      </header>
      <div className={styles.about}>
        <p>{t('about_configured')}</p>
        <p>{t('about_refresh')}</p>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {reports?.map((r) => (
        <ReportCard
          key={r.id}
          organizationId={org.id}
          report={r}
          projects={projects}
          connections={connections}
          onChanged={reload}
          container={container}
          t={t}
        />
      ))}
    </>
  );
}

function ReportCard({
  organizationId,
  report,
  projects,
  connections,
  onChanged,
  container,
  t,
}: {
  organizationId: string;
  report: Report;
  projects: { id: string; name: string }[];
  connections: ConnectionDto[];
  onChanged: () => void;
  container: Container;
  t: Text;
}) {
  const api = apiRegistry.getService(ReportsApiService);
  const params: ReportParams = { organizationId, reportId: report.id };
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    apiRegistry
      .getService(ReportsApiService)
      .schedule({ organizationId, reportId: report.id })
      .fetch({ staleTime: 0 })
      .then((s) => live && setSchedule(s))
      .catch(() => live && setSchedule(null));
    return () => {
      live = false;
    };
  }, [organizationId, report.id]);
  /** The form's edits, made against the source they were made on: a source
   *  read again (after a save, a refresh) starts the form over from it. */
  const [edit, setEdit] = useState<{ source: ReportSource; draft: SourceDraft } | null>(null);
  const draft = edit && edit.source === report.source ? edit.draft : draftOf(report.source);
  const [upload, setUpload] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  /** The source form, in a dialog rather than always on the page. */
  const [configOpen, setConfigOpen] = useState(false);
  const [advanced, setAdvanced] = useState(
    () => !!(report.source.board || report.source.roots.length || Object.keys(report.source.consumers).length)
  );

  const set = (p: Partial<SourceDraft>) => setEdit({ source: report.source, draft: { ...draft, ...p } });
  const act = async (label: string, f: () => Promise<string | null | void>) => {
    setBusy(label);
    setNote(null);
    try {
      const msg = await f();
      if (msg) setNote(msg);
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act('save', async () => {
      await api.updateSource(params).fetch(inputOf(draft));
      setUpload(null);
      onChanged();
      return t('saved');
    });

  const refresh = () =>
    act('refresh', async () => {
      await api.updateSource(params).fetch(inputOf(draft));
      const run = await api.sync(params).fetch(undefined);
      const done = await finished(run.run_id, organizationId, t);
      if (!done.ok) {
        onChanged();
        return t('refresh_failed', { message: done.message ?? '' });
      }
      // The refresh only queues the board sync; wait for that too, so the
      // gears below -- or why there are none -- are the ones it read.
      const after = await api.reports({ organizationId }).fetch({ staleTime: 0 });
      const sync = after.items.find((r) => r.id === report.id)?.source.last_refresh?.sync_run;
      const synced = sync ? await finished(sync, organizationId, t) : null;
      onChanged();
      setVersion((v) => v + 1);
      if (synced && !synced.ok) return t('sync_failed', { message: synced.message ?? '' });
      return t('refreshed', { message: synced?.message ?? done.message ?? t('refreshed_queued') });
    });

  const hourly = (on: boolean) =>
    act('schedule', async () => {
      setSchedule(await api.updateSchedule(params).fetch({ enabled: on }));
      return on ? t('hourly_on') : t('hourly_off');
    });

  const download = () => act('download', () => downloadReport(organizationId, report.id));

  const state = stateOf(report.source);
  const chip = stateChip(state, t);
  const refreshable = canRefresh(draft, report.source);
  const refreshHint = refreshable ? t('refresh_hint') : t('refresh_blocked');
  return (
    <Card data-report={report.id}>
      <CardContent className={styles.card}>
        <div className={styles.row}>
          <h3 className={styles.reportTitle}>{report.title}</h3>
          <InfoPopover label={t('about_report', { title: report.title })} container={container}>
            <p>{report.description}</p>
            <p>
              {t('drawn_with')} <code>{report.definition}</code>
              {report.sheets.length > 0 && ` — ${report.sheets.join(', ')}`}.
            </p>
          </InfoPopover>
          {state.kind !== 'empty' && (
            <StatusChip tone={chip.tone} title={stateText(state)} data-report-state={state.kind}>
              {chip.text}
            </StatusChip>
          )}
          {schedule?.enabled && <StatusChip tone="info">{t('hourly')}</StatusChip>}
          {note && !configOpen && (
            <span className={styles.hint} data-report-note>
              {note}
            </span>
          )}
          <span className={styles.grow} />
          {state.kind !== 'empty' && (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)} data-report-configure>
                {t('configure')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy || !refreshable}
                title={refreshHint}
                onClick={() => void refresh()}
                data-report-refresh
              >
                {busy === 'refresh' ? t('refreshing') : t('refresh')}
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => void download()} data-report-download>
                {busy === 'download' ? t('writing') : t('download')}
              </Button>
            </>
          )}
        </div>
        {report.definition_error && (
          <p role="alert" className={styles.error}>
            {t('definition_error', { error: report.definition_error })}
          </p>
        )}
        {needsAttention(state) && (
          <p role="alert" className={styles.error} data-report-attention>
            {stateText(state)}
          </p>
        )}
        {state.kind === 'empty' && (
          <Empty data-report-empty>
            <EmptyHeader>
              <EmptyTitle>{t('no_report_configured')}</EmptyTitle>
            </EmptyHeader>
            <EmptyActions>
              <Button onClick={() => setConfigOpen(true)} data-report-configure>
                {t('configure')}
              </Button>
            </EmptyActions>
          </Empty>
        )}

        <Dialog open={configOpen} onOpenChange={(next) => !next && setConfigOpen(false)}>
          {configOpen && (
            <DialogContent container={container} size="lg" closeLabel={t('close')} className={styles.dialog}>
              <section className={styles.stack} data-report-config={report.id}>
                <DialogHeader>
                  <DialogTitle>{t('configure_title', { title: report.title })}</DialogTitle>
                  <DialogDescription>{stateText(state)}</DialogDescription>
                </DialogHeader>
                <div className={styles.form}>
                  <span>{t('connection')}</span>
                  <NativeSelect
                    aria-label={t('connection')}
                    value={draft.connectionId}
                    onChange={(e) => set({ connectionId: e.target.value })}
                    data-source-connection
                  >
                    <NativeSelectOption value="">{connections.length ? t('first_github') : t('no_github')}</NativeSelectOption>
                    {connections.map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.label || c.account || c.id.slice(0, 8)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <span>{t('plan_file')}</span>
                  <Input
                    aria-label={t('plan_file')}
                    placeholder="owner/repo:path/gears.yaml@main"
                    value={draft.planFile}
                    onChange={(e) => set({ planFile: e.target.value })}
                    data-source-plan-file
                  />
                  <span>{t('or_upload')}</span>
                  <span className={styles.row}>
                    <Button variant="outline" size="sm" type="button" onClick={() => pick.current?.click()}>
                      {report.source.plan_uploaded || upload ? t('replace') : t('import_yaml')}
                    </Button>
                    <input
                      ref={pick}
                      type="file"
                      accept=".yaml,.yml,text/yaml"
                      hidden
                      data-source-upload
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void file.text().then((text) => {
                          setUpload(file.name);
                          setEdit((cur) => ({
                            source: report.source,
                            draft: { ...(cur && cur.source === report.source ? cur.draft : draftOf(report.source)), planYaml: text },
                          }));
                        });
                      }}
                    />
                    {upload && <code>{upload}</code>}
                    {!upload && report.source.plan_uploaded && <span className={styles.hint}>{t('uploaded_in_use')}</span>}
                    {(upload || report.source.plan_uploaded) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUpload(null);
                          set({ planYaml: '' });
                        }}
                      >
                        {t('clear')}
                      </Button>
                    )}
                  </span>
                </div>
                <Button variant="ghost" size="sm" className={styles.start} onClick={() => setAdvanced((a) => !a)} data-source-advanced>
                  {advanced ? t('hide') : t('advanced')}
                </Button>
                {advanced && (
                  <div className={styles.form}>
                    <span>{t('board')}</span>
                    <Input
                      aria-label={t('board')}
                      placeholder={t('board_placeholder')}
                      value={draft.board}
                      onChange={(e) => set({ board: e.target.value })}
                    />
                    <span>{t('roots')}</span>
                    <Input
                      aria-label={t('roots')}
                      placeholder={t('roots_placeholder')}
                      value={draft.roots}
                      onChange={(e) => set({ roots: e.target.value })}
                    />
                    <span>{t('consumers')}</span>
                    <Input
                      aria-label={t('consumers')}
                      placeholder={t('consumers_placeholder')}
                      value={draft.consumers}
                      onChange={(e) => set({ consumers: e.target.value })}
                    />
                  </div>
                )}
                <div className={styles.row}>
                  <Button size="sm" loading={busy === 'save'} disabled={!!busy} onClick={() => void save()} data-source-save>
                    {busy === 'save' ? t('saving') : t('save')}
                  </Button>
                  <label
                    className={styles.control}
                    title={schedule?.next_run_at ? t('next_run', { at: minute(schedule.next_run_at) }) : undefined}
                  >
                    <Checkbox
                      disabled={!!busy}
                      checked={!!schedule?.enabled}
                      onCheckedChange={(on) => void hourly(on === true)}
                      data-source-hourly
                    />
                    {t('refresh_hourly')}
                  </label>
                  {note && (
                    <span className={styles.hint} data-source-note>
                      {note}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy || !refreshable}
                    title={refreshHint}
                    onClick={() => void refresh()}
                    data-source-refresh
                  >
                    {busy === 'refresh' ? t('refreshing') : t('save_and_refresh')}
                  </Button>
                </div>
                <p className={styles.hint}>
                  {t('plan_carries')} <code>board: owner/48</code>, <code>roots: [3342, 4507]</code>,{' '}
                  <code>{'consumers: { A: Acronis }'}</code>, {t('plan_carries_and')} <code>report: back_roadmap</code>{' '}
                  {t('plan_carries_end')}
                </p>

                <Button variant="outline" size="sm" className={styles.start} onClick={() => setPlanOpen((o) => !o)} data-plan-toggle>
                  {planOpen ? t('hide_plan') : t('edit_plan')}
                </Button>
                {planOpen && (
                  <div className={styles.planBox}>
                    <PlanEditor
                      organizationId={organizationId}
                      report={report.id}
                      studioProjects={projects}
                      onSaved={() => {
                        onChanged();
                        setVersion((v) => v + 1);
                      }}
                      t={t}
                    />
                  </div>
                )}
              </section>
            </DialogContent>
          )}
        </Dialog>

        {report.id === 'roadmap' && state.kind !== 'empty' && (
          <RoadmapReportBody organizationId={organizationId} version={version} t={t} />
        )}
      </CardContent>
    </Card>
  );
}
