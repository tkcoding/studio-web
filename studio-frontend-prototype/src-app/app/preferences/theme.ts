/**
 * The person's theme, as the prototype kept it: one of their preferences
 * (`app.theme` in `/me/ui-preferences`, `light` or `dark`), applied when they
 * sign in rather than on a visit to the page that edits it. The prototype
 * edited it in Profile's Preferences card; here the user menu toggles it, since
 * the theme is the shell's and Profile is a screen of an MFE.
 */

import { useCallback, useEffect } from 'react';
import { useTheme } from '@gears-frontx/react';
import { DEFAULT_THEME_ID } from '@/app/themes/default';
import { DARK_THEME_ID } from '@/app/themes/dark';
import { usePreference } from './uiPreferences';

/** The prototype's key, so a choice made there holds here. */
export const THEME_PREFERENCE = 'app.theme';

export type ThemeChoice = 'light' | 'dark';

/** The shell theme a remembered choice names; anything else is the default (light) one. */
export function themeIdFor(choice: string): string {
  return choice === 'dark' ? DARK_THEME_ID : DEFAULT_THEME_ID;
}

/** The choice a shell theme stands for. */
export function choiceFor(themeId: string | undefined): ThemeChoice {
  return themeId === DARK_THEME_ID ? 'dark' : 'light';
}

/** The remembered choice, applied once it is known, and a way to change both. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [saved, save] = usePreference(THEME_PREFERENCE);
  const { currentTheme, setTheme } = useTheme();

  // Nothing remembered leaves whatever theme the shell started with.
  useEffect(() => {
    if (!saved) return;
    const wanted = themeIdFor(saved);
    if (wanted !== currentTheme) setTheme(wanted);
  }, [saved, currentTheme, setTheme]);

  const choose = useCallback(
    (choice: ThemeChoice) => {
      setTheme(themeIdFor(choice));
      save(choice);
    },
    [save, setTheme]
  );

  return [saved ? (saved === 'dark' ? 'dark' : 'light') : choiceFor(currentTheme), choose];
}
