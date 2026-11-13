import { screenText, type ScreenText } from '@constructor-studio/mfe-shared';

export function dictionaryText(dictionary: Record<string, string>, language = 'en'): ScreenText {
  return screenText(
    (key, params) =>
      (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
        params?.[name] !== undefined ? String(params[name]) : match
      ),
    language
  );
}
