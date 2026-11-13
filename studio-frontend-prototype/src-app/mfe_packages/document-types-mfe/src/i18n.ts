/**
 * This screen's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). Call sites write
 * `t('title')` while the registry is asked for `screen.document_types.main:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const modules = import.meta.glob('./screens/document-types/i18n/*.json') as TranslationModules;

export const useDocumentTypesTranslations = createScreenTranslations(
  'document_types',
  'main',
  modules,
  './screens/document-types/i18n'
);
