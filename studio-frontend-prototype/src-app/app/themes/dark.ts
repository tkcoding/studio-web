/**
 * Dark theme for FrontX
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';

/**
 * Dark theme ID
 */
export const DARK_THEME_ID = 'dark' as const;

export const darkTheme: ThemeConfig = {
  id: DARK_THEME_ID,
  name: 'Dark',
  appearance: 'dark',
  variables: {
    // 'Inter Variable' is the registered family; the kit's token says 'Inter'.
    '--font-sans': "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
};
