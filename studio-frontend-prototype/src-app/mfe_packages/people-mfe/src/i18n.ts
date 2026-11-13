/**
 * This MFE's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('title')` while the registry is asked for `screen.people.main:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/people/i18n/*.json') as TranslationModules;

export const usePeopleTranslations = createScreenTranslations('people', 'main', modules, './screens/people/i18n');
