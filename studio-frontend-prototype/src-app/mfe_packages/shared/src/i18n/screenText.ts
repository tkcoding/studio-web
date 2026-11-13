/**
 * `t('key')` bound to one namespace: a call site writes `t('title')` while
 * the registry is asked for `<namespace>:title`. `t.count('key', n)` picks the
 * plural form — see "Counts in translations" in this package's README.
 */

import { useMemo } from 'react';
import { useScreenTranslations, useTranslation } from '@gears-frontx/react';
import { loadScreenTranslations, type TranslationModules } from './screenTranslations';

type TextParams = Record<string, string | number | boolean>;

export type ScreenText = ((key: string, params?: TextParams) => string) & {
  /** `key_one`, `key_few` or `key_many` by the language's rule, `{count}` filled. */
  count: (key: string, count: number, params?: TextParams) => string;
};

const TRANSLATED_LANGUAGES: ReadonlySet<string> = new Set(['en', 'ru']);

/** The form a count takes: CLDR's categories, folded onto the three keys a dictionary writes. */
export function pluralForm(count: number, language: string | null | undefined): 'one' | 'few' | 'many' {
  const rule = language && TRANSLATED_LANGUAGES.has(language) ? language : 'en';
  const category = new Intl.PluralRules(rule).select(count);
  return category === 'one' || category === 'few' ? category : 'many';
}

/**
 * A `ScreenText` over a translator that answers a missing key with the key —
 * FrontX's answers `<namespace>:<key>`. That answer is how `_few` falls back to
 * `_many` in a dictionary that has no `_few`.
 */
export function screenText(
  translate: (key: string, params?: TextParams) => string,
  language: string | null | undefined
): ScreenText {
  const text = ((key: string, params?: TextParams) => translate(key, params)) as ScreenText;
  text.count = (key, count, params) => {
    const values = { ...params, count };
    const form = pluralForm(count, language);
    if (form === 'few') {
      const few = `${key}_few`;
      const value = translate(few, values);
      if (value !== few && !value.endsWith(`:${few}`)) return value;
    }
    return translate(`${key}_${form === 'one' ? 'one' : 'many'}`, values);
  };
  return text;
}

export function createText(namespace: string): () => ScreenText {
  return function useScreenText(): ScreenText {
    const { t, language } = useTranslation();
    return useMemo(
      () => screenText((key, params) => t(`${namespace}:${key}`, params), language),
      [t, language]
    );
  };
}

/** One screen's dictionary and its text function in one hook — `{ t, loading }` */
export function createScreenTranslations(
  screenset: string,
  screen: string,
  modules: TranslationModules,
  directory: string
): () => { t: ScreenText; loading: boolean } {
  const load = loadScreenTranslations(modules, directory);
  const useText = createText(`screen.${screenset}.${screen}`);
  return function useTranslations() {
    const { isLoaded } = useScreenTranslations(screenset, screen, load);
    return { t: useText(), loading: !isLoaded };
  };
}
