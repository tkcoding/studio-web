/**
 * Screen levels
 *
 * Constructor Studio has five levels (ADR-0069): the platform above every
 * organization, the organization, a workspace, a project, and Admin — the
 * administration beside them. The tabs show the items of the level in scope
 * and nothing else. This module
 * is the whole of what the shell knows about that: how a screen extension
 * declares its level, and how the items of one level are ordered.
 */

// @cpt-dod:cpt-studiofrontend-dod-shell-levels-declared:p1
import type { ExtensionPresentation, ScreenExtension } from '@gears-frontx/react';

export const SCREEN_LEVELS = ['platform', 'organization', 'workspace', 'project', 'admin'] as const;

export type ScreenLevel = (typeof SCREEN_LEVELS)[number];

/**
 * A level whose screens carry no workspace and no project: the platform, the
 * organization and Admin. Below it the address names a workspace, and a
 * project under it.
 */
export function isAboveWorkspace(level: ScreenLevel | undefined): boolean {
  return level === 'platform' || level === 'organization' || level === 'admin';
}

/** The order of a screen that declares none: after every screen that does. */
export const UNDECLARED_ORDER = 999;

// 'hidden' is registered and mountable but never listed: a screen reached by
// something other than the tabs, such as opening an artifact.
// 'product' is listed in the product menu on the wordmark, never in the tabs.
export type ScreenPlacement = 'main' | 'settings' | 'hidden' | 'product';

export interface LeveledPresentation {
  level?: string;
  /** The tab works but its place is not settled: drawn with an EXP mark. */
  experimental?: boolean;
  /** The kit that brings the screen; shown only where the kit is installed. */
  kit?: string;
  /**
   * The domain types the screen shows that another kit brings (ADR-0070 §2):
   * shown only where every one is installed.
   */
  needs?: readonly string[];
  placement?: string;
  section?: string;
  parentSection?: string;
  /**
   * `section` is a prefix: the screen answers every section that starts with
   * it (`type:` answers `type:reports`). How a generic screen takes the tabs
   * the Studio domain model adds (ADR-0066), whose names no manifest knows.
   */
  sectionPrefix?: boolean;
  /**
   * The name of the `shows` relation on the level's type in the Studio domain
   * model that this tab is (the prototype's tab id: `org` for the
   * organization's Overview). Absent: the section, else the route's last
   * segment. A relation of that name is this tab, not a generic one, and a
   * level's `hidden_tabs` names the tab by it.
   */
  modelTab?: string;
  /**
   * Who the screen is for: `platform-admin` is offered only to a platform
   * administrator (Admin › System, whose reads refuse anybody else, #1044).
   * Absent: everybody the level is offered to. Not an authority: the gears
   * behind the screen refuse for themselves.
   */
  audience?: string;
}

/** The audience a platform administrator's screen declares. */
export const PLATFORM_ADMIN_AUDIENCE = 'platform-admin';

/** Whether `extension` is offered to this person, by its `audience`. */
export function offeredTo(extension: StudioScreenExtension, platformAdmin: boolean): boolean {
  return extension.presentation.audience !== PLATFORM_ADMIN_AUDIENCE || platformAdmin;
}

/** Whether `extension` answers `section`: its own, or one under its prefix. */
export function answersSection(extension: StudioScreenExtension, section: string): boolean {
  const own = sectionOf(extension);
  if (own === undefined) return false;
  if (section === own) return true;
  return extension.presentation.sectionPrefix === true && section.length > own.length && section.startsWith(own);
}

/**
 * A screen extension as Studio declares it: `route` stays in `presentation`
 * (ADR-0028), where mfes 0.4 moved it out to the extension itself.
 */
export type StudioScreenExtension = Omit<ScreenExtension, 'route' | 'presentation'> & {
  presentation: ExtensionPresentation & { route: string } & LeveledPresentation;
};

const DEFAULT_LEVEL: ScreenLevel = 'organization';

function isScreenLevel(value: unknown): value is ScreenLevel {
  return typeof value === 'string' && (SCREEN_LEVELS as readonly string[]).includes(value);
}

// @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-2
// @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-3
export function levelOf(extension: StudioScreenExtension): ScreenLevel {
  const declared = extension.presentation.level;
  return isScreenLevel(declared) ? declared : DEFAULT_LEVEL;
}
// @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-3
// @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-2

// The MFE's own token for this item, when the item is a section of a screen.
export function sectionOf(extension: StudioScreenExtension): string | undefined {
  return extension.presentation.section;
}

// For a hidden screen: the section whose tab stays active while it is mounted.
export function parentSectionOf(extension: StudioScreenExtension): string | undefined {
  return extension.presentation.parentSection;
}

export function placementOf(extension: StudioScreenExtension): ScreenPlacement {
  const declared = extension.presentation.placement;
  return declared === 'settings' || declared === 'hidden' || declared === 'product' ? declared : 'main';
}

// @cpt-dod:cpt-studiofrontend-dod-shell-levels-entry-point:p1
export function entryPointOf(
  extensions: readonly StudioScreenExtension[],
  level: ScreenLevel,
): StudioScreenExtension | undefined {
  return resolveLevelMenu(extensions, level)[0];
}

export function resolveLevelMenu(
  extensions: readonly StudioScreenExtension[],
  level: ScreenLevel,
): StudioScreenExtension[] {
  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-1
  const ofLevel = extensions.filter((extension) => levelOf(extension) === level);
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-1

  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-4
  const byOrder = [...ofLevel].sort(
    (a, b) => (a.presentation.order ?? UNDECLARED_ORDER) - (b.presentation.order ?? UNDECLARED_ORDER),
  );
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-4

  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-5
  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-7
  // Hidden items fall out here by being neither main nor settings. That is also
  // what keeps them from being a level's entry point, which is this list's head.
  const main = byOrder.filter((extension) => placementOf(extension) === 'main');
  const settings = byOrder.filter((extension) => placementOf(extension) === 'settings');
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-7
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-5

  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-6
  return [...main, ...settings];
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-menu:p1:inst-6
}
