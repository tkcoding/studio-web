/**
 * Dracula theme for FrontX
 * Based on the classic Dracula color scheme
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';

/**
 * Dracula theme ID
 */
export const DRACULA_THEME_ID = 'dracula' as const;

/**
 * Dracula color palette
 * Official Dracula colors: https://draculatheme.com/contribute
 */
const dracula = {
  purple: 'hsl(265 89% 78%)',       // #bd93f9
  comment: 'hsl(225 27% 51%)',      // #6272a4
  pink: 'hsl(326 100% 74%)',        // #ff79c6
  background: 'hsl(231 15% 18%)',   // #282a36
  foreground: 'hsl(60 30% 96%)',    // #f8f8f2
  currentLine: 'hsl(232 14% 31%)',  // #44475a
  red: 'hsl(0 100% 67%)',           // #ff5555
  yellow: 'hsl(65 92% 76%)',        // #f1fa8c
  green: 'hsl(135 94% 65%)',        // #50fa7b
  cyan: 'hsl(191 97% 77%)',         // #8be9fd
  backgroundDark: 'hsl(231 15% 14%)', // darker variant
};

export const draculaTheme: ThemeConfig = {
  id: DRACULA_THEME_ID,
  name: 'Dracula',
  appearance: 'dark',
  variables: {
    '--background': dracula.background,
    '--foreground': dracula.foreground,
    '--card': dracula.background,
    '--card-foreground': dracula.foreground,
    '--popover': dracula.background,
    '--popover-foreground': dracula.foreground,
    '--primary': dracula.purple,
    '--primary-foreground': dracula.background,
    '--secondary': dracula.comment,
    '--secondary-foreground': dracula.foreground,
    '--muted': dracula.currentLine,
    '--muted-foreground': dracula.foreground,
    '--accent': dracula.pink,
    '--accent-foreground': dracula.background,
    '--destructive': dracula.red,
    '--destructive-foreground': dracula.foreground,
    '--border': dracula.currentLine,
    '--input': dracula.currentLine,
    '--ring': dracula.purple,
    '--warning': dracula.yellow,
    '--success': dracula.green,
    '--info': dracula.cyan,
    '--chart-1': 'oklch(0.714 0.203 313.26)',
    '--chart-2': 'oklch(0.799 0.194 145.19)',
    '--chart-3': 'oklch(0.821 0.173 85.29)',
    '--chart-4': 'oklch(0.71 0.191 349.76)',
    '--chart-5': 'oklch(0.822 0.131 194.77)',

    // The kit's dark block sets these as literals (blue/slate); derive them from Dracula's palette.
    '--primary-hover': 'color-mix(in oklab, var(--primary) 88%, black)',
    '--primary-ring': 'var(--ring)',
    '--destructive-ring': 'var(--destructive)',
    '--link-foreground': 'var(--primary)',
    '--border-strong': 'var(--input)',
    '--surface-elevated': 'var(--card)',

    // 'Inter Variable' is the registered family; the kit's token says 'Inter'.
    '--font-sans': "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
};
