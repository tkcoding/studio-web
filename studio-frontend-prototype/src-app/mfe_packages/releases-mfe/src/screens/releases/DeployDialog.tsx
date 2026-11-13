/**
 * Deploy to… (#1053): one dialog listing every target the project may use --
 * the environments up the ladder (the organization's that admit it, and its
 * own) and, where the Constructor Research kit applies, the caller's
 * Research projects. The server answers `research_kit` on the project's
 * path and the Research projects only where the kit applies, so without the
 * kit the Research target is simply absent.
 *
 * A Research target shows the caller's sign-in (and leads to signing in),
 * the Research project and hardware to run on (the kit's
 * `research_projects`/`research_hardware`, read with the caller's own
 * sign-in), then builds the product there -- following the build as it goes
 * -- deploys that build, and gives the application's public link once it
 * runs. A failure says its cause and the action that fixes it (#1054).
 *
 * FrontX 0.4 gives a screen no slot of its own inside its page
 * (`app/mfe/slots.ts`), so the kit's contribution is its data: the target
 * appears from what the server says the kit makes possible.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';
import type {
  Deployment,
  DeployEnvironment,
  PathAction,
  ProjectPath,
  ResearchHardware,
  ResearchProject,
} from '../../api/types';
import type { IdeBuild } from '../../model/builds';
import { ended, researchEnvironmentFor, researchEnvironmentInput, type Intent } from '../../model/path';
import { deployableBuilds } from '../../model/project-deploys';
import { useDeployRequest } from './DeployActions';
import { CauseView } from './ProjectPath';
import { ErrorLine, errText, useApi, useReleases } from './parts';
import styles from './ReleasesScreen.module.css';

/** How often a Research build and its deploy are read again. */
const FOLLOW_MS = 4000;

export function DeployDialog({
  environments,
  builds,
  path,
  focus,
  onClose,
  onChanged,
  onIntent,
}: {
  environments: DeployEnvironment[];
  builds: IdeBuild[];
  path: ProjectPath | null;
  /** The environment to start on, or the Research target. */
  focus: { environmentId: string | null; research: boolean };
  onClose: () => void;
  onChanged: (message: string) => void;
  onIntent: (intent: Intent, action: Partial<PathAction>) => void;
}) {
  const { t, container } = useReleases();
  const research = !!path?.research_kit;
  const clusters = environments.filter((e) => e.kind !== 'research' || research);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent container={container} closeLabel={t('close')} data-deploy-dialog>
        <DialogHeader>
          <DialogTitle>{t('deploy_to_title')}</DialogTitle>
        </DialogHeader>
        <p className={styles.muted}>{t('deploy_to_about')}</p>
        <section className={styles.stack}>
          <h3 className={styles.subTitle}>{t('target_environments')}</h3>
          {clusters.length === 0 ? (
            <p className={styles.muted}>{t('no_environment')}</p>
          ) : (
            <ul className={styles.targets}>
              {clusters.map((e) => (
                <EnvironmentTarget
                  key={e.id}
                  env={e}
                  builds={builds}
                  focused={focus.environmentId === e.id}
                  onChanged={(m) => {
                    onChanged(m);
                    onClose();
                  }}
                />
              ))}
            </ul>
          )}
        </section>
        {research && path && (
          <ResearchTarget
            path={path}
            environments={environments}
            onIntent={(intent, a) => {
              onClose();
              onIntent(intent, a);
            }}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One environment: the newest build that may go there, deployed with one press. */
function EnvironmentTarget({
  env,
  builds,
  focused,
  onChanged,
}: {
  env: DeployEnvironment;
  builds: IdeBuild[];
  focused: boolean;
  onChanged: (message: string) => void;
}) {
  const { t } = useReleases();
  const newest = deployableBuilds(builds, env)[0];
  const { busy, error, ask } = useDeployRequest(onChanged);
  const version = newest ? (newest.chartVersion ?? newest.buildId) : '';
  return (
    <li className={styles.target} data-deploy-target={env.id} data-deploy-target-focused={focused || undefined}>
      <span className={styles.row}>
        <b>{env.name}</b>
        {env.kind === 'research' && <Badge variant="secondary">{t('target_research')}</Badge>}
        {env.protected && <Badge variant="warning">{t('needs_approval')}</Badge>}
      </span>
      {newest ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void ask(
              { environment_id: env.id, build: newest.buildId },
              t('what_deploy_to', { version, environment: env.name })
            )
          }
        >
          {t('target_deploy', { version })}
        </Button>
      ) : (
        <span className={styles.muted}>{t('target_no_build')}</span>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </li>
  );
}

type Run =
  | { at: 'idle' }
  | { at: 'building'; buildId: string; runId: string; environmentId: string; lines: string[] }
  | { at: 'deploying'; buildId: string; deployment: Deployment | null }
  | { at: 'done'; deployment: Deployment }
  | { at: 'failed'; deployment: Deployment | null; message: string };

/** The caller's Research: sign-in, project and hardware, then build, deploy, link. */
function ResearchTarget({
  path,
  environments,
  onIntent,
  onChanged,
}: {
  path: ProjectPath;
  environments: DeployEnvironment[];
  onIntent: (intent: Intent, action: Partial<PathAction>) => void;
  onChanged: (message: string) => void;
}) {
  const { t, projectId, organizationId } = useReleases();
  const api = useApi();
  const signIn = path.research?.state ?? 'none';
  const signedIn = signIn === 'signed_in' || signIn === 'runs_out';
  const [projects, setProjects] = useState<ResearchProject[] | null>(null);
  const [connection, setConnection] = useState<string | null>(null);
  const [picked, setPicked] = useState('');
  const [hardware, setHardware] = useState<ResearchHardware[]>([]);
  const [hw, setHw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run>({ at: 'idle' });
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api
      .myResearchProjects({ projectId })
      .fetch({ staleTime: 0 })
      .then((r) => {
        if (!live) return;
        setProjects(r.items);
        setConnection(r.connection_id);
        setPicked((p) => p || r.items[0]?.id || '');
      })
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, projectId, signedIn]);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    api
      .myResearchHardware({ projectId, researchProject: picked })
      .fetch({ staleTime: 0 })
      .then((r) => live && setHardware(r.items))
      .catch(() => live && setHardware([]));
    return () => {
      live = false;
    };
  }, [api, projectId, picked]);

  // Follow the build, then the deploy, until each ends.
  useEffect(() => {
    if (run.at !== 'building' && run.at !== 'deploying') return;
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        if (run.at === 'building') {
          const [b, task] = await Promise.all([
            api.build({ projectId, buildId: run.buildId }).fetch({ staleTime: 0 }),
            api
              .taskRun({ runId: run.runId, tenantId: organizationId })
              .fetch({ staleTime: 0 })
              .catch(() => null),
          ]);
          if (!live) return;
          const said = task?.progress?.trim();
          const lines = said && !seen.current.has(said) ? [...run.lines, said] : run.lines;
          if (said) seen.current.add(said);
          if (b.status === 'passed') {
            const d = await api
              .createDeployment(projectId)
              .fetch({ environment_id: run.environmentId, build: run.buildId });
            setRun({ at: 'deploying', buildId: run.buildId, deployment: d });
          } else if (ended(b.status)) {
            setRun({
              at: 'failed',
              deployment: null,
              message: b.cause?.summary ?? b.failure ?? t('research_build_failed'),
            });
          } else {
            setRun({ ...run, lines });
          }
        } else if (run.deployment) {
          const d = await api.deployment({ projectId, id: run.deployment.id }).fetch({ staleTime: 0 });
          if (!live) return;
          if (d.state === 'succeeded') {
            setRun({ at: 'done', deployment: d });
            onChanged(t('research_runs'));
          } else if (ended(d.state)) setRun({ at: 'failed', deployment: d, message: d.outcome ?? d.reason ?? '' });
          else setRun({ ...run, deployment: d });
        }
      } catch (e) {
        if (live) setRun({ at: 'failed', deployment: null, message: errText(e) });
      }
    }, FOLLOW_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, projectId, organizationId, run, t, onChanged]);

  const start = async () => {
    const project = projects?.find((p) => p.id === picked);
    if (!project || !connection) return;
    setError(null);
    seen.current = new Set();
    try {
      let env = researchEnvironmentFor(environments, project.id, hw || null);
      if (!env) {
        env = await api
          .createProjectEnvironment(projectId)
          .fetch(researchEnvironmentInput(connection, project, hw || null));
      }
      const started = await api.startBuild(projectId).fetch({ environment_id: env.id });
      setRun({ at: 'building', buildId: started.build_id, runId: started.run_id, environmentId: env.id, lines: [] });
    } catch (e) {
      setError(errText(e));
    }
  };

  const busy = run.at === 'building' || run.at === 'deploying';
  return (
    <section className={styles.stack} data-deploy-target-research>
      <h3 className={styles.subTitle}>{t('target_research')}</h3>
      <div className={styles.row} data-research-sign-in={signIn}>
        <Badge variant={signedIn ? (signIn === 'runs_out' ? 'warning' : 'success') : 'danger'}>
          {signIn === 'signed_in'
            ? t('research_signed_in')
            : signIn === 'runs_out'
              ? t.count('research_runs_out', path.research?.days_left ?? 0)
              : signIn === 'expired'
                ? t('research_expired')
                : t('research_not_signed_in')}
        </Badge>
        {signIn !== 'signed_in' && (
          <Button size="sm" variant="outline" onClick={() => onIntent({ kind: 'screen', route: '/connections' }, { kind: 'sign_in' })}>
            {t('action_sign_in')}
          </Button>
        )}
      </div>
      {signedIn && projects !== null && projects.length === 0 && <p className={styles.muted}>{t('research_no_projects')}</p>}
      {signedIn && projects && projects.length > 0 && (
        <div className={styles.formRow}>
          <NativeSelect value={picked} onChange={(e) => setPicked(e.target.value)} aria-label={t('research_project')} disabled={busy}>
            {projects.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name || p.id}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect value={hw} onChange={(e) => setHw(e.target.value)} aria-label={t('research_hardware')} disabled={busy}>
            <NativeSelectOption value="">{t('research_hardware_default')}</NativeSelectOption>
            {hardware.map((h) => (
              <NativeSelectOption key={h.id} value={h.id}>
                {h.trial ? `${h.name} (${t('research_trial')})` : h.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button size="sm" disabled={busy || !picked || !connection} onClick={() => void start()} data-research-run>
            {t('research_run')}
          </Button>
        </div>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
      {run.at === 'building' && (
        <div className={styles.stack} data-research-build={run.buildId}>
          <span className={styles.muted}>{t('research_building', { build: run.buildId })}</span>
          <pre className={`${styles.log} ${styles.pre}`} aria-live="polite" data-research-build-log>
            {run.lines.join('\n') || t('loading')}
          </pre>
        </div>
      )}
      {run.at === 'deploying' && <span className={styles.muted}>{t('research_deploying')}</span>}
      {run.at === 'done' && (
        <p data-research-url>
          {run.deployment.public_url ? (
            <>
              {t('runs_at')}{' '}
              <a className={styles.link} href={run.deployment.public_url} target="_blank" rel="noreferrer">
                {run.deployment.public_url}
              </a>
            </>
          ) : (
            t('research_runs')
          )}
        </p>
      )}
      {run.at === 'failed' &&
        (run.deployment?.cause ? (
          <CauseView
            cause={run.deployment.cause}
            deploymentId={run.deployment.id}
            onIntent={(intent, a) => {
              if (a.kind === 'choose_hardware') setRun({ at: 'idle' });
              else onIntent(intent, a);
            }}
          />
        ) : (
          <ErrorLine>{run.message}</ErrorLine>
        ))}
    </section>
  );
}
