import { AccountsApiService } from '@constructor-studio/mfe-shared';

// @cpt-dod:cpt-studiofrontend-dod-project-create-write:p1
// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-project-parent:p1
// @cpt-dod:cpt-studiofrontend-dod-project-create-announce:p1
// @cpt-algo:cpt-studiofrontend-algo-project-create-write:p2
// @cpt-flow:cpt-studiofrontend-flow-project-create-greenfield:p1
// @cpt-flow:cpt-studiofrontend-flow-project-create-modernize:p1
import {
  apiRegistry,
  eventBus,
  invalidateQueryCacheForApp,
  type AppDispatch,
  type FrontXApp,
} from '@gears-frontx/react';
import { refusalFrom } from '@constructor-studio/mfe-shared';
import {
  ProjectStatusApiService,
  type CreateProjectBody,
  type ProjectCreation,
} from '../api/ProjectStatusApiService';
import { MAX_SOURCES, type ProjectDraft } from '../model/projectDraft';
import { submitFailed, submitProgress, submitStarted } from '../slices/createSlice';
import type { ProjectRef } from '../events/wizardEvents';
import '../events/wizardEvents';

/**
 * A project is created by the server as one background run
 * (`POST /studio-organizations/v1/project-creations`): the tenant, its
 * configuration (mode, brief, owner, the workspace's required stages, the
 * picked repositories as sources) and, with a brief, its PRD. The wizard used
 * to make each of those a request of its own -- the tenant, then the stage
 * catalogue, then the metadata -- and a failure between them left half a
 * project. Now it starts the run, shows its steps as they end, and announces
 * the project once the run has succeeded. The run is also in the
 * organization's Background work.
 */

/** How often the run is read while it works. */
export const POLL_MS = 1500;
/** How long the dialog follows a run before it leaves it to Background work. */
export const FOLLOW_MS = 10 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the server is asked for: the draft, in the route's words. */
export function creationBody(workspaceId: string, draft: ProjectDraft, key: string): CreateProjectBody {
  const body: CreateProjectBody = {
    workspace_id: workspaceId,
    name: draft.name.trim(),
    mode: draft.mode ?? 'greenfield',
    idempotency_key: key,
  };
  if (draft.goal.trim()) body.brief = draft.goal.trim();
  if (draft.ownerId) body.owner_id = draft.ownerId;
  const sources = draft.sources.slice(0, MAX_SOURCES);
  if (sources.length > 0)
    body.sources = sources.map((s) => ({
      connection_id: s.connectionId,
      full_path: s.fullPath,
      clone_url: s.cloneUrl,
      ...(s.defaultBranch ? { default_branch: s.defaultBranch } : {}),
    }));
  return body;
}

const progressOf = (c: ProjectCreation) => ({ runId: c.run_id, state: c.state, steps: c.steps });

/** The key the last submit was sent with, and what it was for. */
let lastKey: { of: string; key: string } | null = null;

/** One key per project asked for: the same draft sent again (Create after a
 *  failure) is the same project, and the server continues its run where it
 *  stopped; another draft is another project. */
export function keyFor(workspaceId: string, draft: ProjectDraft): string {
  const of = JSON.stringify([workspaceId, draft]);
  if (lastKey?.of !== of) lastKey = { of, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
  return lastKey.key;
}

export function initWizardEffects(dispatch: AppDispatch, app: FrontXApp): void {
  eventBus.on('mfe/projects/create-requested', ({ workspaceId, draft }) => {
    const accounts = apiRegistry.getService(AccountsApiService);
    const orgs = apiRegistry.getService(ProjectStatusApiService);

    // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-1
    const name = draft.name.trim();
    if (!name) return;
    // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-1

    dispatch(submitStarted());

    void (async () => {
      /**
       * The announcement carries the switcher's whole list, so the workspace's
       * projects are read here — fresh, with the new one already in them — and
       * the cached page the list screen draws is dropped in the same breath.
       */
      const announceCreated = async (projectId: string): Promise<void> => {
        const children = accounts.getProjects({ parentId: workspaceId });
        const siblings = await children
          .fetch({ staleTime: 0 })
          .then((page) => page.items.map((tenant): ProjectRef => ({ id: tenant.id, name: tenant.name })))
          .catch((error: unknown) => {
            console.warn('[projects] created, siblings not read', error);
            return [] as ProjectRef[];
          });
        void invalidateQueryCacheForApp(app, children);
        eventBus.emit('mfe/projects/created', {
          project: { id: projectId, name },
          siblings,
          workspaceId,
        });
      };

      let run: ProjectCreation;
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-2
        run = await orgs.createProject.fetch(creationBody(workspaceId, draft, keyFor(workspaceId, draft)));
        // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-2
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-3
        // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-4
        dispatch(submitFailed(refusalFrom(error, 'error_create')));
        return;
        // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-3
        // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-4
      }
      dispatch(submitProgress(progressOf(run)));

      // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-5
      const until = Date.now() + FOLLOW_MS;
      while (run.state === 'queued' || run.state === 'running') {
        if (Date.now() > until) {
          dispatch(submitFailed({ kind: 'i18n', key: 'error_still_running' }));
          return;
        }
        await wait(POLL_MS);
        try {
          const read = await orgs
            .creation({ runId: run.run_id, organizationId: run.organization_id })
            .fetch({ staleTime: 0 });
          // A run not started yet answers no steps: keep the planned ones.
          run = { ...read, project_id: read.project_id || run.project_id, steps: read.steps.length ? read.steps : run.steps };
          dispatch(submitProgress(progressOf(run)));
        } catch (error) {
          // A blip in reading is not the run failing: read again.
          console.warn('[projects] creation not read', error);
        }
      }
      // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-5

      if (run.state !== 'succeeded') {
        // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-6
        // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-7
        dispatch(
          submitFailed(run.error ? { kind: 'provider', text: run.error } : { kind: 'i18n', key: 'error_create' })
        );
        return;
        // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-6
        // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-7
      }

      // @cpt-begin:cpt-studiofrontend-algo-project-create-write:p2:inst-8
      await announceCreated(run.project_id);
      // @cpt-end:cpt-studiofrontend-algo-project-create-write:p2:inst-8
    })();
  });
}
