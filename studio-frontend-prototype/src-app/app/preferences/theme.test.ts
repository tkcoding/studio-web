import { describe, expect, it } from 'vitest';
import { choiceFor, themeIdFor } from './theme';
import { DEFAULT_THEME_ID } from '@/app/themes/default';
import { DARK_THEME_ID } from '@/app/themes/dark';

describe('theme choice', () => {
  it('maps the prototype values onto the shell themes, light by default', () => {
    expect(themeIdFor('dark')).toBe(DARK_THEME_ID);
    expect(themeIdFor('light')).toBe(DEFAULT_THEME_ID);
    expect(themeIdFor('dracula')).toBe(DEFAULT_THEME_ID);
  });

  it('reads a shell theme back as a choice', () => {
    expect(choiceFor(DARK_THEME_ID)).toBe('dark');
    expect(choiceFor(DEFAULT_THEME_ID)).toBe('light');
    expect(choiceFor(undefined)).toBe('light');
  });
});
