/**
 * Named slots: where a kit contributes into a screen it does not own
 * (ADR-0068 §2 "`section` in a screen", issue #1006).
 *
 * The contract:
 *
 * - **A slot is a domain the shell registers.** One FrontX extension domain
 *   per named slot (`SHELL_SLOTS`), with the concurrent mount strategy: every
 *   contribution gets its own container, side by side. A kit cannot add a
 *   slot (a runtime package declares no domains); it contributes to the ones
 *   the shell has, and a package naming a domain the shell does not have is
 *   refused (`mfe/runtimeKits.ts`).
 * - **A contribution is an extension in that domain**, of the type
 *   `KIT_SLOT_EXTENSION_TYPE` (`schemas/extension_slot_contribution.v1.json`),
 *   whose entry is an ordinary Module Federation entry. Its `presentation`:
 *   `label` (what a failure names), `order` (ascending, then id; undeclared
 *   last), `kit` (shown only where that kit is installed — set by the shell
 *   for a runtime kit), and optionally `level` (only at that level) and
 *   `screen` (only with the screen at that route, e.g. `/projects/overview`).
 * - **What a contribution is told**: the slot domains declare the same
 *   shared properties as the overlay domain plus the section and the live
 *   event — theme, language, organization, workspace, project, section,
 *   person, last studio event. An entry asking for anything else is refused
 *   at registration.
 * - **Isolation**: each contribution mounts on its own action chain into its
 *   own shadow root; one that fails to load or mount is replaced by a small
 *   note naming it (`layout/KitSlot.tsx`) and put on the runtime kit tile,
 *   and the others are untouched. It is not mounted again until its
 *   registration changes (an upgrade) or it leaves and comes back.
 * - **Lifecycle**: a contribution of a kit that is uninstalled is
 *   unregistered with the rest of the kit, and the runtime releases it; an
 *   upgraded one is mounted again at its new revision.
 *
 * The slots the shell draws:
 *
 * | Slot | Where | Typical contribution |
 * |---|---|---|
 * | `project.header.status` | beside the open project in the path bar | a status chip (ADR-0068 §3's example) |
 * | `screen.toolbar.actions` | the end of the level's tab row | an action button for the level or one screen |
 * | `screen.panels` | above the screen, for the screen it names | a panel on Project › Overview |
 *
 * A slot inside a micro-frontend's own page (between two of its cards) is not
 * here: that needs the screen to host a domain in its shadow root, which
 * FrontX 0.4 nested hosts do not offer to Studio's screens yet.
 */

import type { Extension, ExtensionPresentation } from '@gears-frontx/react';
import { UNDECLARED_ORDER, type ScreenLevel } from '@/app/mfe/screenLevels';

/** The type every slot contribution is an instance of (its schema is in `schemas/`). */
export const KIT_SLOT_EXTENSION_TYPE =
  'gts.frontx.mfes.ext.extension.v1~constructor_studio.shell.slots.contribution.v1~';

const slotDomain = (name: string) => `gts.frontx.mfes.ext.domain.v1~constructor_studio.shell.slots.${name}.v1`;

export const SHELL_SLOTS = {
  projectHeaderStatus: { name: 'project.header.status', domainId: slotDomain('project_header_status') },
  screenToolbarActions: { name: 'screen.toolbar.actions', domainId: slotDomain('screen_toolbar_actions') },
  screenPanels: { name: 'screen.panels', domainId: slotDomain('screen_panels') },
} as const;

export type ShellSlot = (typeof SHELL_SLOTS)[keyof typeof SHELL_SLOTS];

export interface SlotPresentation extends ExtensionPresentation {
  label: string;
  kit?: string;
  level?: string;
  /** The route of the screen the contribution goes with. */
  screen?: string;
}

export type SlotContribution = Extension & { presentation?: SlotPresentation };

/** Where a slot is drawn now. */
export interface SlotPlace {
  level: ScreenLevel;
  /** The route of the item on screen (its section's, when it has one). */
  screenRoute: string | null;
  /** The kits installed here; `null` while unknown, which hides nothing. */
  installed: ReadonlySet<string> | null;
}

export function orderOf(extension: SlotContribution): number {
  return extension.presentation?.order ?? UNDECLARED_ORDER;
}

/** The contributions that show at `place`, in their order. */
export function slotContributions(extensions: readonly SlotContribution[], place: SlotPlace): SlotContribution[] {
  return extensions
    .filter((extension) => {
      const presentation = extension.presentation;
      if (presentation?.kit && place.installed !== null && !place.installed.has(presentation.kit)) return false;
      if (presentation?.level && presentation.level !== place.level) return false;
      if (presentation?.screen && presentation.screen !== place.screenRoute) return false;
      return true;
    })
    .sort((a, b) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id));
}
