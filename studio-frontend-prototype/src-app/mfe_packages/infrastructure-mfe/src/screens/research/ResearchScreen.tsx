/**
 * Organization › Constructor Research: the Constructor Research kit's screen
 * (docs/design/studio-kits.md §3.13, ADR-0049). Shown only where the
 * organization has installed the kit (`presentation.kit` in mfe.json).
 *
 * One page that takes an organization from nothing to a product running in
 * Constructor Research, in the three steps ADR-0049 sets:
 *
 *   1. the member signs in to Research with their own account (Connections,
 *      "Sign in with Constructor"); every build and deploy runs with it;
 *   2. an administrator connects a Research project as an environment, with
 *      its hardware (the environment form Infrastructure uses, set to Research);
 *   3. a project builds and deploys there from its Releases; what runs in each
 *      Research project is listed here, with its status, logs and address.
 *
 * The build, deploy, rollback and uninstall themselves stay on a project's
 * Releases (product-releases): the server refuses them with
 * `KIT_NOT_INSTALLED` where this kit is not installed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyHeader,
  EmptyTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@gears-frontx/ui-kit';
import { isNotFound, openScreen, useHostChrome, useOrganization } from '@constructor-studio/mfe-shared';
import type { Connection, DeployEnvironment, Deployment } from '../../api/types';
import { clusterConnections, registryConnections, researchConnections } from '../../model/environments';
import {
  nextResearchStep,
  ownResearchSignIn,
  researchApplications,
  researchEnvironments,
  type ResearchStep,
} from '../../model/research';
import { useInfrastructureTranslations, useResearchTranslations } from '../../i18n';
import { EnvironmentForm } from '../infrastructure/EnvironmentForm';
import { useProjects } from '../infrastructure/InfrastructureScreen';
import {
  DeploymentLine,
  InfraProvider,
  PlaceIcon,
  StatusButton,
  errText,
  useApi,
  useInfra,
  usePeople,
} from '../infrastructure/parts';
import styles from '../infrastructure/InfrastructureScreen.module.css';
import own from './ResearchScreen.module.css';

type ResearchText = ReturnType<typeof useResearchTranslations>['t'];

export const ResearchScreen: React.FC<{ bridge: ChildMfeBridge | null }> = ({ bridge }) => {
  const { org, loading: orgLoading } = useOrganization();
  const { containerRef, dataTheme, language } = useHostChrome();
  const infra = useInfrastructureTranslations();
  const { t, loading } = useResearchTranslations();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-constructor-research>
      {loading || infra.loading || orgLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : !org ? (
        <p className={styles.muted}>{t('no_org')}</p>
      ) : (
        // The environment form, a deploy's line and its status are
        // Infrastructure's parts, with Infrastructure's words.
        <InfraProvider value={{ t: infra.t, language, org, container: containerRef }}>
          <OrgResearch
            key={org.id}
            t={t}
            org={org}
            onOpenConnections={() => openScreen(bridge, '/connections')}
            onOpenInfrastructure={() => openScreen(bridge, '/infrastructure')}
          />
        </InfraProvider>
      )}
    </div>
  );
};

ResearchScreen.displayName = 'ResearchScreen';

function OrgResearch({
  t,
  org,
  onOpenConnections,
  onOpenInfrastructure,
}: {
  t: ResearchText;
  org: { id: string; name: string };
  onOpenConnections: () => void;
  onOpenInfrastructure: () => void;
}) {
  const api = useApi();
  const [environments, setEnvironments] = useState<DeployEnvironment[] | null>(null);
  const [mayManage, setMayManage] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeployEnvironment | 'new' | null>(null);
  const [answers, setAnswers] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const load = useCallback(() => setRound((n) => n + 1), []);
  const { projects, workspaceIds } = useProjects(org.id);
  const people = usePeople([org.id, ...workspaceIds]);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.environments({ organizationId: org.id }).fetch({ staleTime: 0 }),
      api
        .connections({ tenantId: org.id })
        .fetch({ staleTime: 0 })
        .catch(() => ({ items: [] as Connection[] })),
      api
        .deployments({ organizationId: org.id })
        .fetch({ staleTime: 0 })
        .catch(() => ({ items: [] as Deployment[], total: 0 })),
    ])
      .then(([envs, conns, deps]) => {
        if (!live) return;
        setError(null);
        setEnvironments(envs.items);
        setMayManage(envs.may_manage);
        setConnections(conns.items);
        setDeployments(deps.items);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setEnvironments([]);
        setError(isNotFound(e) ? t('no_backend') : errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, org.id, round, t]);

  const signIn = useMemo(() => ownResearchSignIn(connections), [connections]);
  const researches = useMemo(() => researchConnections(connections), [connections]);
  const places = useMemo(() => researchEnvironments(environments ?? []), [environments]);
  const applications = useMemo(() => researchApplications(places, deployments), [places, deployments]);
  const step: ResearchStep = nextResearchStep(signIn, places, applications);
  const running = [...applications.values()].reduce((n, apps) => n + apps.filter((a) => a.runs).length, 0);

  const testEnvironment = async (e: DeployEnvironment) => {
    setBusy(e.id);
    try {
      const { message } = await api.testEnvironment(org.id, e.id).fetch(undefined);
      setAnswers((a) => ({ ...a, [e.id]: { ok: true, text: message } }));
    } catch (err) {
      setAnswers((a) => ({ ...a, [e.id]: { ok: false, text: errText(err) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <div className={styles.chips}>
          {environments === null ? (
            <Badge variant="info">{t('reading')}</Badge>
          ) : (
            <span className={styles.muted} data-research-count>
              {t.count('count_projects', places.length)} · {t.count('count_running', running)}
            </span>
          )}
        </div>
        {mayManage && signIn && (
          <div className={styles.headerAction}>
            <Button onClick={() => setEditing('new')} data-research-connect>
              {t('connect_project')}
            </Button>
          </div>
        )}
      </header>
      <div className={styles.about}>
        <p>{t('about', { org: org.name })}</p>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {environments === null ? (
        <Skeleton className={styles.skeleton} />
      ) : (
        <>
          <ol className={own.steps} aria-label={t('steps_label')}>
            <Step
              n={1}
              t={t}
              state={signIn ? 'done' : 'next'}
              title={t('step_sign_in')}
              data="sign_in"
              body={
                signIn ? (
                  <span className={styles.muted} data-research-signed-in>
                    {t('signed_in_as', { account: signIn.account || signIn.label })}
                  </span>
                ) : (
                  <>
                    <span className={styles.muted}>{t('sign_in_why')}</span>
                    <Button size="sm" onClick={onOpenConnections} data-research-sign-in>
                      {t('sign_in')}
                    </Button>
                  </>
                )
              }
            />
            <Step
              n={2}
              t={t}
              state={places.length > 0 ? 'done' : step === 'connect_project' ? 'next' : 'later'}
              title={t('step_connect')}
              data="connect_project"
              body={
                places.length > 0 ? (
                  <span className={styles.muted}>{t.count('connected_count', places.length)}</span>
                ) : mayManage ? (
                  <>
                    <span className={styles.muted}>{t('connect_why')}</span>
                    {signIn && (
                      <Button size="sm" onClick={() => setEditing('new')}>
                        {t('connect_project')}
                      </Button>
                    )}
                  </>
                ) : (
                  <span className={styles.muted}>{t('connect_admin')}</span>
                )
              }
            />
            <Step
              n={3}
              t={t}
              state={step === 'running' ? 'done' : step === 'deploy' ? 'next' : 'later'}
              title={t('step_deploy')}
              data="deploy"
              body={<span className={styles.muted}>{t('deploy_how')}</span>}
            />
          </ol>

          <h3 className={styles.part}>{t('projects_title')}</h3>
          {places.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('no_projects')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className={own.places}>
              {places.map((e) => (
                <ResearchPlace
                  key={e.id}
                  t={t}
                  e={e}
                  apps={applications.get(e.id) ?? []}
                  mayManage={mayManage}
                  busy={busy === e.id}
                  answer={answers[e.id] ?? null}
                  people={people}
                  onTest={() => void testEnvironment(e)}
                  onChange={() => setEditing(e)}
                />
              ))}
            </div>
          )}
          <p className={styles.hint}>
            {t('infrastructure_hint')}{' '}
            <button type="button" className={own.inline} onClick={onOpenInfrastructure}>
              {t('open_infrastructure')}
            </button>
          </p>
        </>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing !== null && (
          <ResearchSheet t={t} title={editing === 'new' ? t('connect_project') : editing.name}>
            <EnvironmentForm
              key={editing === 'new' ? 'new' : editing.id}
              editing={editing === 'new' ? null : editing}
              others={environments ?? []}
              clusters={clusterConnections(connections)}
              registries={registryConnections(connections)}
              researches={researches}
              projects={projects}
              initialCluster={editing === 'new' ? (signIn?.id ?? researches[0]?.id) : editing.connection_id}
              onCancel={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                load();
              }}
              onClusterAdded={(c) => setConnections((cs) => [...cs, c])}
            />
          </ResearchSheet>
        )}
      </Sheet>
    </>
  );
}

function ResearchSheet({ t, title, children }: { t: ResearchText; title: string; children: React.ReactNode }) {
  const { container } = useInfra();
  return (
    <SheetContent side="right" container={container} closeLabel={t('close')} className={styles.sheet}>
      <section className={styles.sheetBody} data-research-form>
        <SheetHeader>
          <SheetTitle className={styles.sheetTitle}>
            <PlaceIcon kind="research" size={20} />
            {title}
          </SheetTitle>
        </SheetHeader>
        {children}
      </section>
    </SheetContent>
  );
}

/** One step of the three: done, the one to do next, or later. */
function Step({
  n,
  t,
  state,
  title,
  body,
  data,
}: {
  n: number;
  t: ResearchText;
  state: 'done' | 'next' | 'later';
  title: string;
  body: React.ReactNode;
  data: string;
}) {
  return (
    <li className={own.step} data-research-step={data} data-step-state={state}>
      <span className={`${own.stepNumber} ${own[`step_${state}`]}`} aria-hidden>
        {n}
      </span>
      <div className={own.stepBody}>
        <div className={styles.line}>
          <b>{title}</b>
          <Badge variant={state === 'done' ? 'success' : state === 'next' ? 'info' : 'secondary'}>
            {t(`state_${state}`)}
          </Badge>
        </div>
        <div className={styles.actions}>{body}</div>
      </div>
    </li>
  );
}

/** A Research project the organization connected, and what runs in it. */
function ResearchPlace({
  t,
  e,
  apps,
  mayManage,
  busy,
  answer,
  people,
  onTest,
  onChange,
}: {
  t: ResearchText;
  e: DeployEnvironment;
  apps: readonly { projectId: string; projectName: string; runs: Deployment | null; latest: Deployment }[];
  mayManage: boolean;
  busy: boolean;
  answer: { ok: boolean; text: string } | null;
  people: ReadonlyMap<string, string>;
  onTest: () => void;
  onChange: () => void;
}) {
  return (
    <Card data-research-place={e.name}>
      <CardContent className={styles.cardBody}>
        <div className={styles.line}>
          <PlaceIcon kind="research" />
          <b>{e.name}</b>
          {e.protected && <Badge variant="warning">{t('protected')}</Badge>}
          {mayManage && (
            <span className={own.placeActions}>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onTest} data-research-test>
                {busy ? t('asking') : t('test')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onChange} data-research-change>
                {t('change')}
              </Button>
            </span>
          )}
        </div>
        <span className={styles.muted}>
          {t('research_project')} <code>{e.research_project ?? '—'}</code> ·{' '}
          {e.research_hardware ? (
            <>
              {t('hardware')} <code>{e.research_hardware}</code>
            </>
          ) : (
            t('hardware_default')
          )}
        </span>
        {answer && (
          <div className={answer.ok ? styles.answerOk : styles.error} data-environment-answer>
            {answer.text}
          </div>
        )}
        {apps.length === 0 ? (
          <span className={styles.muted}>{t('nothing_runs')}</span>
        ) : (
          apps.map((a) => (
            <div key={a.projectId} className={styles.stack} data-research-application={a.projectName}>
              <DeploymentLine d={a.runs ?? a.latest} showProject people={people} />
              {a.runs && <StatusButton d={a.runs} research />}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
