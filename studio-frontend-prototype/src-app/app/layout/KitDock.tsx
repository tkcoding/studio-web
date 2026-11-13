/**
 * The shell's sidebar slot: where a kit docks a panel beside the screen
 * (Studio AI, the built-in kit `assistant`, is the first). The shell owns the
 * slot and nothing in it — ADR-0068: everything outside the shell is a kit.
 *
 * A panel is docked only once the installer has said its kit is installed
 * where the person is (`useInstalledKits`); while that is unknown, or the kit
 * is not installed, there is no panel at all — not a disabled one. Uninstalling
 * takes it away, installing brings it, the portal is not rebuilt for either.
 *
 * The panel draws its own footprint (a rail, or a column); the slot only
 * shrink-wraps it. Over the editor it is hidden but stays mounted, so the
 * conversation survives a trip into the IDE — the prototype also gave the IDE
 * the whole width.
 */

import React, { useEffect, useRef } from 'react';
import {
  useAppSelector,
  useDomainExtensions,
  useFrontX,
  ExtensionDomainSlot,
  sidebarDomain,
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_ACTION_UNMOUNT_EXT,
  type Extension,
  type ExtensionPresentation,
} from '@gears-frontx/react';
import { executeAndSettle } from '@/app/mfe/shellOutcomes';
import { MFE_BOOTSTRAP_SLICE_KEY, type MfeBootstrapState } from '@/app/slices/mfeBootstrapSlice';
import { EDITOR_SESSION_SLICE_KEY, type EditorSessionState } from '@/app/slices/editorSessionSlice';
import { useInstalledKits } from './useInstalledKits';

/** What the shell reads off a sidebar extension (`extension_sidebar.v1.json`). */
export type SidebarExtension = Extension & {
  presentation?: ExtensionPresentation & { kit?: string; order?: number };
};

/**
 * The panel to dock: of the sidebar extensions whose kit is installed here, the
 * lowest `order`. None while the installed kits are unknown, and none for an
 * extension that names no kit (the sidebar is never the shell's own).
 */
export function dockedExtension(
  extensions: readonly SidebarExtension[],
  installed: ReadonlySet<string> | null
): SidebarExtension | null {
  if (!installed) return null;
  const docked = extensions
    .filter((extension) => {
      const kit = extension.presentation?.kit;
      return !!kit && installed.has(kit);
    })
    .sort((a, b) => (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0));
  return docked[0] ?? null;
}

export const KitDock: React.FC = () => {
  const app = useFrontX();
  const registry = app.mfeRegistry ?? null;
  const ready = useAppSelector(
    (state) => (state[MFE_BOOTSTRAP_SLICE_KEY] as MfeBootstrapState | undefined)?.status === 'ready'
  );
  const editorShown = useAppSelector(
    (state) => (state[EDITOR_SESSION_SLICE_KEY] as EditorSessionState | undefined)?.shown ?? false
  );
  const extensions = useDomainExtensions(sidebarDomain.id) as SidebarExtension[];
  const installed = useInstalledKits();
  const docked = ready ? dockedExtension(extensions, installed) : null;
  const dockedId = docked?.id ?? null;
  const mountedId = useRef<string | null>(null);

  useEffect(() => {
    if (!registry || mountedId.current === dockedId) return;
    const previous = mountedId.current;
    mountedId.current = dockedId;
    if (dockedId) {
      // Mounting replaces whatever the optional domain held.
      void executeAndSettle(registry, {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: sidebarDomain.id,
        payload: { subject: dockedId },
      }).catch((error: unknown) => {
        console.warn('[KitDock] the docked panel did not mount:', error);
        if (mountedId.current === dockedId) mountedId.current = null;
      });
    } else if (previous) {
      void registry.executeActionsChain({
        action: { type: FRONTX_ACTION_UNMOUNT_EXT, target: sidebarDomain.id, payload: { subject: previous } },
      });
    }
  }, [registry, dockedId]);

  if (!registry) return null;
  return (
    <aside
      className={docked && !editorShown ? 'flex h-full min-h-0 flex-none' : 'hidden'}
      aria-hidden={!docked || editorShown}
      data-kit-dock={docked?.presentation?.kit ?? ''}
    >
      <ExtensionDomainSlot registry={registry} domainId={sidebarDomain.id} className="h-full" />
    </aside>
  );
};

KitDock.displayName = 'KitDock';
