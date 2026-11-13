/**
 * This kit's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). One dictionary per
 * part of the tab, so each part keeps its own words: call sites write
 * `t('title')` while the registry is asked for `screen.domain_model.<part>:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const main = import.meta.glob('./screens/domain/i18n/*.json') as TranslationModules;
const common = import.meta.glob('./screens/common/i18n/*.json') as TranslationModules;
const entities = import.meta.glob('./screens/entities/i18n/*.json') as TranslationModules;
const requirements = import.meta.glob('./screens/requirements/i18n/*.json') as TranslationModules;
const sources = import.meta.glob('./screens/sources/i18n/*.json') as TranslationModules;
const discovery = import.meta.glob('./screens/discovery/i18n/*.json') as TranslationModules;
const glossary = import.meta.glob('./screens/glossary/i18n/*.json') as TranslationModules;
const priorities = import.meta.glob('./screens/priorities/i18n/*.json') as TranslationModules;

/** The tab: its header, the build, the tab row. */
export const useDomainTranslations = createScreenTranslations('domain_model', 'main', main, './screens/domain/i18n');
/** What every part shares: a fact, a passage, the list, the empty states. */
export const useCommonTranslations = createScreenTranslations('domain_model', 'common', common, './screens/common/i18n');
/** Entities: the model map, the diagram, an entity's card and editor. */
export const useEntitiesTranslations = createScreenTranslations(
  'domain_model',
  'entities',
  entities,
  './screens/entities/i18n'
);
/** Requirements: each followed from its passage to its code. */
export const useRequirementsTranslations = createScreenTranslations(
  'domain_model',
  'requirements',
  requirements,
  './screens/requirements/i18n'
);
/** Sources: Documents, Work, Against the code, Elsewhere. */
export const useSourcesTranslations = createScreenTranslations(
  'domain_model',
  'sources',
  sources,
  './screens/sources/i18n'
);
/** Need and Rules: Needs, Hypotheses, Rules, Behaviour. */
export const useDiscoveryTranslations = createScreenTranslations(
  'domain_model',
  'discovery',
  discovery,
  './screens/discovery/i18n'
);
/** Glossary: the project's words and its glossary document. */
export const useGlossaryTranslations = createScreenTranslations(
  'domain_model',
  'glossary',
  glossary,
  './screens/glossary/i18n'
);
/** Priorities: what to build first. */
export const usePrioritiesTranslations = createScreenTranslations(
  'domain_model',
  'priorities',
  priorities,
  './screens/priorities/i18n'
);
