/**
 * Organization › Infrastructure (ADR-0056 §2), the prototype's
 * OrgInfrastructure (environments-screen.tsx at 00828880) carried over
 * (ADR-0069 §5): where the organization's products run.
 *
 *   - The places it holds -- clusters, Constructor Research projects,
 *     registries -- as one grid of cards, each with its test, whether it is
 *     open to projects (ADR-0054 §2), its readiness on demand and the
 *     environments on it. A place's details open in a side panel, where an
 *     environment is added, changed, tested and removed, a registry is
 *     browsed and what runs there is read from the cluster.
 *   - The environments as the ladder a release climbs, dev to prod.
 *   - What runs where, with the deploys waiting for a decision.
 *   - For an administrator: the namespaces projects were given, and the
 *     organization's image retention.
 *
 * A deploy itself is asked for from a project's Releases (or the desktop),
 * which builds and pushes the images; the server installs it with the
 * environment's connection. The sentences the models compose (problems,
 * deploy states, readiness, retention, registry words) stay English.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry, type ChildMfeBridge } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyActions,
  EmptyHeader,
  EmptyTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@gears-frontx/ui-kit';
import { AccountsApiService, isNotFound, openScreen, useHostChrome, useOrganization } from '@constructor-studio/mfe-shared';
import { ChevronDown, Lock, MoreHorizontal } from 'lucide-react';
import type { Connection, DeployEnvironment, Deployment } from '../../api/types';
import {
  awaitingDecision,
  clusterCards,
  clusterConnections,
  namespaceFor,
  registryConnections,
  registryHost,
  researchConnections,
  type ClusterCard,
} from '../../model/environments';
import { databaseWord, ladderOrder, whatRunsWhere } from '../../model/releases';
import { researchKitApplies } from '../../model/research';
import { useInfrastructureTranslations } from '../../i18n';
import { AddCluster, AddRegistry } from './AddPlace';
import { EnvironmentForm, type ProjectRef } from './EnvironmentForm';
import { NamespaceAssignments, OrgRetention } from './Namespaces';
import { RegistryBrowser } from './RegistryBrowser';
import { WhatRunsWhere } from './WhatRunsWhere';
import {
  Confirm,
  DeploymentLine,
  InfraProvider,
  PlaceIcon,
  PlaceReadiness,
  StatusButton,
  errText,
  useApi,
  useInfra,
  usePeople,
  type PlaceKind,
  type Text,
} from './parts';
import styles from './InfrastructureScreen.module.css';

export const InfrastructureScreen: React.FC<{ bridge: ChildMfeBridge | null }> = ({ bridge }) => {
  const { org, loading: orgLoading } = useOrganization();
  const { containerRef, dataTheme, language } = useHostChrome();
  const { t, loading } = useInfrastructureTranslations();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-org-infrastructure>
      {loading || orgLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : !org ? (
        <p className={styles.muted}>{t('no_org')}</p>
      ) : (
        <InfraProvider value={{ t, language, org, container: containerRef }}>
          {/* Keyed by the organization: another organization is another read, from nothing. */}
          <OrgInfrastructure
            key={org.id}
            onOpenConnections={() => openScreen(bridge, '/connections')}
            onOpenKits={() => openScreen(bridge, '/organization-kits')}
          />
        </InfraProvider>
      )}
    </div>
  );
};

InfrastructureScreen.displayName = 'InfrastructureScreen';

/** One place as the page holds it: what it is and the environments on it (or,
 *  for a registry, those that pull from it). */
interface Place {
  /** The connection's id; "" for environments on a cluster this page cannot see. */
  id: string;
  kind: PlaceKind;
  label: string;
  baseUrl: string;
  environments: DeployEnvironment[];
  card: ClusterCard | null;
}

/** How a place answered its test; absent: still asking. */
interface Health {
  state: 'checking' | 'ok' | 'bad';
  text: string;
}

type Tab = 'ladder' | 'where' | 'namespaces' | 'retention';

/** "Add a place ▾": the one way a place is added, whatever its kind. A
 *  Research project comes with the Constructor Research kit: without it the
 *  entry says so and opens the organization's kits. */
function AddPlaceMenu({ onPick, researchKit }: { onPick: (kind: PlaceKind) => void; researchKit: boolean }) {
  const { t, container } = useInfra();
  const item = (kind: PlaceKind, sub: string) => (
    <DropdownMenuItem key={kind} onClick={() => onPick(kind)} data-add-place={kind}>
      <PlaceIcon kind={kind} />
      <span className={styles.menuItem}>
        <b>{t(`kind_${kind}`)}</b>
        <span className={styles.muted}>{sub}</span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button data-place-add>
            {t('add_place')}
            <ChevronDown size={14} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" container={container}>
        {item('cluster', t('add_place_cluster'))}
        {item('research', researchKit ? t('add_place_research') : t('add_place_research_kit'))}
        {item('registry', t('add_place_registry'))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An environment's actions, for an administrator: Test, Change, Remove. */
function EnvironmentMenu({
  e,
  busy,
  onTest,
  onChange,
  onRemove,
}: {
  e: DeployEnvironment;
  busy: boolean;
  onTest: () => void;
  onChange: () => void;
  onRemove: () => void;
}) {
  const { t, container } = useInfra();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('environment_actions', { name: e.name })}
            icon={<MoreHorizontal size={16} strokeWidth={1.5} />}
            data-environment-menu={e.name}
          />
        }
      />
      <DropdownMenuContent align="end" container={container}>
        <DropdownMenuItem disabled={busy} onClick={onTest}>
          {busy ? t('asking') : t('test')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onChange}>{t('change')}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          {t('remove')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The organization's projects: those under its workspaces and under it. */
export function useProjects(orgId: string): { projects: ProjectRef[]; workspaceIds: string[] } {
  const [read, setRead] = useState<{ projects: ProjectRef[]; workspaceIds: string[] }>({ projects: [], workspaceIds: [] });
  useEffect(() => {
    let live = true;
    const accounts = apiRegistry.getService(AccountsApiService);
    const projectsOf = (parentId: string) =>
      accounts
        .getProjects({ parentId })
        .fetch()
        .then((p) => p.items)
        .catch(() => []);
    accounts
      .getWorkspaces({ organizationId: orgId })
      .fetch()
      .then((w) => w.items)
      .catch(() => [])
      .then(async (workspaces) => {
        const lists = await Promise.all([orgId, ...workspaces.map((w) => w.id)].map(projectsOf));
        if (!live) return;
        setRead({
          projects: lists.flat().map((p) => ({ id: p.id, name: p.name })),
          workspaceIds: workspaces.map((w) => w.id),
        });
      });
    return () => {
      live = false;
    };
  }, [orgId]);
  return read;
}

function OrgInfrastructure({ onOpenConnections, onOpenKits }: { onOpenConnections: () => void; onOpenKits: () => void }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [environments, setEnvironments] = useState<DeployEnvironment[] | null>(null);
  const [mayManage, setMayManage] = useState(false);
  const [openClusters, setOpenClusters] = useState<string[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [editing, setEditing] = useState<DeployEnvironment | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<'cluster' | 'registry' | null>(null);
  const [tab, setTab] = useState<Tab>('ladder');
  /** The place whose side panel is open. */
  const [panel, setPanel] = useState<string | null>(null);
  /** Each place's answer to a test, asked when the page opens. */
  const [health, setHealth] = useState<Record<string, Health>>({});
  /** What a Test answered, kept at the environment it was asked about. */
  const [answers, setAnswers] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [removing, setRemoving] = useState<DeployEnvironment | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** Bumped to read everything again. */
  const [round, setRound] = useState(0);
  const load = useCallback(() => setRound((n) => n + 1), []);
  const { projects, workspaceIds } = useProjects(org.id);
  const people = usePeople([org.id, ...workspaceIds]);
  /** Whether the organization has the Constructor Research kit; null until
   *  read, or when studio-kits does not answer (then nothing is held back). */
  const [researchKit, setResearchKit] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api
      .installedKits({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((kits) => live && setResearchKit(researchKitApplies(kits)))
      .catch(() => live && setResearchKit(null));
    return () => {
      live = false;
    };
  }, [api, org.id]);

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
        setOpenClusters(envs.open_clusters?.connection_ids ?? []);
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

  const clusters = useMemo(() => clusterConnections(connections), [connections]);
  const registries = useMemo(() => registryConnections(connections), [connections]);
  const researches = useMemo(() => researchConnections(connections), [connections]);
  const cards = useMemo(
    () => clusterCards([...clusters, ...researches], environments ?? [], deployments),
    [clusters, researches, environments, deployments]
  );
  // Every place in one list: clusters, Research projects, registries.
  const places: Place[] = useMemo(() => {
    const envs = environments ?? [];
    const runs: Place[] = cards.map((c) => ({
      id: c.id,
      kind:
        researches.some((r) => r.id === c.id) || (c.id === '' && c.environments.every((e) => e.kind === 'research'))
          ? 'research'
          : 'cluster',
      label: c.id === '' ? t('unseen_cluster') : c.label,
      baseUrl: c.baseUrl,
      environments: c.environments,
      card: c,
    }));
    const pulls: Place[] = registries.map((r) => ({
      id: r.id,
      kind: 'registry',
      label: r.label,
      baseUrl: r.base_url ?? '',
      environments: envs.filter((e) => e.registry_connection_id === r.id),
      card: null,
    }));
    return [...runs, ...pulls];
  }, [cards, registries, researches, environments, t]);

  const test = useCallback(
    (id: string) =>
      api
        .testConnection(id, org.id)
        .fetch(undefined)
        .then((answer): Health => {
          // A cluster that answers but lacks the bootstrap's rights still
          // answers: say what it may not do, so a build is not the first to.
          const missing = (answer.checks ?? []).filter((c) => !c.ok);
          const text = missing.length
            ? t('may_not', {
                account: answer.account,
                rights: missing.map((c) => c.name).join(', '),
                detail: missing[0].detail,
              })
            : answer.account;
          return { state: 'ok', text };
        })
        .catch((e: unknown): Health => ({ state: 'bad', text: errText(e) })),
    [api, org.id, t]
  );
  // Every cluster and registry is asked once when the page opens, so the
  // cards say at a glance which answer. A Research sign-in is a member's own
  // and is tested from Connections.
  const testedIds = [...clusters, ...registries].map((c) => c.id).join(',');
  useEffect(() => {
    if (!testedIds) return;
    let live = true;
    for (const id of testedIds.split(','))
      void test(id).then((h) => live && setHealth((all) => ({ ...all, [id]: h })));
    return () => {
      live = false;
    };
  }, [testedIds, test]);
  const testAgain = (id: string) => {
    setHealth((all) => ({ ...all, [id]: { state: 'checking', text: t('checking') } }));
    void test(id).then((h) => setHealth((all) => ({ ...all, [id]: h })));
  };
  /** A place's answer: a cluster or registry not answered yet is being asked. */
  const healthOf = (p: Place): Health | null =>
    !p.id
      ? { state: 'bad', text: t('out_of_reach') }
      : p.kind === 'research'
        ? null
        : (health[p.id] ?? { state: 'checking', text: t('checking') });

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  // "Open to projects", saved as soon as it is switched (ADR-0054 §2).
  const setOpen = async (id: string, on: boolean) => {
    const next = on ? [...new Set([...openClusters, id])] : openClusters.filter((c) => c !== id);
    const before = openClusters;
    setOpenClusters(next);
    setBusy(`open:${id}`);
    try {
      setOpenClusters((await api.saveOpenClusters(org.id).fetch({ connection_ids: next })).connection_ids);
    } catch (e) {
      setOpenClusters(before);
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

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

  const remove = async (e: DeployEnvironment) => {
    setBusy(e.id);
    setRemoveError(null);
    setNotice(null);
    try {
      await api.deleteEnvironment(org.id, e.id).fetch(undefined);
      setRemoving(null);
      setNotice(t('removed', { name: e.name }));
      load();
    } catch (err) {
      setRemoveError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const waiting = awaitingDecision(deployments);
  const ladder = useMemo(() => ladderOrder(environments ?? []), [environments]);
  const runsWhere = useMemo(() => whatRunsWhere(deployments), [deployments]);
  const placeOf = (e: DeployEnvironment) =>
    places.find((p) => p.id === e.connection_id && p.kind !== 'registry') ??
    places.find((p) => p.id === '' && p.environments.includes(e));
  const envName = (id: string) => environments?.find((e) => e.id === id)?.name ?? id;
  const running = cards.reduce((n, c) => n + c.running.length, 0);
  const unanswered = places.filter((p) => healthOf(p)?.state === 'bad').length;
  const projectsWord = (e: DeployEnvironment) =>
    e.project_id
      ? t('projects_only', { name: projectName(e.project_id) })
      : e.projects
        ? t.count('projects_count', e.projects.length)
        : t('projects_every');
  const opened = places.find((p) => p.id === panel) ?? null;
  const pickPlace = (kind: PlaceKind) =>
    kind === 'research' ? (researchKit === false ? onOpenKits() : onOpenConnections()) : setAdding(kind);
  const closePanel = () => {
    setPanel(null);
    setEditing(null);
  };
  const menuFor = (e: DeployEnvironment) =>
    mayManage ? (
      <EnvironmentMenu
        e={e}
        busy={busy === e.id}
        onTest={() => void testEnvironment(e)}
        onChange={() => {
          setPanel(placeOf(e)?.id ?? e.connection_id);
          setEditing(e);
        }}
        onRemove={() => {
          setRemoveError(null);
          setRemoving(e);
        }}
      />
    ) : null;
  const confirmRemove = removing && (
    <Confirm
      title={t('remove_confirm', { name: removing.name })}
      body={t('remove_body')}
      confirmLabel={t('remove')}
      busy={busy === removing.id}
      error={removeError}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void remove(removing)}
    />
  );
  const answer = (id: string) =>
    answers[id] ? (
      <div className={answers[id].ok ? styles.answerOk : styles.error} data-environment-answer>
        {answers[id].text}
      </div>
    ) : null;

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <div className={styles.chips}>
          {environments === null ? (
            <Badge variant="info">{t('reading')}</Badge>
          ) : (
            <>
              <span className={styles.muted} data-infra-count>
                {t.count('count_places', places.length)} · {t.count('count_environments', ladder.length)} ·{' '}
                {t('count_running', { count: running })}
              </span>
              {waiting.length > 0 && (
                <button type="button" className={styles.chip} onClick={() => setTab('where')} data-deploys-awaiting-count>
                  <Badge variant="warning" dot>
                    {t.count('waiting_count', waiting.length)}
                  </Badge>
                </button>
              )}
              {unanswered > 0 && (
                <Badge variant="danger" dot data-not-answering>
                  {t.count('not_answering', unanswered)}
                </Badge>
              )}
            </>
          )}
        </div>
        {mayManage && (
          <div className={styles.headerAction}>
            <AddPlaceMenu onPick={pickPlace} researchKit={researchKit !== false} />
          </div>
        )}
      </header>
      <div className={styles.about}>
        <p>{t('about', { org: org.name })}</p>
        <p>{t('about_deploys')}</p>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}
      {adding === 'cluster' && (
        <AddCluster
          onCancel={() => setAdding(null)}
          onAdded={(c) => {
            setAdding(null);
            setNotice(t('connected', { name: c.label }));
            setPanel(c.id);
            load();
          }}
        />
      )}
      {adding === 'registry' && (
        <AddRegistry
          onCancel={() => setAdding(null)}
          onAdded={(c) => {
            setAdding(null);
            setNotice(t('connected', { name: c.label }));
            setConnections((cs) => [...cs, c]);
          }}
        />
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList variant="line" aria-label={t('tabs_label')}>
          <TabsTrigger value="ladder" data-infra-tab="ladder">
            {t('tab_environments')}
          </TabsTrigger>
          <TabsTrigger value="where" data-infra-tab="where">
            {t('tab_where')}
            {waiting.length > 0 && <Badge variant="warning">{waiting.length}</Badge>}
          </TabsTrigger>
          {mayManage && (
            <TabsTrigger value="namespaces" data-infra-tab="namespaces">
              {t('tab_namespaces')}
            </TabsTrigger>
          )}
          {mayManage && (
            <TabsTrigger value="retention" data-infra-tab="retention">
              {t('tab_retention')}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {tab === 'namespaces' && mayManage ? (
        <NamespaceAssignments environments={environments ?? []} projects={projects} people={people} />
      ) : tab === 'retention' && mayManage ? (
        <OrgRetention />
      ) : tab === 'where' ? (
        <WhatRunsWhere
          waiting={waiting}
          ladder={ladder}
          rows={environments === null ? null : runsWhere}
          mayManage={mayManage}
          people={people}
          onDecided={(text) => {
            setNotice(text);
            load();
          }}
        />
      ) : (
        <Card data-environment-ladder data-infra-environments>
          <CardContent className={styles.cardBody}>
            {environments === null ? (
              <p className={styles.hint}>{t('loading')}</p>
            ) : ladder.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('no_environment')}</EmptyTitle>
                </EmptyHeader>
                {mayManage && places.some((p) => p.kind !== 'registry' && p.id) && (
                  <EmptyActions>
                    <Button
                      variant="outline"
                      onClick={() => setPanel(places.find((p) => p.kind !== 'registry' && p.id)!.id)}
                    >
                      {t('open_a_place')}
                    </Button>
                  </EmptyActions>
                )}
              </Empty>
            ) : (
              <ol className={styles.ladder} aria-label={t('ladder_label')}>
                {ladder.map((e, i) => {
                  const place = placeOf(e);
                  const pending = waiting.filter((d) => d.environment_id === e.id).length;
                  const before = i > 0 ? ladder[i - 1] : null;
                  return (
                    <li key={e.id} className={styles.rung} data-ladder-environment={e.name}>
                      <div className={styles.rungHead}>
                        <b>{e.name}</b>
                        {e.protected && (
                          <span className={styles.lock} title={t('protected_title')} aria-label={t('needs_approval')}>
                            <Lock size={13} />
                          </span>
                        )}
                        {e.strictness && e.strictness !== (e.protected ? 'prod' : 'dev') && (
                          <Badge
                            variant={e.strictness === 'dev' ? 'warning' : 'info'}
                            title={t(e.strictness === 'dev' ? 'strictness_dev_title' : 'strictness_prod_title')}
                            data-rung-strictness={e.strictness}
                          >
                            {t('strictness_checks', { strictness: e.strictness })}
                          </Badge>
                        )}
                        {pending > 0 && (
                          <button type="button" className={styles.chip} onClick={() => setTab('where')} data-rung-pending>
                            <Badge variant="warning">{t('to_decide', { count: pending })}</Badge>
                          </button>
                        )}
                        <span className={styles.grow} />
                        {menuFor(e)}
                      </div>
                      {place ? (
                        <button
                          type="button"
                          className={styles.placeChip}
                          onClick={() => setPanel(place.id)}
                          data-rung-place={place.kind}
                        >
                          <PlaceIcon kind={place.kind} size={13} />
                          {place.label}
                        </button>
                      ) : (
                        <span className={styles.muted}>{t('place_unseen')}</span>
                      )}
                      <div className={styles.muted}>
                        {projectsWord(e)} · {databaseWord(e)}
                        {e.promote_from && e.promote_from !== before?.id && (
                          <> · {t('takes_from', { name: envName(e.promote_from) })}</>
                        )}
                        {!e.promote_from && i > 0 && <> · {t('takes_any')}</>}
                      </div>
                      {answer(e.id)}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      <h3 className={styles.part} data-infra-places>
        {t('places')}
      </h3>
      {environments !== null && places.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('no_place')}</EmptyTitle>
          </EmptyHeader>
          {mayManage && (
            <EmptyActions>
              <AddPlaceMenu onPick={pickPlace} researchKit={researchKit !== false} />
            </EmptyActions>
          )}
        </Empty>
      ) : (
        <div className={styles.places} data-clusters data-registries>
          {places.map((p) => {
            const h = healthOf(p);
            const isOpen = openClusters.includes(p.id);
            return (
              <Card
                key={`${p.kind}:${p.id}`}
                className={`${styles.place}${panel === p.id ? ` ${styles.placeOn}` : ''}${p.id ? '' : ` ${styles.unseen}`}`}
                data-place={p.label}
                data-place-kind={p.kind}
              >
                <CardContent className={styles.placeBody}>
                  <button
                    type="button"
                    className={styles.placeOpen}
                    onClick={() => setPanel(p.id)}
                    aria-label={t('open_place', { name: p.label })}
                  >
                    <span className={styles.placeTop}>
                      <PlaceIcon kind={p.kind} />
                      <b>{p.label}</b>
                      {h && <span className={`${styles.dot} ${styles[`dot_${h.state}`]}`} aria-hidden />}
                    </span>
                    <span className={styles.muted}>
                      {t(`kind_${p.kind}`)}
                      {p.baseUrl
                        ? ` · ${p.kind === 'registry' ? registryHost(p.baseUrl) || p.baseUrl : p.baseUrl.replace(/^https?:\/\//, '')}`
                        : ''}
                    </span>
                    <span className={`${styles.health} ${h ? styles[`health_${h.state}`] : ''}`} data-place-health={h?.state}>
                      {h ? h.text : t('research_own_signin')}
                    </span>
                  </button>
                  <div className={styles.chipRow}>
                    {p.environments.length === 0 ? (
                      <span className={styles.muted}>
                        {p.kind === 'registry' ? t('no_environment_pulls') : t('no_environment_on')}
                      </span>
                    ) : (
                      p.environments.map((e) => (
                        <Badge key={e.id} variant={e.protected ? 'warning' : 'secondary'}>
                          {e.protected && <Lock size={11} />}
                          {e.name}
                        </Badge>
                      ))
                    )}
                  </div>
                  {p.kind === 'cluster' && p.id && p.environments.length > 0 && (
                    <PlaceReadiness environments={p.environments} />
                  )}
                  {p.kind === 'cluster' && p.id && (
                    <label className={styles.toggle} title={t('open_to_projects_title')}>
                      <Switch
                        size="sm"
                        checked={isOpen}
                        disabled={!mayManage || busy === `open:${p.id}`}
                        onCheckedChange={(on) => void setOpen(p.id, on)}
                        data-open-cluster={p.label}
                      />
                      {t('open_to_projects')}
                    </label>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={!!opened} onOpenChange={(open) => !open && closePanel()}>
        {opened && (
          <PlacePanel
            place={opened}
            health={healthOf(opened)}
            onTestAgain={() => testAgain(opened.id)}
            openToProjects={openClusters.includes(opened.id)}
            mayManage={mayManage}
            editing={editing}
            onAdd={() => setEditing('new')}
            form={
              editing !== null && opened.kind !== 'registry' ? (
                <EnvironmentForm
                  key={editing === 'new' ? `new:${opened.id}` : editing.id}
                  editing={editing === 'new' ? null : editing}
                  others={environments ?? []}
                  clusters={clusters}
                  registries={registries}
                  researches={researches}
                  projects={projects}
                  initialCluster={editing === 'new' ? opened.id : editing.connection_id}
                  onCancel={() => setEditing(null)}
                  onDone={() => {
                    setEditing(null);
                    load();
                  }}
                  onClusterAdded={(c) => setConnections((cs) => [...cs, c])}
                />
              ) : null
            }
            exampleProject={projects[0]?.name ?? 'Studio Web'}
            projectsWord={projectsWord}
            menuFor={menuFor}
            answer={answer}
            people={people}
            confirm={confirmRemove}
            t={t}
          />
        )}
      </Sheet>

      {/* Asked from the ladder here; asked from a place's panel, inside it, so
          the panel stays open beneath the question. */}
      {!opened && confirmRemove}
    </>
  );
}

/** A place's side panel: what it is and how it answered, the environments on
 *  it (added and changed here), a registry's contents and what runs there. */
function PlacePanel({
  place,
  health,
  onTestAgain,
  openToProjects,
  mayManage,
  editing,
  onAdd,
  form,
  exampleProject,
  projectsWord,
  menuFor,
  answer,
  people,
  confirm,
  t,
}: {
  place: Place;
  health: Health | null;
  onTestAgain: () => void;
  openToProjects: boolean;
  mayManage: boolean;
  editing: DeployEnvironment | 'new' | null;
  onAdd: () => void;
  form: React.ReactNode;
  exampleProject: string;
  projectsWord: (e: DeployEnvironment) => string;
  menuFor: (e: DeployEnvironment) => React.ReactNode;
  answer: (id: string) => React.ReactNode;
  people: ReadonlyMap<string, string>;
  /** "Remove …?", nested in the panel so the panel stays open beneath it. */
  confirm: React.ReactNode;
  t: Text;
}) {
  const { container } = useInfra();
  const card = place.card;
  const shownRuns = card ? (card.running.length ? card.running : card.deployments.slice(0, 10)) : [];
  return (
    <SheetContent side="right" container={container} closeLabel={t('close')} className={styles.sheet}>
      <section className={styles.sheetBody} data-cluster-detail={place.label} data-place-panel={place.kind}>
        <SheetHeader>
          <SheetTitle className={styles.sheetTitle}>
            <PlaceIcon kind={place.kind} size={20} />
            {place.label}
          </SheetTitle>
        </SheetHeader>
        <dl className={styles.facts}>
          <dt>{t('fact_kind')}</dt>
          <dd>{t(`kind_${place.kind}`)}</dd>
          {place.baseUrl && (
            <>
              <dt>{t('fact_address')}</dt>
              <dd>
                <code>{place.baseUrl}</code>
              </dd>
            </>
          )}
          <dt>{t('fact_check')}</dt>
          <dd>
            {health ? (
              <span className={`${styles.health} ${styles[`health_${health.state}`]}`}>{health.text}</span>
            ) : (
              <span className={styles.muted}>{t('research_each_member')}</span>
            )}{' '}
            {place.id && place.kind !== 'research' && (
              <button
                type="button"
                className={styles.link}
                disabled={health?.state === 'checking'}
                onClick={onTestAgain}
                data-place-test
              >
                {health?.state === 'checking' ? t('asking') : t('test_again')}
              </button>
            )}
          </dd>
          {place.kind === 'cluster' && place.id && (
            <>
              <dt>{t('fact_projects')}</dt>
              <dd>{openToProjects ? t('projects_may_add') : t('projects_use_org')}</dd>
            </>
          )}
        </dl>

        <div className={styles.sheetSub}>
          <h4 className={styles.subhead}>{place.kind === 'registry' ? t('envs_pull_from') : t('envs_on')}</h4>
          {mayManage && editing === null && place.id && place.kind !== 'registry' && (
            <Button size="sm" onClick={onAdd} data-environment-add>
              {t('add_environment_here')}
            </Button>
          )}
        </div>
        {form}
        {place.environments.length === 0 ? (
          editing === null && <p className={styles.muted}>{t('none_yet')}</p>
        ) : (
          <ul className={styles.list}>
            {place.environments.map((e) => (
              <li key={e.id} data-environment={e.name}>
                <div className={styles.line}>
                  <b>{e.name}</b>
                  {e.protected && <Badge variant="info">{t('needs_approval')}</Badge>}
                  <span className={`${styles.muted} ${styles.grow}`}>
                    {projectsWord(e)} · {databaseWord(e)}
                    {e.kind === 'research' ? (
                      <>
                        {' · '}
                        {t('research_project_word')} <code>{e.research_project}</code>
                      </>
                    ) : (
                      <>
                        {' · '}
                        <code>{namespaceFor(e.namespace_pattern, exampleProject, e.name)}</code>
                      </>
                    )}
                  </span>
                  {menuFor(e)}
                </div>
                {e.description && <div className={styles.muted}>{e.description}</div>}
                {answer(e.id)}
              </li>
            ))}
          </ul>
        )}

        {place.kind === 'registry' && place.id && mayManage && (
          <>
            <h4 className={styles.subhead} data-registry-contents>
              {t('registry_contents')}
            </h4>
            <RegistryBrowser connectionId={place.id} />
          </>
        )}

        {card && (
          <>
            <h4 className={styles.subhead} data-running-now>
              {t('runs_here')}
            </h4>
            {card.running.length === 0 && card.deployments.length === 0 ? (
              <p className={styles.muted}>{t('nothing_runs_here')}</p>
            ) : (
              <ul className={styles.list}>
                {shownRuns.map((d) => (
                  <li key={d.id}>
                    <DeploymentLine d={d} showProject people={people} />
                    {card.running.includes(d) && <StatusButton d={d} research={place.kind === 'research'} />}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {confirm}
      </section>
    </SheetContent>
  );
}
