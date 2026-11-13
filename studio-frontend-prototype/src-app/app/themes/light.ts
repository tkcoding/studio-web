/**
 * Light theme for FrontX
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';

/**
 * Light theme ID
 */
export const LIGHT_THEME_ID = 'light' as const;

export const lightTheme: ThemeConfig = {
  id: LIGHT_THEME_ID,
  name: 'Light',
  appearance: 'light',
  variables: {
    // 'Inter Variable' is the registered family; the kit's token says 'Inter'.
    '--font-sans': "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
};
