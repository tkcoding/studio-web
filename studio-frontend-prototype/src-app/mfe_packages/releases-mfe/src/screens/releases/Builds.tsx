/**
 * A project's builds (ADR-0045, ADR-0048 §9), Releases' first step: the
 * prototype's builds-tab.tsx (00828880) carried over in part. One line says
 * where the builds stand; Build in CI -- the repository's workflow, its runs,
 * which one is the project's build workflow -- then the product's builds,
 * from Studio, the IDE or CI, as one table: the newest open with how far it
 * got (prepare, images, publish), its log, what failed and whose it is to
 * fix, and, once it published its chart, Deploy. A run of the project's
 * build workflow is one of them even when it left no manifest.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { isNotFound } from '@constructor-studio/mfe-shared';
import type { BuildLog, Deployment, DeployEnvironment, ProjectBuildConfig, ProjectImage } from '../../api/types';
import {
  BUILD_STAGES,
  buildDuration,
  buildStages,
  buildWorkflowOf,
  buildsHeadline,
  buildsOf,
  ciReadFailures,
  failureCause,
  ideBuildDuration,
  isBuildWorkflow,
  isLost,
  placeLines,
  productBuildsOf,
  repoPathsOf,
  statusTone,
  stepToShow,
  workflowsOf,
  type BuildRun,
  type BuildStage,
  type BuildStatus,
  type BuildWorkflow,
  type IdeBuild,
  type StageState,
} from '../../model/builds';
import { recordFor, whereItRuns } from '../../model/images';
import { buildsHint } from '../../model/pipeline';
import { DeployBuildTo } from './DeployActions';
import { ErrorLine, TONE_BADGE, When, errText, useApi, useReleases, type Tone } from './parts';
import { NextLine } from './NextLine';
import styles from './ReleasesScreen.module.css';

/** At most this many runs are read: the sync keeps the newest few hundred per repository. */
const LIMIT = 200;

/** How often the product's builds are read again while one runs. */
const FOLLOW_MS = 10_000;

/** CI runs shown before Show all: the newest of the chosen workflow. */
const RUNS_SHOWN = 10;

/** How often an open log is read again while its build runs. */
const LOG_FOLLOW_MS = 5_000;

/** A build's status as a chip's tone: statusTone, with a running build drawn as running. */
function buildTone(status: BuildStatus): Tone {
  return status === 'running' ? 'running' : (statusTone(status) as Tone);
}

const STAGE_TONE: Record<StageState, Tone> = { done: 'ok', running: 'running', failed: 'danger', waiting: 'neutral' };
const STAGE_MARK: Record<StageState, string> = { done: '✓', running: '…', failed: '✕', waiting: '' };

/** A pod step's state as a stage's, for its mark. */
const STEP_STAGE: Record<string, StageState> = { passed: 'done', running: 'running', failed: 'failed', waiting: 'waiting' };

export function ProjectBuilds({
  ideBuilds,
  environments,
  deployments,
  round,
  now,
  onChanged,
  onFollow,
}: {
  /** The product's builds as recorded (`build` nodes), read by Releases. */
  ideBuilds: IdeBuild[];
  environments: DeployEnvironment[];
  deployments: Deployment[];
  /** Bumped by Releases when it read again: read the runs again too. */
  round: number;
  /** When Releases last read: what "lost" and "took" are measured against. */
  now: number;
  onChanged: (message: string) => void;
  /** A build runs: ask Releases to read again. */
  onFollow: () => void;
}) {
  const { t, projectId } = useReleases();
  const api = useApi();
  const [config, setConfig] = useState<ProjectBuildConfig | null>(null);
  // The CI runs of the project's repositories, and what the repositories say
  // about reading them: Build in CI lists them, and the build workflow's are
  // among the product's builds.
  const [runs, setRuns] = useState<BuildRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [ciFailures, setCiFailures] = useState<{ repo: string; error: string }[]>([]);
  const [repoPaths, setRepoPaths] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    api
      .projectConfig({ projectId })
      .fetch({ staleTime: 0 })
      .then((c) => live && setConfig(c.value ?? {}))
      .catch((e: unknown) => live && setConfig(isNotFound(e) ? {} : null));
    // The repositories say whether their CI could be read at all: no runs and
    // "could not read the runs" are different answers. They also name the
    // repository a run belongs to, which Build in CI needs.
    api
      .nodes({ projectId, type: 'repo', limit: 200 })
      .fetch({ staleTime: 0 })
      .then((page) => {
        if (!live) return;
        setCiFailures(ciReadFailures(page.nodes ?? []));
        setRepoPaths(repoPathsOf(page.nodes ?? []));
      })
      .catch(() => live && setCiFailures([]));
    api
      .nodes({ projectId, type: 'workflow_run', limit: LIMIT, sort: 'updated' })
      .fetch({ staleTime: 0 })
      .then((page) => {
        if (!live) return;
        setRuns(buildsOf(page.nodes ?? []));
        setRunsError(null);
      })
      .catch((e: unknown) => live && setRunsError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, projectId, round]);

  const builds = useMemo(
    () => productBuildsOf(ideBuilds, runs ?? [], config?.build, repoPaths),
    [ideBuilds, runs, config, repoPaths]
  );
  const running = builds.some((b) => b.status === 'running' && !isLost(b, now));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(onFollow, FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [running, onFollow]);

  // Building in Studio is not in this portal yet (parity.md): the line says
  // what it can without it.
  const hint = buildsHint(builds, false, now);

  return (
    <section className={styles.stack} data-release-builds>
      <NextLine hint={hint} />
      <section className={styles.card} data-build-in-ci>
        <h2 className={styles.cardTitle}>{t('build_in_ci_title')}</h2>
        <InCi
          config={config}
          setConfig={setConfig}
          runs={runs}
          error={runsError}
          failures={ciFailures}
          repoPaths={repoPaths}
          builds={ideBuilds}
          now={now}
        />
      </section>
      <ProductBuilds builds={builds} environments={environments} deployments={deployments} now={now} onChanged={onChanged} />
    </section>
  );
}

/** The repository's CI builds the product: the CI runs of the project's
 *  repositories, the chosen workflow's newest first, with Build in CI and
 *  Use as the build workflow; a run that published the product says what. */
function InCi({
  config,
  setConfig,
  runs,
  error,
  failures,
  repoPaths,
  builds,
  now,
}: {
  config: ProjectBuildConfig | null;
  setConfig: (c: ProjectBuildConfig) => void;
  runs: BuildRun[] | null;
  error: string | null;
  failures: { repo: string; error: string }[];
  repoPaths: Map<string, string>;
  /** The product's builds as recorded: a pipeline's names its run. */
  builds: IdeBuild[];
  now: number;
}) {
  const { t, language, projectId } = useReleases();
  const api = useApi();
  const [workflow, setWorkflow] = useState('');
  const [branch, setBranch] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const published = useMemo(
    () => new Map(builds.filter((b) => b.where === 'ci' && b.chartVersion).map((b) => [b.buildId, b.chartVersion])),
    [builds]
  );
  const workflows = useMemo(() => workflowsOf(runs ?? []), [runs]);
  const setting = config?.build ?? null;
  // The project's build workflow first; else the workflow that runs most,
  // which is usually the one that builds, until a member picks another.
  const settingName = useMemo(
    () => workflows.find((w) => isBuildWorkflow(setting, buildWorkflowOf(runs ?? [], w.name, repoPaths)))?.name ?? '',
    [workflows, setting, runs, repoPaths]
  );
  const chosen = workflow || settingName || workflows[0]?.name || '';
  const candidate = useMemo(() => buildWorkflowOf(runs ?? [], chosen, repoPaths), [runs, chosen, repoPaths]);
  const chosenIsTheBuild = isBuildWorkflow(setting, candidate);
  const branches = useMemo(
    () =>
      [...new Set((runs ?? []).filter((r) => r.workflow === chosen).map((r) => r.branch).filter(Boolean))] as string[],
    [runs, chosen]
  );
  const matching = (runs ?? []).filter((r) => r.workflow === chosen && (!branch || r.branch === branch));
  const shown = all ? matching : matching.slice(0, RUNS_SHOWN);

  const act = async (what: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    setActionError(null);
    try {
      setNote(await what());
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const makeTheBuild = (picked: BuildWorkflow) =>
    act(async () => {
      // The config is one object: read now, so nothing written since is lost.
      const current = await api
        .projectConfig({ projectId })
        .fetch({ staleTime: 0 })
        .then((c) => c.value ?? {})
        .catch((e: unknown) => {
          if (isNotFound(e)) return {};
          throw e;
        });
      const next = { ...current, build: picked };
      await api.putProjectConfig(projectId).fetch(next);
      setConfig(next);
      return t('build_workflow_set', { workflow: picked.workflow, repo: picked.repo });
    });

  const startBuild = (picked: BuildWorkflow) =>
    act(async () => {
      const r = await api.dispatchBuild(projectId).fetch({
        repo: picked.repo,
        workflow: picked.workflow,
        ...(branch ? { ref: branch } : {}),
      });
      return t('ci_started', { workflow: r.workflow, ref: r.ref, repo: r.repo });
    });

  return (
    <div className={styles.stack}>
      {failures.map((f) => (
        <ErrorLine key={f.repo}>{t('ci_unreadable', { repo: f.repo, error: f.error })}</ErrorLine>
      ))}
      {error && <ErrorLine>{error}</ErrorLine>}
      {actionError && <ErrorLine>{actionError}</ErrorLine>}
      {note && (
        <div className={styles.notice} data-builds-ci-note>
          {note}
        </div>
      )}
      {!error && runs === null && <p className={styles.muted}>{t('ci_loading')}</p>}
      {runs && runs.length === 0 && (
        <div data-builds-empty>
          <b>{t('ci_none')}</b> <span className={styles.muted}>{t('ci_none_body')}</span>
        </div>
      )}
      {runs && runs.length > 0 && (
        <>
          <div className={styles.headRow}>
            <div>
              <h3 className={styles.subTitle} data-builds-headline>
                {buildsHeadline(runs, chosen || null, branch || null)}
              </h3>
              <div data-builds-workflow-state>
                {chosenIsTheBuild ? (
                  <Badge variant="success" title={t('build_workflow_is_this')}>
                    {t('the_build_workflow')}
                  </Badge>
                ) : setting ? (
                  <Badge variant="secondary" title={t('build_workflow_is', { workflow: setting.workflow, repo: setting.repo })}>
                    {t('build_workflow_named', { workflow: setting.workflow })}
                  </Badge>
                ) : (
                  <Badge variant="warning" title={t('build_workflow_unset_why')}>
                    {t('build_workflow_unset')}
                  </Badge>
                )}
              </div>
            </div>
            <div className={styles.row}>
              <NativeSelect
                aria-label={t('workflow')}
                value={chosen}
                onChange={(e) => {
                  setWorkflow(e.target.value);
                  // The branch picked may not exist in the other workflow.
                  setBranch('');
                }}
              >
                {workflows.map((w) => (
                  <NativeSelectOption key={w.name} value={w.name}>
                    {w.name} ({w.runs})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect aria-label={t('branch')} value={branch} onChange={(e) => setBranch(e.target.value)}>
                <NativeSelectOption value="">{t('every_branch')}</NativeSelectOption>
                {branches.map((b) => (
                  <NativeSelectOption key={b} value={b}>
                    {b}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {candidate && !chosenIsTheBuild && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void makeTheBuild(candidate)} data-builds-set>
                  {t('use_as_build_workflow')}
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy || !candidate}
                title={
                  candidate
                    ? t('ci_start_title', { workflow: candidate.workflow, branch: branch || t('repo_branch') })
                    : t('ci_no_file')
                }
                onClick={() => candidate && void startBuild(candidate)}
                data-builds-start
              >
                {busy ? t('starting') : t('build_in_ci')}
              </Button>
            </div>
          </div>
          <Table data-builds-table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_status')}</TableHead>
                <TableHead>{t('col_commit')}</TableHead>
                <TableHead>{t('branch')}</TableHead>
                <TableHead>{t('col_started_by')}</TableHead>
                <TableHead>{t('col_when')}</TableHead>
                <TableHead>{t('col_took')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => {
                const chart = r.externalId ? published.get(`ci-run-${r.externalId}`) : undefined;
                return (
                  <TableRow key={r.id} data-build-status={r.status}>
                    <TableCell>
                      <Badge variant={TONE_BADGE[buildTone(r.status)]}>{r.status}</Badge>
                      {chart ? (
                        <span className={styles.muted} data-run-published>
                          {' '}
                          · {t('published')} <code>{chart}</code>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <code>{r.shortSha}</code>{' '}
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.title || t('run_number', { number: r.number ?? '' })}
                        </a>
                      ) : (
                        r.title
                      )}
                      {r.attempt && r.attempt > 1 ? (
                        <span className={styles.muted}> · {t('attempt', { attempt: r.attempt })}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.branch ?? '—'}</TableCell>
                    <TableCell>
                      {r.author ?? '—'}
                      {r.event ? <span className={styles.muted}> · {r.event}</span> : null}
                    </TableCell>
                    <TableCell>{r.createdAt ? new Date(r.createdAt).toLocaleString(language) : '—'}</TableCell>
                    <TableCell>{buildDuration(r, now) ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {matching.length > RUNS_SHOWN && (
            <button type="button" className={styles.link} onClick={() => setAll((v) => !v)} data-builds-show-all>
              {all ? t('show_newest', { count: RUNS_SHOWN }) : t('show_all_runs', { count: matching.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** The product's builds, newest first -- run by Studio, the IDE or CI -- as
 *  one table. The newest is open under its row: its log, what failed or what
 *  it published, and Deploy; another opens on a click. A Studio build whose
 *  Job's hour is long past without word is lost, not running. */
function ProductBuilds({
  builds,
  environments,
  deployments,
  now,
  onChanged,
}: {
  builds: IdeBuild[];
  environments: DeployEnvironment[];
  deployments: Deployment[];
  now: number;
  onChanged: (message: string) => void;
}) {
  const { t } = useReleases();
  const product = builds.filter((b) => b.action !== 'run');
  // `undefined`: the newest, until the reader opens or closes one.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const shown = open === undefined ? (product[0]?.id ?? null) : open;
  if (product.length === 0) return null;
  return (
    <section className={styles.card} data-product-builds>
      <h2 className={styles.cardTitle}>{t('builds_title')}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col_status')}</TableHead>
            <TableHead>{t('col_build')}</TableHead>
            <TableHead>{t('col_stages')}</TableHead>
            <TableHead>{t('col_where')}</TableHead>
            <TableHead>{t('col_commit')}</TableHead>
            <TableHead>{t('col_when')}</TableHead>
            <TableHead>{t('col_took')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {product.map((b) => {
            const lost = isLost(b, now);
            return (
              <Fragment key={b.id}>
                <TableRow
                  className={styles.clickable}
                  aria-expanded={shown === b.id}
                  onClick={() => setOpen(shown === b.id ? null : b.id)}
                  data-product-build={b.buildId}
                >
                  <TableCell>
                    <span data-ide-build-status={lost ? 'lost' : b.status}>
                      {lost ? (
                        <Badge variant="warning" data-build-lost-badge>
                          {t('lost')}
                        </Badge>
                      ) : (
                        <Badge variant={TONE_BADGE[buildTone(b.status)]}>{b.status}</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <b>
                      {b.product ?? t('the_product')}
                      {b.profile ? <span className={styles.muted}> · {b.profile}</span> : null}
                    </b>
                  </TableCell>
                  <TableCell>
                    <StageLane build={b} lost={lost} />
                  </TableCell>
                  <TableCell>{b.where}</TableCell>
                  <TableCell>
                    {b.shortSha ? <code>{b.shortSha}</code> : (b.branch ?? '—')}
                    {b.descriptionRevision !== null ? (
                      <span className={styles.muted} title={t('revision_title')}>
                        {' '}
                        · {t('revision', { revision: b.descriptionRevision })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <When iso={b.startedAt} />
                  </TableCell>
                  <TableCell>{lost ? '—' : (ideBuildDuration(b, now) ?? '—')}</TableCell>
                </TableRow>
                {shown === b.id && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <BuildDetails
                        build={b}
                        lost={lost}
                        now={now}
                        environments={environments}
                        deployments={deployments}
                        onChanged={onChanged}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/** One build, open under its row: where it ran, its log, what failed and
 *  whose it is to fix, or what it published, and Deploy once it published a chart. */
function BuildDetails({
  build: b,
  lost,
  now,
  environments,
  deployments,
  onChanged,
}: {
  build: IdeBuild;
  lost: boolean;
  now: number;
  environments: DeployEnvironment[];
  deployments: Deployment[];
  onChanged: (message: string) => void;
}) {
  const { t, language } = useReleases();
  const cause = b.status === 'failed' ? failureCause(b, now) : null;
  const place = b.place ? placeLines(b.place) : [];
  return (
    <div className={styles.stack} data-build-card={b.buildId} data-build-card-status={lost ? 'lost' : b.status}>
      {b.branch && (
        <div className={styles.muted}>
          {t('from_branch')} <code>{b.branch}</code>
        </div>
      )}
      {place.length > 0 && (
        <dl className={styles.facts} data-build-place>
          {place.map((l) => (
            <Fragment key={l.label}>
              <dt>{l.label}</dt>
              <dd>
                <code>{l.value}</code>
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {lost && (
        <p className={styles.muted} data-build-lost>
          {b.status === 'failed' && b.failure
            ? b.failure
            : t('lost_body', {
                since: b.startedAt ? new Date(b.startedAt).toLocaleString(language) : t('it_started'),
              })}
        </p>
      )}
      {b.where === 'studio' && <BuildLogPanel buildId={b.buildId} running={b.status === 'running'} />}
      {cause && !lost && (
        <p className={styles.muted} data-build-cause={cause.kind}>
          {cause.next}
        </p>
      )}
      {b.status === 'failed' && !lost && b.failure && (
        <div className={`${styles.error} ${styles.pre}`} data-ide-build-failure>
          {b.failureStep ? `${b.failureStep}: ` : ''}
          {b.failure}
        </div>
      )}
      {b.url && (
        <div className={styles.muted} data-build-run>
          <a href={b.url} target="_blank" rel="noreferrer">
            {t('its_ci_run')}
          </a>
        </div>
      )}
      {b.images.length > 0 ? (
        <BuildImages build={b} />
      ) : b.outputs.length > 0 ? (
        <div className={styles.muted}>{b.outputs.join(', ')}</div>
      ) : null}
      {b.chartRef ? (
        <div className={styles.muted} data-build-chart>
          {t('chart')} <code>{b.chartRef}</code>
          {b.chartVersion ? <>:{b.chartVersion}</> : null}
        </div>
      ) : null}
      {b.status === 'passed' && b.chartRef && b.chartVersion && (
        <DeployBuildTo build={b} environments={environments} deployments={deployments} onChanged={onChanged} />
      )}
    </div>
  );
}

/** The images a build published, each with what Studio recorded of it:
 *  where it runs now, whether it is pinned or gone. An image Studio did not
 *  record (a build from before the records, or one the IDE pushed) is its
 *  reference alone. */
function BuildImages({ build: b }: { build: IdeBuild }) {
  const { projectId } = useReleases();
  const api = useApi();
  const [records, setRecords] = useState<ProjectImage[]>([]);
  useEffect(() => {
    let live = true;
    api
      .buildImages({ projectId, buildId: b.buildId })
      .fetch({ staleTime: 0 })
      .then((page) => live && setRecords(page.items))
      .catch(() => live && setRecords([]));
    return () => {
      live = false;
    };
  }, [api, projectId, b.buildId]);
  return (
    <ul className={styles.list} data-build-images>
      {b.images.map((i) => {
        const record = recordFor(i, records, b.buildId);
        return (
          <li key={i.app} data-build-image={i.app}>
            {i.app} → <code>{i.image}</code>
            {record && (
              <span className={styles.muted} data-build-image-record={record.id}>
                {' '}
                · {whereItRuns(record.running_in)}
                {record.pinned ? ' Pinned.' : ''}
                {record.state !== 'present' && ` (${record.state})`}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A build Studio runs, step by step with the end of each step's log, read
 *  from its pod on demand and again every LOG_FOLLOW_MS while it runs. The
 *  pod is the truth here: a step that failed shows failed even before the
 *  build's record says so. */
function BuildLogPanel({ buildId, running }: { buildId: string; running: boolean }) {
  const { t, projectId } = useReleases();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<BuildLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const live = !log || log.steps.some((s) => s.state === 'running' || (running && s.state === 'waiting'));

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: number | undefined;
    const read = () =>
      api
        .buildLog({ projectId, buildId })
        .fetch({ staleTime: 0 })
        .then((l) => {
          if (!alive) return;
          setLog(l);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(errText(e)))
        .finally(() => {
          if (alive && live) timer = window.setTimeout(() => void read(), LOG_FOLLOW_MS);
        });
    void read();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [api, open, projectId, buildId, live]);

  const shown = step ?? stepToShow(log?.steps ?? []);
  const text = log?.steps.find((s) => s.step === shown)?.log ?? '';
  return (
    <div data-build-log={buildId}>
      <button type="button" className={styles.link} onClick={() => setOpen((o) => !o)} data-build-log-toggle>
        {open ? t('log_hide') : t('log_show')}
      </button>
      {open && (
        <div className={styles.stack}>
          {error && <ErrorLine>{error}</ErrorLine>}
          {!log && !error && <div className={styles.muted}>{t('log_reading')}</div>}
          {log && (
            <>
              <div className={styles.row}>
                <div className={styles.chips} role="tablist" aria-label={t('log_steps')}>
                  {log.steps.map((s) => (
                    <Button
                      key={s.step}
                      size="sm"
                      variant={shown === s.step ? 'secondary' : 'ghost'}
                      role="tab"
                      aria-selected={shown === s.step}
                      disabled={s.state === 'waiting'}
                      onClick={() => setStep(s.step)}
                      data-build-log-step={s.step}
                      data-build-log-state={s.state}
                    >
                      {STAGE_MARK[STEP_STAGE[s.state] ?? 'waiting']} {s.step}
                    </Button>
                  ))}
                </div>
                <span className={styles.muted}>
                  {log.environment} · <code>{log.namespace}</code>
                  {live ? ` · ${t('log_following')}` : ''}
                </span>
              </div>
              {shown ? (
                <pre className={styles.log} data-build-log-text>
                  {text || t('log_empty')}
                </pre>
              ) : (
                <div className={styles.muted}>{t('log_no_step')}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** prepare → images → publish, each as a badge in its state. A run of the
 *  product has no stages, nor has a CI run that left no manifest (its page
 *  has its jobs); a lost build's are not known past what it said. */
function StageLane({ build: b, lost }: { build: IdeBuild; lost: boolean }) {
  if (b.action === 'run' || (b.where === 'ci' && b.status !== 'passed' && !b.failureStep && !b.step))
    return <span className={styles.muted}>—</span>;
  const stages: Record<BuildStage, StageState> = buildStages(b);
  return (
    <span className={styles.stages} data-build-stages>
      {BUILD_STAGES.map((stage, i) => {
        const state: StageState =
          lost && (stages[stage] === 'running' || stages[stage] === 'failed') ? 'waiting' : stages[stage];
        return (
          <span key={stage} className={styles.stages}>
            {i > 0 && <span className={styles.muted}>→</span>}
            <Badge variant={TONE_BADGE[STAGE_TONE[state]]} data-stage={stage} data-stage-state={state}>
              {STAGE_MARK[state]} {stage}
            </Badge>
          </span>
        );
      })}
    </span>
  );
}
