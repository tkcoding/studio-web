/**
 * This MFE's translations, on the framework's own screen-level i18n. This
 * module adds the namespace: call sites write `t('title')` while the binding
 * asks the registry for `screen.connections.list:title`.
 */

import {
  useScreenTranslations,
  type UseScreenTranslationsReturn,
} from '@gears-frontx/react';
import { createText, loadScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const SCREENSET = 'connections';
const LIST_SCREEN = 'list';
const CONNECT_SCREEN = 'connect';

export const CONNECTION_LIST_NAMESPACE = `screen.${SCREENSET}.${LIST_SCREEN}`;
export const CONNECT_SOURCE_NAMESPACE = `screen.${SCREENSET}.${CONNECT_SCREEN}`;

type ModuleMap = TranslationModules;

const listModules = import.meta.glob('./screens/connection-list/i18n/*.json') as ModuleMap;
const connectModules = import.meta.glob('./screens/connect-source/i18n/*.json') as ModuleMap;


const loadListTranslations = loadScreenTranslations(listModules, './screens/connection-list/i18n');
const loadConnectTranslations = loadScreenTranslations(connectModules, './screens/connect-source/i18n');

/** Loads the list screen's dictionary. One call, in `ConnectionListScreen`. */
export function useConnectionListScreenTranslations(): UseScreenTranslationsReturn {
  return useScreenTranslations(SCREENSET, LIST_SCREEN, loadListTranslations);
}

/**
 * Loads the Connect source form's dictionary. One call, in
 * `ConnectSourceDialog`. The form is a second mounted root with its own shadow
 * root, but `init.ts` builds the i18n registry once per entry — so this is the
 * same registry the screen uses, not a second one.
 */
export function useConnectSourceScreenTranslations(): UseScreenTranslationsReturn {
  return useScreenTranslations(SCREENSET, CONNECT_SCREEN, loadConnectTranslations);
}

export const useConnectionListText = createText(CONNECTION_LIST_NAMESPACE);
export const useConnectSourceText = createText(CONNECT_SOURCE_NAMESPACE);
