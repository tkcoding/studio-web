/**
 * This package's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('title')` while the registry is asked for `screen.infrastructure.main:title`.
 *
 * Two screens: Organization › Infrastructure (`main`, the org-infrastructure
 * kit) and Organization › Constructor Research (`research`, the constructor-research kit).
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/infrastructure/i18n/*.json') as TranslationModules;
const researchModules = import.meta.glob('./screens/research/i18n/*.json') as TranslationModules;

export const useInfrastructureTranslations = createScreenTranslations(
  'infrastructure',
  'main',
  modules,
  './screens/infrastructure/i18n'
);

export const useResearchTranslations = createScreenTranslations(
  'infrastructure',
  'research',
  researchModules,
  './screens/research/i18n'
);
