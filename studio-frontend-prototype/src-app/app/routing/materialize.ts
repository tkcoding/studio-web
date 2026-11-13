/**
 * The address becomes the shell's state (ADR-0028).
 *
 * Idempotent by construction: every step compares the address with the slice
 * and the mounted screen and changes only what differs. When the state it
 * reached says something other than the address — a default filled, an id
 * refused — it writes the normalized route with `replace`. A converged state
 * writes nothing, which is what makes the library's echo of the shell's own
 * write harmless. This is the only writer of `org`, `workspace`, `project`,
 * `section` and `artifact`, and the only caller of `mountScreen`.
 */
import { screenDomain, type FrontXApp, type MfeRegistry } from '@gears-frontx/react';
import { TENANT_TYPES, errorMessage, isStudioArtifactKind, type StudioArtifact } from '@constructor-studio/mfe-shared';
import {
  answersSection,
  entryPointOf,
  isAboveWorkspace,
  levelOf,
  sectionOf,
  type ScreenLevel,
  type StudioScreenExtension,
} from '@/app/mfe/screenLevels';
import { occupancyOf } from '@/app/mfe/domainOccupancy';
import { mountScreen } from '@/app/mfe/mountScreen';
import { runtimeKitsOf, runtimeScopeKey } from '@/app/mfe/runtimeKits';
import { publishStudioContext } from '@/app/mfe/sharedContext';
import {
  closeContextProject,
  openContextProject,
  readAppContext,
  rememberProject,
  setContextArtifact,
  setContextOrg,
  setContextSection,
  setContextWorkspace,
} from '@/app/slices/appContextSlice';
import type { ContextCatalogs } from '@/app/effects/contextCatalogs';
import type { EditorSession } from '@/app/effects/editorSessionEffects';
import { EDITOR_SCREEN_TOKEN, routesEqual, type ShellRoute } from './route';
import { groupOfExtension, groupOfToken, type ScreenGroup } from './screenTokens';
import type { ShellNavigation } from './navigation';
import { unresolvedScreenOf } from './unresolvedScreen';

/** How long an address waits for the kits of its scope before it is called unknown anyway. */
export const RUNTIME_SCREEN_WAIT_MS = 20_000;

/** The level an address implies when no screen answers to it: as deep as it names. */
function impliedLevel(route: ShellRoute): ScreenLevel {
  if (route.project) return 'project';
  if (route.workspace) return 'workspace';
  return 'organization';
}

/**
 * The screen an address of `group` opens. A group's members usually share one
 * micro-frontend, which switches by the published section, and the group's
 * owner is mounted for all of them. A kit may add a tab under a token another
 * micro-frontend owns (project-activity's `/projects/activity`,
 * project-team's `/projects/team`): that member is mounted itself, or the
 * owner would draw a section it has never heard of.
 */
export function screenFor(
  group: ScreenGroup,
  level: ScreenLevel,
  section: string | undefined
): StudioScreenExtension {
  const target =
    section === undefined
      ? undefined
      : group.members.find((member) => levelOf(member) === level && answersSection(member, section));
  return target && target.entry !== group.owner.entry ? target : group.owner;
}

// @cpt-dod:cpt-studiofrontend-dod-shell-levels-artifact-address:p1
function artifactOf(route: ShellRoute): StudioArtifact | null {
  if (!route.artifact || !isStudioArtifactKind(route.kind)) return null;
  return {
    artifactId: route.artifact,
    repository: route.repository ?? '',
    path: route.path ?? '',
    kind: route.kind,
  };
}

function sameArtifact(held: StudioArtifact | null, wanted: StudioArtifact | null): boolean {
  if (!held || !wanted) return held === wanted;
  return (
    held.artifactId === wanted.artifactId &&
    held.repository === wanted.repository &&
    held.path === wanted.path &&
    held.kind === wanted.kind
  );
}

export interface MaterializerDeps {
  app: FrontXApp;
  navigation: ShellNavigation;
  groups: () => readonly ScreenGroup[];
  catalogs: ContextCatalogs;
  warn?: (message: string) => void;
  session?: Pick<EditorSession, 'sync'>;
  /**
   * The kits' screens registered at run time (`mfe/runtimeKits.ts`). With it,
   * an address no screen answers to keeps its place: it waits until the kits
   * of its scope are registered, then is shown as unknown (`unresolvedScreen.ts`).
   * Without it no screen can arrive later, and such an address falls back to
   * the organization's entry point.
   */
  runtime?: { isSettled(scope: string): boolean };
  /** {@link RUNTIME_SCREEN_WAIT_MS} unless a test says otherwise. */
  waitMs?: number;
}

export interface Materializer {
  materialize(): void;
  /**
   * The observer's report that the address changed. A new visit: a mount that
   * did not happen in the previous one may be tried again, and a mount still
   * running from it is about a place the person has left.
   */
  transition(): void;
  /**
   * Forgets a mount that failed and applies the address again, asking for its
   * screen even while that still counts as mounted — for when the screen slot
   * has re-attached.
   */
  retry(): void;
}

export function createMaterializer(deps: MaterializerDeps): Materializer {
  const { app, navigation, catalogs } = deps;
  const warn = deps.warn ?? ((text: string) => console.warn(text));
  const dispatch = app.store.dispatch;
  const resolving = new Set<string>();
  /**
   * Counts the address transitions the observer has reported. A mount
   * remembers the visit it started in, so a failure is judged against the
   * visit it belongs to — not against a hash of the route, which a quick
   * there-and-back reproduces (reviewer finding).
   */
  let visit = 0;
  /** The visit whose mount did not happen, so it is not tried again until the address changes — a catalog arriving is not that. */
  let stuckIn: number | null = null;
  /** The entry point a failed mount fell back to, so its own failure is not fallen back from — once (ADR-0028). */
  let fallbackTo: string | null = null;
  /** The visit whose editor had nothing to open and nowhere to go, so that is said once per address. */
  let editorStrandedIn: number | null = null;
  /** The visit an unanswered address started waiting in, so its time limit is set once. */
  let waitingIn: number | null = null;
  /** The visit whose wait ran out: its address is unknown even if the kits never settle. */
  let waitedOutIn: number | null = null;
  /** The visit whose address was found unknown, so that is said once per address. */
  let unknownIn: number | null = null;

  const screensOf = (registry: MfeRegistry): StudioScreenExtension[] =>
    registry.getExtensionsForDomain(screenDomain.id) as StudioScreenExtension[];

  /** The route of a level's entry point, carrying the context that level shows. */
  const entryRoute = (registry: MfeRegistry, level: ScreenLevel, from: ShellRoute | null): ShellRoute | null => {
    const entry = entryPointOf(screensOf(registry), level);
    const group = entry ? groupOfExtension(deps.groups(), entry.id) : undefined;
    if (!group) return null;
    const context = readAppContext(app);
    const route: ShellRoute = { token: group.token };
    const org = from?.org ?? context.org?.id;
    if (org) route.org = org;
    if (!isAboveWorkspace(level)) {
      const workspace = from?.workspace ?? context.workspace?.id;
      if (workspace) route.workspace = workspace;
    }
    return route;
  };

  const resolveLater = (projectId: string, workspaceId: string | undefined, orgId: string | undefined): void => {
    if (resolving.has(projectId)) return;
    resolving.add(projectId);
    void catalogs.resolveProject(projectId).then((lookup) => {
      resolving.delete(projectId);
      const current = navigation.currentRoute();
      if (current?.project !== projectId) return;
      if (current.org !== orgId || current.workspace !== workspaceId) {
        // Asked in one scope, answered in another: the pass for the scope that
        // is current now asks again, and judges the answer against itself.
        materialize();
        return;
      }
      // A read that failed says nothing about the project: the address keeps
      // it, the MFE has its id already, and the next pass asks again.
      if (lookup === 'unavailable') return;
      const tenant = lookup;
      // Every workspace sits under the organization too, so the type has to
      // say project before the parent is looked at.
      if (tenant === null || tenant.tenant_type !== TENANT_TYPES.project) {
        warn(`Project ${projectId} is not a project this person can read; closing it`);
        navigation.navigate({ ...current, project: undefined, section: undefined }, 'replace');
        materialize();
        return;
      }
      // A project may sit under its workspace or straight under the organization
      // (the wizard does the latter).
      if (tenant.parent_id !== workspaceId && (orgId === undefined || tenant.parent_id !== orgId)) {
        const home = readAppContext(app).workspaces.find((workspace) => workspace.id === tenant.parent_id);
        if (!home) {
          warn(`Project ${projectId} is not in workspace ${workspaceId ?? '(none)'}; closing it`);
          navigation.navigate({ ...current, project: undefined, section: undefined }, 'replace');
          materialize();
          return;
        }
        // Under another workspace of this organization: the project id is the
        // more specific fact — a link may name the project alone, and the
        // workspace in the route is then the shell's own default — so the
        // address moves to the project's workspace instead of refusing it.
        // The pass that write triggers opens it there and reads its name.
        navigation.navigate({ ...current, workspace: home.id }, 'replace');
        materialize();
        return;
      }
      dispatch(rememberProject({ id: tenant.id, name: tenant.name }));
      materialize();
    });
  };

  /**
   * Whether the screen domain already shows `target`: the extension itself,
   * or another member of its group in the same micro-frontend, which switches
   * by the section it is published (the owner answers its group's sections).
   */
  const isMounted = (registry: MfeRegistry, group: ScreenGroup, target: StudioScreenExtension): boolean => {
    const [mountedId] = occupancyOf(registry).mounted(screenDomain.id);
    if (!mountedId) return false;
    if (mountedId === target.id) return true;
    const mounted = group.members.find((member) => member.id === mountedId);
    return mounted !== undefined && mounted.entry === target.entry;
  };

  // @cpt-begin:cpt-studiofrontend-flow-shell-levels-descend:p1:inst-7
  const mountFailed = (
    registry: MfeRegistry,
    group: ScreenGroup,
    target: StudioScreenExtension,
    reason: string
  ): void => {
    // The requests of one visit join one runtime entry and fail together: the
    // first has already said so and stuck the visit or moved the address.
    if (stuckIn === visit || navigation.currentRoute()?.token !== group.token) return;
    // The runtime keeps the cause to itself, so this names what was asked for.
    const { id, presentation } = target;
    // A kit's screen loaded at run time (ADR-0068 phase 5) says so on its tile.
    runtimeKitsOf(registry).mountFailed(id, reason);
    warn(
      `Screen "${group.token}" (${id} at ${presentation.route}) did not mount (${reason}); not trying again until the address changes`
    );
    // @cpt-begin:cpt-studiofrontend-flow-shell-levels-descend:p1:inst-8
    const current = navigation.currentRoute();
    const level = levelOf(target);
    const fallback = fallbackTo === group.token ? null : entryRoute(registry, level, current);
    // A project's screen falls back to the project's entry point, in the
    // project: not to the workspace's list with the project dropped.
    if (fallback && level === 'project' && current?.project) fallback.project = current.project;
    // Under the same token the entry point is another screen only when the
    // one that failed is a kit's tab in a micro-frontend of its own.
    if (!fallback || (fallback.token === group.token && target.id === group.owner.id)) {
      // The level's entry point did not mount either, or there is none to fall
      // back to: nothing is mounted, the warning above has said so, and this
      // visit is not tried again. The next address starts afresh.
      stuckIn = visit;
      fallbackTo = null;
      return;
    }
    // The fallback changes the address, so nothing is stuck: the entry point
    // gets its one attempt, in the pass the write triggers or in this one.
    fallbackTo = fallback.token;
    navigation.navigate(fallback, 'replace');
    materialize();
    // @cpt-end:cpt-studiofrontend-flow-shell-levels-descend:p1:inst-8
  };
  // @cpt-end:cpt-studiofrontend-flow-shell-levels-descend:p1:inst-7

  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-click:p1:inst-7
  const mount = (registry: MfeRegistry, group: ScreenGroup, target: StudioScreenExtension): void => {
    if (stuckIn === visit) return;
    const startedIn = visit;
    void mountScreen(registry, target).then(
      () => {
        // A mount from a visit the person has left, done or replaced, says
        // nothing about this one: the current address only gets its own pass.
        if (startedIn !== visit) return materialize();
        if (isMounted(registry, group, target)) {
          fallbackTo = null;
          stuckIn = null;
          materialize();
          return;
        }
        mountFailed(registry, group, target, 'the actions chain did not complete');
      },
      (error: unknown) =>
        startedIn !== visit ? materialize() : mountFailed(registry, group, target, errorMessage(error))
    );
  };
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-click:p1:inst-7

  const transition = (): void => {
    visit += 1;
    materialize();
  };

  const retry = (): void => {
    stuckIn = null;
    fallbackTo = null;
    // A screen counts as mounted until its release from the old root ends, and
    // nothing asks for it after that. The runtime answers a mounted screen at
    // once and makes a new mount wait out a release.
    pass(true);
  };

  /** Whether a kit's screen may still be registered for `route`'s scope in this visit. */
  const mayStillArrive = (route: ShellRoute): boolean => {
    if (!deps.runtime || waitedOutIn === visit) return false;
    const scope = runtimeScopeKey({ project: route.project, org: route.org });
    return scope !== null && !deps.runtime.isSettled(scope);
  };

  /**
   * An address no registered screen answers to, with runtime kits about
   * (issue #1006). While the kits of its scope are still being registered it
   * waits — a cold deep link to a kit's screen lands here before the kit's
   * screens are registered, and opens once they are (the registration makes
   * `startRouting` apply the address again). Once they are registered, or the
   * wait runs out, it is unknown. Either way the address is kept: installing
   * the kit and coming back, or reloading, opens it.
   */
  const holdUnresolved = (registry: MfeRegistry, route: ShellRoute, level: ScreenLevel): void => {
    const store = unresolvedScreenOf(registry);
    const scope = runtimeScopeKey({ project: route.project, org: route.org });
    const settled = scope !== null && deps.runtime?.isSettled(scope) === true;
    if (!settled && waitedOutIn !== visit) {
      store.set({ token: route.token, status: 'waiting', level });
      if (waitingIn !== visit) {
        waitingIn = visit;
        const startedIn = visit;
        setTimeout(() => {
          if (visit !== startedIn) return;
          waitedOutIn = startedIn;
          materialize();
        }, deps.waitMs ?? RUNTIME_SCREEN_WAIT_MS);
      }
      return;
    }
    if (unknownIn !== visit) {
      unknownIn = visit;
      warn(`No screen answers to "${route.token}" here: no installed kit brings it`);
    }
    store.set({ token: route.token, status: 'unknown', level });
  };

  /** One pass over the address; `remount` asks for its screen even while that counts as mounted. */
  const pass = (remount: boolean): void => {
    const registry = app.mfeRegistry;
    if (!registry) return;
    const groups = deps.groups();
    if (groups.length === 0) return;
    if (readAppContext(app).access === 'unassigned') return;

    const address = navigation.currentRoute();
    let route = address;
    let group = route ? groupOfToken(groups, route.token) : undefined;
    if (!route || (!group && !deps.runtime)) {
      if (route) warn(`No screen answers to "${route.token}"; opening the organization level instead`);
      // Substituted, not written yet: the pass below fills the defaults and
      // writes the whole normalized route once, and mounts in the same pass.
      route = entryRoute(registry, 'organization', null);
      group = route ? groupOfToken(groups, route.token) : undefined;
      if (!route || !group) return;
    }
    // From here `group` is undefined only for an address a kit's screen may
    // still answer (issue #1006): its context is applied like any other, and
    // the screen waits for the kits of that scope (`holdUnresolved`).

    const wanted: ShellRoute = { ...route };
    const next: ShellRoute = { token: route.token };
    const ownerLevel = group ? levelOf(group.owner) : impliedLevel(route);

    // Organization: validated only once the person's list is known.
    let context = readAppContext(app);
    if (context.orgs.length > 0) {
      if (wanted.org && !context.orgs.some((org) => org.id === wanted.org)) {
        warn(`Organization ${wanted.org} is not one of yours; staying in the current one`);
        wanted.org = undefined;
        wanted.workspace = undefined;
        wanted.project = undefined;
        wanted.section = undefined;
      }
      wanted.org ??= context.org?.id ?? context.orgs[0]?.id;
      if (wanted.org && wanted.org !== context.org?.id) dispatch(setContextOrg(wanted.org));
    }
    if (wanted.org) next.org = wanted.org;

    // The organization's workspaces are wanted at every level: an organization-
    // level screen still publishes the default workspace to the MFEs.
    context = readAppContext(app);
    if (context.org && context.workspacesStatus === 'pending') catalogs.loadWorkspaces(context.org.id);

    // Workspace: below the organization the address names it; at the
    // organization level the address carries none and the slice's choice is
    // the preference the next descent starts from (ADR-0028). Either way it
    // is checked against the list once that is known, and defaulted from it —
    // the catalog reducers keep or drop a selection, they never pick one.
    if (isAboveWorkspace(ownerLevel)) wanted.workspace = undefined;
    if (context.workspacesStatus === 'ready') {
      if (wanted.workspace && !context.workspaces.some((workspace) => workspace.id === wanted.workspace)) {
        warn(`Workspace ${wanted.workspace} is not in this organization; opening the first one`);
        wanted.workspace = undefined;
        wanted.project = undefined;
        wanted.section = undefined;
      }
      wanted.workspace ??= context.workspace?.id ?? context.workspaces[0]?.id;
      if (wanted.workspace && wanted.workspace !== context.workspace?.id) dispatch(setContextWorkspace(wanted.workspace));
    }

    // Project: only a screen below the organization carries it.
    // @cpt-begin:cpt-studiofrontend-algo-shell-levels-click:p1:inst-4
    if (!isAboveWorkspace(ownerLevel)) {
      if (wanted.workspace) next.workspace = wanted.workspace;

      context = readAppContext(app);
      if (wanted.project) {
        // Carried in the address while the workspace list is still on its way,
        // whether or not the address named a workspace — a link may name the
        // project alone. Opened once the list can vouch for the workspace, or
        // say the organization has none and the project sits straight under it.
        next.project = wanted.project;
        if (context.workspacesStatus === 'ready') {
          const known = context.projects.find((project) => project.id === wanted.project);
          if (context.project?.id !== wanted.project) {
            dispatch(openContextProject(known ?? { id: wanted.project, name: '' }));
          } else if (known && context.project.name !== known.name) {
            dispatch(openContextProject(known));
          }
          if (!known) resolveLater(wanted.project, next.workspace, next.org);
          // The siblings for the switcher, asked for while nobody has read
          // them; a read that failed is not asked again on every pass.
          if (next.workspace && context.projectsStatus === 'pending') catalogs.loadProjects(next.workspace);
        }
      } else if (context.project) {
        dispatch(closeContextProject());
      }
    } else if (readAppContext(app).project) {
      dispatch(closeContextProject());
    }
    // @cpt-end:cpt-studiofrontend-algo-shell-levels-click:p1:inst-4

    // Section: of the level in scope, defaulting to that level's entry item.
    // @cpt-begin:cpt-studiofrontend-algo-shell-levels-click:p1:inst-2
    const levelInScope: ScreenLevel = next.project ? 'project' : ownerLevel;
    const inScope = (group?.members ?? []).filter((member) => levelOf(member) === levelInScope);
    const sections = inScope
      .map((member) => sectionOf(member))
      .filter((section): section is string => section !== undefined);
    /** The address names a section a kit not registered yet may bring to this group: it waits for it. */
    let sectionWaits = false;
    if (sections.length > 0) {
      // A member may answer a family of sections (`type:` for the tabs the
      // Studio domain model adds, ADR-0066).
      const wantedSection = wanted.section;
      if (wantedSection && !inScope.some((member) => answersSection(member, wantedSection))) {
        if (mayStillArrive(next)) {
          // A cold deep link to a kit's tab under a token the shell already
          // has (`/projects/<kit section>`): kept until the kits of the scope
          // are registered, then judged like any other section.
          sectionWaits = true;
        } else {
          warn(`"${wanted.section}" is not a section of ${route.token}; opening its first one`);
          wanted.section = undefined;
        }
      }
      const entry = entryPointOf(group?.members ?? [], levelInScope);
      next.section = wanted.section ?? (entry ? sectionOf(entry) : undefined) ?? sections[0];
      if (!sectionWaits && readAppContext(app).section !== next.section) dispatch(setContextSection(next.section));
    } else if (!group && wanted.section) {
      // Nobody can say yet whether it is a section of the screen being waited for: kept.
      next.section = wanted.section;
    } else if (readAppContext(app).section !== null) {
      dispatch(setContextSection(null));
    }

    // Artifact: only the editor, and only inside a project, carries one.
    const isEditor = group?.token === EDITOR_SCREEN_TOKEN;
    const artifact = next.project && isEditor ? artifactOf(wanted) : null;
    if (artifact) {
      next.artifact = artifact.artifactId;
      next.repository = artifact.repository;
      next.path = artifact.path;
      next.kind = artifact.kind;
    } else if (group && isEditor) {
      const level: ScreenLevel = next.project ? 'project' : 'workspace';
      const reason = !next.project
        ? 'The editor needs a project'
        : wanted.artifact && !artifactOf(wanted)
          ? `Artifact ${wanted.artifact} is not one the editor can open`
          : 'The editor has nothing to open';
      const fallback = entryRoute(registry, level, next);
      if (fallback && fallback.token !== group.token) {
        warn(`${reason}; opening the ${level} entry point instead`);
        if (next.project) fallback.project = next.project;
        navigation.navigate(fallback, 'replace');
        materialize();
        return;
      }
      if (editorStrandedIn !== visit) {
        warn(`${reason}, and the ${level} level has no entry point to fall back to`);
        editorStrandedIn = visit;
      }
    } else if (wanted.artifact) {
      warn(`Artifact ${wanted.artifact} belongs on the editor, not on ${route.token}; dropping it`);
    }
    if (!sameArtifact(readAppContext(app).artifact, artifact)) dispatch(setContextArtifact(artifact));

    publishStudioContext(app);
    // @cpt-end:cpt-studiofrontend-algo-shell-levels-click:p1:inst-2

    // @cpt-dod:cpt-studiofrontend-dod-editor-session-reuse-or-launch:p1
    deps.session?.sync({
      projectId: next.project ?? null,
      orgId: next.org ?? null,
      editor: isEditor && next.project !== undefined,
      artifact,
    });

    if (!routesEqual(next, address)) navigation.navigate(next, 'replace');

    if (!group || sectionWaits) {
      holdUnresolved(registry, next, group ? levelInScope : ownerLevel);
      return;
    }
    unresolvedScreenOf(registry).set(null);

    // @cpt-begin:cpt-studiofrontend-algo-shell-levels-click:p1:inst-3
    // @cpt-begin:cpt-studiofrontend-algo-shell-levels-click:p1:inst-6
    const target = screenFor(group, levelInScope, next.section);
    if (remount || !isMounted(registry, group, target)) mount(registry, group, target);
    // @cpt-end:cpt-studiofrontend-algo-shell-levels-click:p1:inst-6
    // @cpt-end:cpt-studiofrontend-algo-shell-levels-click:p1:inst-3
  };

  const materialize = (): void => pass(false);

  return { materialize, transition, retry };
}
