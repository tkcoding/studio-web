/**
 * Default theme for FrontX
 * Based on original PoC design with light color scheme
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID = 'default' as const;

export const defaultTheme: ThemeConfig = {
  id: DEFAULT_THEME_ID,
  name: 'Default',
  default: true,
  appearance: 'light',
  variables: {
    // 'Inter Variable' is the registered family; the kit's token says 'Inter'.
    '--font-sans': "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
};
