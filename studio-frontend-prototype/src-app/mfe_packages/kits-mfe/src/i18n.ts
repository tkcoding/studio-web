/**
 * This MFE's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('title')` while the registry is asked for `screen.kits.home:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const homeModules = import.meta.glob('./screens/home/i18n/*.json') as TranslationModules;

/** The home screen's dictionary and its text function in one call. */
export const useHomeTranslations = createScreenTranslations('kits', 'home', homeModules, './screens/home/i18n');
