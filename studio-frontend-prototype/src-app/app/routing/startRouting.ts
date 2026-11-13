/**
 * Where the shell starts listening to its address (ADR-0028, "Start-up and
 * the first report").
 *
 * Called once the screen slot is attached and every built-in manifest is
 * registered. The history is resolved lazily here — after `AuthGate` has
 * scrubbed the OIDC callback with its own `replaceState` — so no write is ever
 * made behind the library's back. The observer's first report is synchronous,
 * and `materialize` mounts from it at once.
 *
 * A kit's screens arrive later, at run time (`mfe/runtimeKits.ts`, issue
 * #1006): every time the runtime kits register or unregister something, the
 * screen groups are read again from the registry and the address is applied
 * again — the observer reads `getRegistrations` afresh at each resolution, so
 * it needs no notice of its own. The runtime kits beginning or settling a
 * scope applies the address again too: an address waiting for a kit's screen
 * opens it, or is called unknown, then.
 */
import { screenDomain, type FrontXApp } from '@gears-frontx/react';
import {
  resolveNavigationHistory,
  type ExtensionToken,
  type NavigationHistory,
  type RouteSignal,
} from '@gears-frontx/routing';
import type { ContextCatalogs } from '@/app/effects/contextCatalogs';
import type { EditorSession } from '@/app/effects/editorSessionEffects';
import { runtimeKitsOf } from '@/app/mfe/runtimeKits';
import { createMaterializer } from './materialize';
import { createShellNavigation, type ShellNavigation } from './navigation';
import { SCREEN_DOMAIN_KEY } from './route';
import { groupScreens, type ScreenGroup } from './screenTokens';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';

export interface RoutingHandle {
  navigation: ShellNavigation;
  groups(): readonly ScreenGroup[];
  materialize(): void;
  /** Applies the address again after the screen slot re-attached, forgetting a mount that failed. */
  retry(): void;
  release(): void;
}

export function startRouting(
  app: FrontXApp,
  catalogs: ContextCatalogs,
  history: NavigationHistory = resolveNavigationHistory(),
  session?: Pick<EditorSession, 'sync'>
): RoutingHandle {
  const registry = app.mfeRegistry;
  if (!registry) throw new Error('[routing] the MFE registry is not available on the app');

  const navigation = createShellNavigation(history);
  const readGroups = () => groupScreens(registry.getExtensionsForDomain(screenDomain.id) as StudioScreenExtension[]);
  let groups = readGroups();
  const kits = runtimeKitsOf(registry);
  const materializer = createMaterializer({
    app,
    navigation,
    groups: () => groups,
    catalogs,
    session,
    runtime: kits,
  });

  const source: Parameters<RouteSignal['createObserver']>[1] = {
    getRegistrations: () =>
      groups.map((group) => ({ extension: group.token as ExtensionToken, routeOwner: group })),
  };
  const releaseObserver = navigation.createObserver(SCREEN_DOMAIN_KEY, source, () => materializer.transition());

  let seen = kits.revision();
  const releaseKits = kits.subscribe(() => {
    const now = kits.revision();
    if (now !== seen) {
      seen = now;
      groups = readGroups();
    }
    materializer.materialize();
  });

  return {
    navigation,
    groups: () => groups,
    materialize: materializer.materialize,
    retry: materializer.retry,
    release: () => {
      releaseKits();
      releaseObserver();
    },
  };
}
