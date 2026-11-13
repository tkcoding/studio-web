/**
 * This kit's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('activity_title')` while the registry is asked for
 * `screen.activity.main:activity_title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./i18n/*.json') as TranslationModules;

export const useActivityTranslations = createScreenTranslations('activity', 'main', modules, './i18n');
