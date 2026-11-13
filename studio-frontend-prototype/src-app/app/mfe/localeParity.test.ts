/**
 * Every key of a screen's `en.json` is in its `ru.json`, in every MFE and in the shell.
 *
 * `loadScreenTranslations` shows English where a locale is missing a key, so a
 * forgotten Russian string no longer renders as a raw key — it renders as
 * English, and nothing else would notice. Three such keys went unnoticed for a
 * month before the loader existed.
 *
 * Here with the shell's other checks across MFEs rather than in mfe-shared,
 * which every MFE depends on and which depends on none. The MFEs are found, not
 * listed: every package with screens, but the `_`-prefixed template and fixture,
 * and every `i18n` folder under its screens, a section's own included.
 * Only `ru`: the other locales are English copies.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mfe_packages');

/** The shell's own dictionary, held to the same rule. */
const SHELL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../i18n');

const read = (file: string): Record<string, string> => JSON.parse(readFileSync(file, 'utf8'));

const screens = readdirSync(PACKAGES)
  .filter((mfe) => !mfe.startsWith('_'))
  .map((mfe) => path.join(PACKAGES, mfe, 'src', 'screens'))
  .filter((root) => existsSync(root))
  .flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((entry) => path.basename(entry) === 'i18n')
      .map((entry) => path.join(root, entry))
      .filter((dir) => existsSync(path.join(dir, 'en.json')))
  )
  .map((dir) => ({ name: path.relative(PACKAGES, dir), dir }))
  .concat({ name: 'app/i18n', dir: SHELL });

describe('ru.json keeps up with en.json', () => {
  it('finds the screens it checks', () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  it.each(screens)('$name', ({ dir }) => {
    const en = read(path.join(dir, 'en.json'));
    const ru = existsSync(path.join(dir, 'ru.json')) ? read(path.join(dir, 'ru.json')) : {};
    expect(Object.keys(en).filter((key) => !(key in ru))).toEqual([]);
  });
});
