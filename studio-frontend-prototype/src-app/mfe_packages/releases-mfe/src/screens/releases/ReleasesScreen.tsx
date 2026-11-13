/**
 * Project › Releases (ADR-0056 §4), the prototype's ProjectReleases
 * (releases-tab.tsx at 00828880) carried over as the built-in kit
 * `product-releases` (ADR-0069 §5): how the project's product goes out.
 *
 *   - The header says where the product stands, read from the ladder
 *     (releaseStatus), with Deploy to…: one dialog listing every target,
 *     Constructor Research among them where its kit applies (#1053).
 *   - The path to running (#1050): Specs → Product → Build → Image →
 *     Environment → Running, each step's state, reason, checklist and one
 *     action (ProjectPath.tsx); a failed step its cause (#1054).
 *   - A deploy the address names (`&deployment=`, the Inbox's link) opens
 *     by itself, with its cause and log (DeploymentDetail.tsx).
 *   - Then the steps, as tabs: Build, Deploy and History. It opens on the
 *     step that is next -- Build until something is published, then Deploy
 *     -- unless the member picked another for the project before.
 *   - Build: Build in CI and the product's builds (Builds.tsx).
 *   - Deploy: the ladder -- the environments the project may deploy to in
 *     `promote_from` order, each with what runs there, how its newest deploy
 *     went, whether one waits for approval, and the action that applies
 *     (Ladder.tsx); Deploy… opens under a row the rest an environment's
 *     deploys need: deploy a build, roll back, uninstall, decide, previews,
 *     the release's values and secrets (DeployActions.tsx). Folded under it,
 *     which profile each environment runs (Bindings.tsx).
 *   - History: every deploy of the project (History.tsx).
 *
 * A build is published in Studio, the IDE or CI; a deploy names it and the
 * server installs it with the environment's connection (ADR-0048). What the
 * prototype had here and this kit does not yet is in docs/parity.md.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { useSharedProperty } from '@gears-frontx/react';
import { Badge, Button, Skeleton, Tabs, TabsList, TabsTrigger } from '@gears-frontx/ui-kit';
import { STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, isNotFound, openScreen, useHostChrome } from '@constructor-studio/mfe-shared';
import type { Deployment, PathAction, ProjectPath, ProjectTargets } from '../../api/types';
import { deploymentFromSearch, pathSteps, type Intent, type SpecsSeen } from '../../model/path';
import { DeployDialog } from './DeployDialog';
import { DeploymentDetail } from './DeploymentDetail';
import { ProjectPathView } from './ProjectPath';
import { ideBuildsOf, type IdeBuild } from '../../model/builds';
import { deploysHint } from '../../model/pipeline';
import { deployableBuilds } from '../../model/project-deploys';
import { ladderSteps, releaseStatus } from '../../model/releases';
import { useReleasesTranslations } from '../../i18n';
import { ProjectBindings } from './Bindings';
import { ProjectBuilds } from './Builds';
import { EnvironmentActions, EnvironmentConfig, EnvironmentPreviews } from './DeployActions';
import { DeployHistory } from './History';
import { ReleaseLadder } from './Ladder';
import { NextLine } from './NextLine';
import {
  ErrorLine,
  ReleasesProvider,
  TONE_BADGE,
  errText,
  useApi,
  useReleases,
  type ReleasesContextValue,
} from './parts';
import styles from './ReleasesScreen.module.css';

/** The steps of a release, as Releases' tabs. */
type ReleaseTab = 'build' | 'deploy' | 'history';
const TABS: ReleaseTab[] = ['build', 'deploy', 'history'];

/** The tab this member last picked for the project; storage may be missing
 *  or refuse, which is only a convenience lost. */
const tabKey = (projectId: string) => `studio.releases.tab.${projectId}`;
function storedTab(projectId: string): ReleaseTab | null {
  try {
    const t = window.localStorage.getItem(tabKey(projectId));
    return t && (TABS as string[]).includes(t) ? (t as ReleaseTab) : null;
  } catch {
    return null;
  }
}
function storeTab(projectId: string, t: ReleaseTab) {
  try {
    window.localStorage.setItem(tabKey(projectId), t);
  } catch {
    // Not remembered; the tabs still work.
  }
}

/** The project in scope, from the shell's shared property. */
function useProjectId(): string | null {
  const project = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);
  return typeof project === 'string' && project ? project : null;
}

export const ReleasesScreen: React.FC<{ bridge: ChildMfeBridge | null }> = ({ bridge }) => {
  const { containerRef, dataTheme, language } = useHostChrome();
  const { t, loading } = useReleasesTranslations();
  const projectId = useProjectId();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-project-releases>
      {loading ? (
        <Skeleton className={styles.skeleton} />
      ) : !projectId ? (
        <p className={styles.muted}>{t('no_project')}</p>
      ) : (
        // Keyed by the project: another project is another read, from nothing.
        <ProjectReleases
          key={projectId}
          projectId={projectId}
          base={{ t, language, projectId, organizationId: '', container: containerRef, bridge }}
        />
      )}
    </div>
  );
};

ReleasesScreen.displayName = 'ReleasesScreen';

/** The screen's context, with the project's organization once its targets say it. */
function ProjectReleases({ projectId, base }: { projectId: string; base: ReleasesContextValue }) {
  const [organizationId, setOrganizationId] = useState('');
  return (
    <ReleasesProvider value={{ ...base, organizationId }}>
      <Releases projectId={projectId} onOrganization={setOrganizationId} />
    </ReleasesProvider>
  );
}

/** The deploy the address names, read once as the screen opens. */
function addressedDeployment(): string | null {
  try {
    return deploymentFromSearch(window.location.search);
  } catch {
    return null;
  }
}

function Releases({ projectId, onOrganization }: { projectId: string; onOrganization: (id: string) => void }) {
  const { t, bridge } = useReleases();
  const api = useApi();
  const [path, setPath] = useState<ProjectPath | null>(null);
  const [specs, setSpecs] = useState<SpecsSeen>('unavailable');
  // Deploy to…: closed, or open on an environment or the Research target.
  const [dialog, setDialog] = useState<{ environmentId: string | null; research: boolean } | null>(null);
  // The deploy opened by itself: the address's, or one a step or a cause named.
  const [shown, setShown] = useState<string | null>(addressedDeployment);
  const [targets, setTargets] = useState<ProjectTargets | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [builds, setBuilds] = useState<IdeBuild[]>([]);
  // When the screen last read: what "lost" and "took" are measured against.
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Bumped to read again: after a change, and while a build runs.
  const [round, setRound] = useState(0);
  // The environment whose Deploy… is open; none until the reader opens one.
  const [open, setOpen] = useState<string | null>(null);
  // The tab the member picked; none until they pick one, and the step that is next shows.
  const [picked, setPicked] = useState<ReleaseTab | null>(() => storedTab(projectId));
  const pick = (tab: ReleaseTab) => {
    setPicked(tab);
    storeTab(projectId, tab);
  };
  const changed = useCallback((message: string) => {
    setNotice(message);
    setRound((r) => r + 1);
  }, []);
  const follow = useCallback(() => setRound((r) => r + 1), []);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.targets({ projectId }).fetch({ staleTime: 0 }),
      api
        .deployments({ projectId })
        .fetch({ staleTime: 0 })
        .catch(() => ({ items: [] as Deployment[], total: 0 })),
      api
        .nodes({ projectId, type: 'build', limit: 200, sort: 'updated' })
        .fetch({ staleTime: 0 })
        .then((p) => ideBuildsOf(p.nodes ?? []))
        .catch(() => [] as IdeBuild[]),
      // The path to running; an older backend has none and the screen goes on without it.
      api
        .projectPath({ projectId })
        .fetch({ staleTime: 0 })
        .catch(() => null),
      api
        .specPlan({ projectId })
        .fetch({ staleTime: 0 })
        .then((p): SpecsSeen => ({ count: p.total ?? p.items?.length ?? 0 }))
        .catch((): SpecsSeen => 'unavailable'),
    ])
      .then(([tg, d, b, pt, sp]) => {
        if (!live) return;
        setNow(Date.now());
        setTargets(tg);
        setDeployments(d.items);
        setBuilds(b);
        setPath(pt);
        setSpecs(sp);
        onOrganization(tg.organization_id);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setNow(Date.now());
        if (isNotFound(e)) setUnavailable(true);
        else setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, projectId, round, onOrganization]);

  const envName = (id: string) => targets?.environments.find((x) => x.environment.id === id)?.environment.name ?? id;
  const steps = targets ? ladderSteps(targets.environments, deployments, builds) : [];
  const noEnvironment = !!targets && targets.environments.length === 0;
  const published = deployableBuilds(builds).length;
  const status = targets ? releaseStatus(steps, published) : null;

  const tabs: ReleaseTab[] = unavailable ? ['build', 'deploy'] : TABS;
  // What is next: build until something is published, then deploy it.
  const next: ReleaseTab | null = targets || unavailable || error ? (published === 0 ? 'build' : 'deploy') : null;
  const tab = picked && tabs.includes(picked) ? picked : next;

  // What a path step's or a cause's button does here.
  const onIntent = (intent: Intent, action: Partial<PathAction>) => {
    switch (intent.kind) {
      case 'screen':
        openScreen(bridge, intent.route);
        return;
      case 'tab':
        pick(intent.tab);
        if (intent.tab === 'deploy' && action.environment_id) setOpen(action.environment_id);
        return;
      case 'deploy':
        setDialog({ environmentId: intent.environmentId, research: intent.research });
        return;
      case 'deployment':
        setShown(intent.id);
        return;
      case 'url':
        window.open(intent.url, '_blank', 'noopener,noreferrer');
        return;
      default:
    }
  };

  const tabStatus = (x: ReleaseTab): string => {
    if (x === 'build') return published > 0 ? t.count('status_build_published', published) : t('status_build_none');
    if (x === 'deploy')
      return noEnvironment
        ? t('status_deploy_no_environment')
        : steps.some((s) => !!s.runs)
          ? t('status_deploy_running')
          : published === 0
            ? t('status_deploy_once_published')
            : t('status_deploy_newest');
    return deployments.length ? t.count('status_history', deployments.length) : t('nothing_deployed');
  };

  return (
    <div className={styles.stack}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <div className={styles.chips} data-release-status>
          {status ? (
            status.map((c) => (
              <Badge key={c.text} variant={TONE_BADGE[c.tone]}>
                {c.text}
              </Badge>
            ))
          ) : unavailable ? (
            <Badge variant="secondary">{t('no_environments_here')}</Badge>
          ) : (
            !error && <span className={styles.muted}>{t('reading')}</span>
          )}
        </div>
        {targets && (
          <Button size="sm" onClick={() => setDialog({ environmentId: null, research: false })} data-deploy-to>
            {t('deploy_to')}
          </Button>
        )}
      </header>
      <p className={styles.about}>{t('about')}</p>
      {shown && <DeploymentDetail key={shown} id={shown} onClose={() => setShown(null)} onIntent={onIntent} />}
      {path && (
        <ProjectPathView
          steps={pathSteps(path, specs)}
          current={path.current}
          specsCount={specs === 'unavailable' ? null : specs.count}
          onIntent={onIntent}
        />
      )}
      {dialog && targets && (
        <DeployDialog
          environments={targets.environments.map((x) => x.environment)}
          builds={builds}
          path={path}
          focus={dialog}
          onClose={() => setDialog(null)}
          onChanged={changed}
          onIntent={onIntent}
        />
      )}
      {targets && published > 0 && (
        <NextLine
          hint={deploysHint({
            environments: targets.environments.length,
            bound: targets.bindings.length,
            deployable: published,
            deployments,
          })}
        />
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
      {notice && (
        <div className={styles.notice} role="status" data-deploy-notice>
          {notice}
        </div>
      )}
      {tab && (
        <Tabs value={tab} onValueChange={(v) => pick(v as ReleaseTab)}>
          <TabsList variant="line" aria-label={t('tabs_label')} data-release-tabs>
            {tabs.map((x) => (
              <TabsTrigger key={x} value={x} data-release-tab={x} data-release-tab-next={x === next || undefined}>
                {t(`tab_${x}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {tab && (
        <div className={styles.stack} data-step={tab}>
          <p className={styles.muted} data-release-tab-status>
            {tabStatus(tab)}
          </p>
          {tab === 'build' && (
            <ProjectBuilds
              ideBuilds={builds}
              environments={targets?.environments.map((x) => x.environment) ?? []}
              deployments={deployments}
              round={round}
              now={now}
              onChanged={changed}
              onFollow={follow}
            />
          )}
          {tab === 'deploy' &&
            (unavailable ? (
              <p className={styles.muted}>{t('no_environments_backend')}</p>
            ) : targets === null ? (
              !error && <p className={styles.muted}>{t('loading')}</p>
            ) : noEnvironment ? (
              <section className={styles.card}>
                <p className={styles.muted}>{t('no_environment')}</p>
              </section>
            ) : (
              <ReleaseLadder
                steps={steps}
                bindings={targets.bindings}
                open={open}
                onOpen={(id) => setOpen(open === id ? null : id)}
                onChanged={changed}
                panel={(s) => (
                  <section className={styles.stack} data-release-step={s.environment.name}>
                    <div className={styles.headRow}>
                      <h3 className={styles.subTitle}>{s.environment.name}</h3>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                        {t('close')}
                      </Button>
                    </div>
                    <EnvironmentActions
                      env={s.environment}
                      latest={s.latest ?? undefined}
                      deployments={deployments}
                      builds={builds}
                      envName={envName}
                      onChanged={changed}
                    />
                    <EnvironmentPreviews env={s.environment} deployments={deployments} onChanged={changed} />
                    <EnvironmentConfig
                      key={`${s.environment.id}-${round}`}
                      env={s.environment}
                      bindings={targets.bindings}
                      secrets={targets.secrets ?? []}
                      onChanged={changed}
                    />
                  </section>
                )}
              />
            ))}
          {tab === 'deploy' && targets && !noEnvironment && (
            // Folded: the exception, not the way a release goes (ADR-0056 §1).
            <details className={styles.card} data-project-own-environments>
              <summary className={styles.summary}>
                <b>{t('own_environments')}</b> <span className={styles.muted}>{t('own_environments_sub')}</span>
              </summary>
              <ProjectBindings key={round} targets={targets} onSaved={() => changed(t('bindings_saved'))} />
            </details>
          )}
          {tab === 'history' && <DeployHistory deployments={deployments} />}
        </div>
      )}
    </div>
  );
}
