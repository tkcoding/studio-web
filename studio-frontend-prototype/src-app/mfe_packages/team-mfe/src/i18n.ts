/**
 * This kit's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('title')` while the registry is asked for `screen.team.main:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/team/i18n/*.json') as TranslationModules;

export const useTeamTranslations = createScreenTranslations('team', 'main', modules, './screens/team/i18n');
