/**
 * Dracula Large theme for FrontX
 * Based on Dracula theme with larger typography and radii
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';
import { draculaTheme } from './dracula';

/**
 * Dracula Large theme ID
 */
export const DRACULA_LARGE_THEME_ID = 'dracula-large' as const;

export const draculaLargeTheme: ThemeConfig = {
  id: DRACULA_LARGE_THEME_ID,
  name: 'Dracula Large',
  appearance: 'dark',
  // Dracula's palette; only the type ramp and radius are its own.
  variables: {
    ...draculaTheme.variables,

    // 1.5x the kit ramp: Body 14/20 becomes 21/30.
    '--text-body-size': '1.3125rem',
    '--text-body-line-height': '1.875rem',
    '--text-heading-1-size': '1.875rem',
    '--text-heading-1-line-height': '2.625rem',
    '--text-label-size': '1.125rem',
    '--text-label-line-height': '1.5rem',

    // 1.5x the kit's base radius; the kit derives the other steps from it.
    '--radius': '0.9375rem',
  },
};
