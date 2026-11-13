/**
 * Runtime kits (ADR-0068 phase 5): once the shell knows the kits installed
 * where the person is, it asks `studio-kits` for their micro-frontends and
 * registers them beside the built-in screens (`mfe/runtimeKits.ts`). Installing
 * a kit shows its tab, uninstalling hides it (`screenShows`), and the portal
 * is not rebuilt for either.
 *
 * The read follows the installed-kits answer the tabs use, keyed by its
 * effective kits and versions, so installing on the Kits tab — which refreshes
 * that answer — loads the new kit's screens too, and uninstalling or upgrading
 * one unloads the old registration (`RuntimeKits.sync`). That answer is read
 * again when the live channel says a kit or the domain model changed
 * somewhere (another person, another tab).
 *
 * The scope's kits are `begin`-ed while they are read and `settle`-d once
 * they are registered or found to be none — also when either read fails — so
 * routing knows when an address naming no registered screen is really unknown.
 *
 * What did not come up is a tile above the screen, one per package, which the
 * person can dismiss; nothing else of the shell is held back by it.
 */

import React, { useEffect, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { apiRegistry, useApiQuery, useAppSelector, useFrontX } from '@gears-frontx/react';
import type { StudioEvent } from '@constructor-studio/mfe-shared';
import { InstalledKitsApiService } from '@/app/api/InstalledKitsApiService';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import { MFE_BOOTSTRAP_SLICE_KEY, setMfeBootstrapStatus, type MfeBootstrapState } from '@/app/slices/mfeBootstrapSlice';
import { runtimeKitsOf, runtimeScopeKey, type RuntimeKits as RuntimeKitsStore } from '@/app/mfe/runtimeKits';
import { useStudioEvents } from '@/app/live/useLiveChannel';
import { useShellText } from '@/app/i18n/shellTranslations';

const selectContext = (state: Record<string, unknown>) => state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined;

/**
 * Whether a live event may mean the kits installed somewhere changed: a kit
 * event, should the installer publish one, or a change of the domain model,
 * which installing a kit with a model overlay makes (ADR-0067 §6).
 */
export function mayChangeInstalledKits(event: Pick<StudioEvent, 'kind' | 'subject_type'>): boolean {
  return event.kind.startsWith('kit.') || event.subject_type === 'kit' || event.kind === 'domain.model_changed';
}

/** Loads the effective kits' micro-frontends into the registry. Renders nothing. */
export function useRuntimeKitLoader(): RuntimeKitsStore | null {
  const app = useFrontX();
  const registry = app.mfeRegistry ?? null;
  const orgId = useAppSelector((state) => selectContext(state)?.org?.id ?? null);
  const projectId = useAppSelector((state) => selectContext(state)?.project?.id ?? null);
  const ready = useAppSelector(
    (state) => (state[MFE_BOOTSTRAP_SLICE_KEY] as MfeBootstrapState | undefined)?.status === 'ready'
  );
  const scope = projectId ? { projectId } : { organizationId: orgId ?? '' };
  // The same read as the tabs' (`useInstalledKits`): one cache entry.
  const installed = useApiQuery(apiRegistry.getService(InstalledKitsApiService).installed(scope), {
    enabled: !!orgId || !!projectId,
  });
  const forScope = installed.data
    ? projectId
      ? installed.data.project_id === projectId
      : installed.data.organization_id === orgId
    : false;
  // What to load changes exactly when a kit or its version does.
  const signature = forScope
    ? (installed.data?.effective ?? [])
        .map((kit) => `${kit.kit_slug}@${kit.version ?? ''}`)
        .sort()
        .join(',')
    : null;
  const scopeKey = runtimeScopeKey({ project: projectId, org: orgId });
  const { isError, refetch } = installed;

  // A new scope's kits are unknown until they are read.
  useEffect(() => {
    if (registry && scopeKey) runtimeKitsOf(registry).begin(scopeKey);
  }, [registry, scopeKey]);

  // No answer about the installed kits: no kit screens to wait for. And none
  // about this scope at all (a switch to another organization or project
  // whose read failed): the kits registered for the scope before are not
  // this one's, so they go — they would show here, unknown hiding nothing.
  const answered = signature !== null;
  useEffect(() => {
    if (!registry || !scopeKey || !isError) return;
    const kits = runtimeKitsOf(registry);
    kits.settle(scopeKey);
    if (!answered) void kits.sync([], window.location.origin);
  }, [registry, scopeKey, isError, answered]);

  useStudioEvents((event) => {
    if (mayChangeInstalledKits(event)) void refetch();
  });

  useEffect(() => {
    if (!registry || !ready || signature === null || !scopeKey) return;
    let live = true;
    const kits = runtimeKitsOf(registry);
    const at = projectId ? { projectId } : { organizationId: orgId ?? '' };
    // The kits changed: whatever waits on this scope waits for the new answer.
    kits.begin(scopeKey);
    void (async () => {
      let items;
      try {
        items =
          (await apiRegistry.getService(InstalledKitsApiService).mfeManifests(at).fetch({ staleTime: 0 }))?.items ?? [];
      } catch (error) {
        // A backend without the route answers nothing to load: no kit screens, no tile.
        console.warn('[Runtime kits] the kits’ micro-frontends could not be listed:', error);
        if (live) kits.settle(scopeKey);
        return;
      }
      if (!live) return;
      // The desired state of this scope: new revisions replace, unlisted packages go.
      await kits.sync(items, window.location.origin);
      if (!live) return;
      kits.settle(scopeKey);
      // Registration is invisible to the store; one dispatch wakes the tabs
      // and the slots (`useDomainExtensions` re-reads the registry on any store change).
      app.store.dispatch(setMfeBootstrapStatus('ready'));
    })();
    return () => {
      live = false;
    };
  }, [app, registry, ready, signature, scopeKey, orgId, projectId]);

  return registry ? runtimeKitsOf(registry) : null;
}

const NO_FAILURES: never[] = [];

/** The loader, and a tile for each kit package that did not come up. */
export const RuntimeKits: React.FC = () => {
  const t = useShellText();
  const kits = useRuntimeKitLoader();
  const failures = useSyncExternalStore(
    (listener) => kits?.subscribe(listener) ?? (() => undefined),
    () => kits?.failures() ?? NO_FAILURES
  );
  if (failures.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 pt-3" data-runtime-kit-errors>
      {failures.map((failure) => (
        <div
          key={failure.key}
          role="alert"
          data-runtime-kit-error={failure.key}
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-label"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {failure.label
                ? t('runtime_kit_screen_failed', { screen: failure.label, kit: failure.kit })
                : t('runtime_kit_failed', { kit: failure.kit, version: failure.version })}
            </div>
            <div className="truncate text-muted-foreground" title={failure.reason}>
              {failure.reason}
            </div>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('runtime_kit_dismiss')}
            onClick={() => kits?.dismiss(failure.key)}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

RuntimeKits.displayName = 'RuntimeKits';
