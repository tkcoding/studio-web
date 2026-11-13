/**
 * The Assistant kit's translations, on the framework's screen-level i18n with
 * English under every language (`loadScreenTranslations`).
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/panel/i18n/*.json') as TranslationModules;

export const useAssistantTranslations = createScreenTranslations('assistant', 'main', modules, './screens/panel/i18n');
