/**
 * This MFE's translations, on the framework's own screen-level i18n — the same
 * shape projects-mfe uses, so that both MFEs' screens are read the same way.
 * What this module adds is the namespace: call sites write `t('col_projects')`
 * while the binding asks the registry for
 * `screen.organization.workspaces:col_projects`.
 */

import {
  useScreenTranslations,
  type UseScreenTranslationsReturn,
} from '@gears-frontx/react';
import {
  createScreenTranslations,
  createText,
  loadScreenTranslations,
  type TranslationModules,
} from '@constructor-studio/mfe-shared';

const SCREENSET = 'organization';
const WORKSPACES_SCREEN = 'workspaces';

export const WORKSPACES_NAMESPACE = `screen.${SCREENSET}.${WORKSPACES_SCREEN}`;

type ModuleMap = TranslationModules;

const workspacesModules = import.meta.glob('./screens/workspaces/i18n/*.json') as ModuleMap;
const settingsModules = import.meta.glob('./screens/settings/i18n/*.json') as ModuleMap;


const loadWorkspacesTranslations = loadScreenTranslations(workspacesModules, './screens/workspaces/i18n');

/** Loads the workspaces list's dictionary. One call, in `WorkspacesScreen`. */
export function useWorkspacesScreenTranslations(): UseScreenTranslationsReturn {
  return useScreenTranslations(SCREENSET, WORKSPACES_SCREEN, loadWorkspacesTranslations);
}

export const useWorkspacesText = createText(WORKSPACES_NAMESPACE);

/** Organization › Settings' dictionary and its text function in one call. */
export const useSettingsTranslations = createScreenTranslations(
  SCREENSET,
  'settings',
  settingsModules,
  './screens/settings/i18n'
);

const overviewModules = import.meta.glob('./screens/overview/i18n/*.json') as ModuleMap;

/** The overview's dictionary and its text function in one call. */
export const useOverviewTranslations = createScreenTranslations(
  SCREENSET,
  'overview',
  overviewModules,
  './screens/overview/i18n'
);

const backgroundModules = import.meta.glob('./screens/background/i18n/*.json') as ModuleMap;

/** Background work's dictionary and its text function in one call. */
export const useBackgroundTranslations = createScreenTranslations(
  SCREENSET,
  'background',
  backgroundModules,
  './screens/background/i18n'
);
