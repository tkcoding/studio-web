/**
 * A level's tabs with the Studio domain model's (ADR-0066, the prototype's
 * `level-tabs.ts`). The tabs the manifests declare stay what they are; every
 * `shows` relation of the level's type that none of them answers becomes a
 * tab of the level's generic screen — an extension that answers the section
 * family `type:` — drawn after the built-in tabs and before Settings, in the
 * model's order, labelled as the model labels it. `hidden_tabs` takes tabs
 * away by their model name.
 *
 * Pure: the screens are given, so this is tested without a registry.
 */

import {
  GENERIC_SECTION_PREFIX,
  genericSection,
  isTabLevel,
  shownTabs,
  type ModelTab,
} from '@constructor-studio/mfe-shared';
import { levelOf, placementOf, sectionOf, type ScreenLevel, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { tabIdOf } from '@/app/preferences/levelTabOrder';

/** The name a tab has in the model and in `hidden_tabs`. */
export function modelNameOf(extension: StudioScreenExtension): string {
  return extension.presentation.modelTab ?? sectionOf(extension) ?? tabIdOf(extension);
}

/** The screen of `level` that answers the tabs the model adds, if one is registered. */
export function genericScreenOf(
  registered: readonly StudioScreenExtension[],
  level: ScreenLevel
): StudioScreenExtension | undefined {
  return registered.find(
    (ext) =>
      levelOf(ext) === level &&
      ext.presentation.sectionPrefix === true &&
      sectionOf(ext) === GENERIC_SECTION_PREFIX
  );
}

/** The separator between a generic screen's id and the tab drawn from it. */
const GENERIC_TAB_MARK = '#';

/** A tab drawn for `tab` on the generic `screen`: the screen, under the tab's section. */
export function genericTabExtension(screen: StudioScreenExtension, tab: ModelTab): StudioScreenExtension {
  const section = genericSection(tab.name);
  const route = screen.presentation.route.replace(/\/+$/, '').split('/').filter(Boolean)[0] ?? '';
  return {
    ...screen,
    id: `${screen.id}${GENERIC_TAB_MARK}${section}`,
    presentation: {
      ...screen.presentation,
      label: tab.label,
      route: `/${route}/${section}`,
      section,
      placement: 'main',
      sectionPrefix: false,
      modelTab: undefined,
    },
  };
}

/** The extension a tab click names: a generic tab's own screen. */
export function screenIdOf(extension: StudioScreenExtension): string {
  const at = extension.id.indexOf(GENERIC_TAB_MARK);
  return at < 0 ? extension.id : extension.id.slice(0, at);
}

/**
 * Every tab of `level`, hidden or not: `items` (the level's menu as the
 * manifests and the installed kits give it), with a generic tab for each of
 * the model's `tabs` that no registered screen of the level answers, after
 * the main tabs and before the settings ones. A relation whose screen is a
 * kit's not installed here stays that kit's: it does not come back as a
 * generic tab.
 */
export function withModelTabs(
  items: readonly StudioScreenExtension[],
  registered: readonly StudioScreenExtension[],
  level: ScreenLevel,
  tabs: readonly ModelTab[]
): StudioScreenExtension[] {
  const generic = isTabLevel(level) ? genericScreenOf(registered, level) : undefined;
  if (!generic || tabs.length === 0) return [...items];
  const known = new Set(registered.filter((ext) => levelOf(ext) === level).map(modelNameOf));
  const added = tabs.filter((tab) => tab.target && !known.has(tab.name)).map((tab) => genericTabExtension(generic, tab));
  const main = items.filter((ext) => placementOf(ext) !== 'settings');
  const settings = items.filter((ext) => placementOf(ext) === 'settings');
  return [...main, ...added, ...settings];
}

/** The tabs a level shows: without the ones its settings hide, never none. */
export function visibleTabs(
  tabs: readonly StudioScreenExtension[],
  hidden: readonly string[]
): StudioScreenExtension[] {
  return shownTabs(tabs, hidden, modelNameOf);
}
