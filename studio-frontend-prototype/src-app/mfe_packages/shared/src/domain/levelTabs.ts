/**
 * The tabs a level's type declares in the Studio domain model, and the ones a
 * level hides — the prototype's `level-tabs.ts` (studio-frontend-poc/), pure.
 *
 * * Which tabs exist is the model's (ADR-0066, ADR-0070): every relation of
 *   kind `shows` on `organization`, `workspace` or `project` is a tab, in the
 *   order the type declares them. A name some screen of the portal answers is
 *   that screen; any other opens the generic list of the type the relation
 *   reaches, addressed as the section `type:<name>`, so a model edit adds a
 *   tab without a portal release.
 * * Which of them an administrator turned off is the level's own settings
 *   document (`hidden_tabs`): the workspace settings on an organization or a
 *   workspace, the project config on a project. A level never ends up with
 *   no tab: when everything would go, everything stays.
 */

import { PROJECT_CONFIG_TYPE } from '../project/projectConfig';
import type { DomainModel } from './runtime';

/** The relation kind that makes a tab. */
export const SHOWS = 'shows';

/** The levels whose types carry tabs. */
export const TAB_LEVELS = ['organization', 'workspace', 'project'] as const;
export type TabLevel = (typeof TAB_LEVELS)[number];

export function isTabLevel(value: unknown): value is TabLevel {
  return typeof value === 'string' && (TAB_LEVELS as readonly string[]).includes(value);
}

/** What a generic tab's section starts with: `type:<relation name>`. */
export const GENERIC_SECTION_PREFIX = 'type:';

/** A `shows` relation of a level's type. */
export interface ModelTab {
  /** The relation's name: a built-in tab's model name, or a new tab's. */
  name: string;
  /** Its label in the model, else its name. */
  label: string;
  /** The type whose objects it lists. */
  target: string;
}

/** The `shows` relations `level`'s type declares itself, in its order. */
export function modelTabs(model: DomainModel, level: string): ModelTab[] {
  return (model.byId.get(level)?.properties ?? [])
    .filter((p) => p.relationType === SHOWS && !!p.name)
    .map((p) => ({
      name: p.name,
      label: p.relationLabel?.trim() || p.name.replace(/_/g, ' '),
      target: String(p.relation ?? p.type ?? ''),
    }));
}

/** The section that opens the generic tab of relation `name`. */
export function genericSection(name: string): string {
  return `${GENERIC_SECTION_PREFIX}${name}`;
}

/** The relation a generic tab's section names; null for any other section. */
export function genericTabName(section: string | null | undefined): string | null {
  if (!section || !section.startsWith(GENERIC_SECTION_PREFIX)) return null;
  const name = section.slice(GENERIC_SECTION_PREFIX.length);
  return name ? name : null;
}

/** Workspace settings: tenant metadata on an organization or a workspace. */
export const WORKSPACE_SETTINGS_TYPE = 'gts.cf.core.am.tenant_metadata.v1~cf.studio.workspace.settings.v1~';

/** The settings document a level keeps its hidden tabs in. */
export function levelSettingsType(level: TabLevel): string {
  return level === 'project' ? PROJECT_CONFIG_TYPE : WORKSPACE_SETTINGS_TYPE;
}

/** The names stored under `hidden_tabs`, whatever the document holds. */
export function parseHiddenTabs(value: unknown): string[] {
  const raw = (value as { hidden_tabs?: unknown } | null | undefined)?.hidden_tabs;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((n): n is string => typeof n === 'string' && n !== ''))];
}

/** The document with `hidden` as its hidden tabs, every other field kept. */
export function withHiddenTabs(doc: unknown, hidden: readonly string[]): Record<string, unknown> {
  const base = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  return { ...base, hidden_tabs: [...hidden] };
}

/** The tabs a level shows: `tabs` without the hidden ones, in their order —
 *  or all of them, when hiding would leave none. */
export function shownTabs<T>(tabs: readonly T[], hidden: readonly string[], idOf: (tab: T) => string): T[] {
  const off = new Set(hidden);
  const shown = tabs.filter((t) => !off.has(idOf(t)));
  return shown.length > 0 ? shown : [...tabs];
}

/** What to store: the names among `ids` that are off, in their order; null
 *  when nothing would show. A name in `previous` that is not among `ids` stays
 *  stored after them: its tab is only absent here (a kit not installed in this
 *  place, a screen still loading), and showing it again is not this editor's call. */
export function hiddenToSave(
  ids: readonly string[],
  off: ReadonlySet<string>,
  previous: readonly string[] = []
): string[] | null {
  const hidden = ids.filter((id) => off.has(id));
  if (hidden.length >= ids.length) return null;
  const listed = new Set(ids);
  return [...hidden, ...previous.filter((name) => !listed.has(name))];
}
