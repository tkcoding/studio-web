import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createText, pluralForm, screenText } from './screenText';

const { registry } = vi.hoisted(() => ({
  registry: { language: 'en', words: {} as Record<string, string> },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => {
  // One `t` for every render, as the registry's: only the language moves.
  const t = (key: string) => registry.words[key] ?? key;
  return {
    ...(await importOriginal<typeof import('@gears-frontx/react')>()),
    useTranslation: () => ({ t, language: registry.language }),
  };
});

/**
 * A translator the way FrontX's answers, down to `<namespace>:<key>` for a
 * missing key: the `_few` fallback reads that answer, which a dictionary
 * helper answering with the bare key would not exercise.
 */
const translator =
  (dictionary: Record<string, string>) => (key: string, params?: Record<string, unknown>) =>
    key in dictionary
      ? dictionary[key]!.replace(/\{(\w+)\}/g, (match, name: string) =>
          params?.[name] !== undefined ? String(params[name]) : match
        )
      : `screen.test:${key}`;

const ru = {
  n_one: '{count} воркспейс',
  n_few: '{count} воркспейса',
  n_many: '{count} воркспейсов',
};

describe('pluralForm', () => {
  it('follows the Russian rule, not "one or not one"', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => pluralForm(n, 'ru'))).toEqual([
      'one',
      'few',
      'many',
      'many',
      'one',
      'few',
    ]);
  });

  it('has two forms in English', () => {
    expect([0, 1, 2].map((n) => pluralForm(n, 'en'))).toEqual(['many', 'one', 'many']);
  });

  it('reads a category the keys do not name as "many"', () => {
    expect(pluralForm(1.5, 'ru')).toBe('many');
  });

  // Their dictionaries are English copies: "0 workspaces", not "0 workspace".
  it('reads an untranslated language by the English rule', () => {
    expect(pluralForm(0, 'fr')).toBe('many');
    expect(pluralForm(21, 'uk')).toBe('many');
    expect(pluralForm(5, 'tl')).toBe('many');
    expect(pluralForm(2, 'pl')).toBe('many');
  });
});

describe('screenText', () => {
  it('passes a plain key through', () => {
    expect(screenText(translator({ title: 'Воркспейсы' }), 'ru')('title')).toBe('Воркспейсы');
  });

  it('counts with the form of the language in use', () => {
    const t = screenText(translator(ru), 'ru');
    expect([1, 2, 5, 21].map((n) => t.count('n', n))).toEqual([
      '1 воркспейс',
      '2 воркспейса',
      '5 воркспейсов',
      '21 воркспейс',
    ]);
  });

  it('reads "many" where a dictionary has no "few"', () => {
    const t = screenText(translator({ n_one: '{count} x', n_many: '{count} xs' }), 'ru');
    expect(t.count('n', 3)).toBe('3 xs');
  });

  it('fills the other parameters next to the count', () => {
    const t = screenText(translator({ r_one: '{from}–{to} of {count}', r_many: '{from}–{to} of {count}' }), 'en');
    expect(t.count('r', 40, { from: 1, to: 10 })).toBe('1–10 of 40');
  });
});

describe('createText', () => {
  const useText = createText('ns');

  beforeEach(() => {
    registry.language = 'en';
    registry.words = { 'ns:title': 'Workspaces', 'ns:n_one': 'one', 'ns:n_few': 'few', 'ns:n_many': 'many' };
  });

  it('asks for the key under its namespace', () => {
    const { result } = renderHook(() => useText());
    expect(result.current('title')).toBe('Workspaces');
  });

  it('counts by the language in use, and by the new one after a switch', () => {
    const { result, rerender } = renderHook(() => useText());
    expect(result.current.count('n', 2)).toBe('many');
    registry.language = 'ru';
    rerender();
    expect(result.current.count('n', 2)).toBe('few');
  });
});
