/**
 * Admin's translations, on the framework's own screen-level i18n with English
 * under every language (`loadScreenTranslations`). One dictionary for every
 * section: call sites write `t('title')` while the registry is asked for
 * `screen.admin.main:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/admin/i18n/*.json') as TranslationModules;

export const useAdminTranslations = createScreenTranslations('admin', 'main', modules, './screens/admin/i18n');
