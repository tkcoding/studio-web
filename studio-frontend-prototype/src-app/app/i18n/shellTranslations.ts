/**
 * The shell's own strings, with English under every language
 * (`loadScreenTranslations`). Registered on import, before the i18n plugin
 * sets the first language.
 */
import { i18nRegistry } from '@gears-frontx/react';
import { createText, loadScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const SHELL_NAMESPACE = 'shell';

const modules = import.meta.glob('./*.json') as TranslationModules;

i18nRegistry.registerLoader(SHELL_NAMESPACE, loadScreenTranslations(modules, '.'));

/** `t('key')` bound to the shell's namespace. */
export const useShellText = createText(SHELL_NAMESPACE);
