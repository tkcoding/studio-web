/**
 * This screen's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('title')` while the registry is asked for `screen.project_templates.main:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/project-templates/i18n/*.json') as TranslationModules;

export const useProjectTemplatesTranslations = createScreenTranslations(
  'project_templates',
  'main',
  modules,
  './screens/project-templates/i18n'
);
