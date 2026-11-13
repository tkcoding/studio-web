import { describe, expect, it } from 'vitest';
import { toKitTheme } from '@constructor-studio/mfe-shared';
import { frontxThemes } from './index';

/**
 * The kit's theme.css owns the palette, the radius scale and the type ramp
 * (ADR-0034). A theme here says which kit palette it sits on, restates the one
 * token whose kit value is wrong for this app — `--font-sans`, because the
 * registered family is 'Inter Variable', not 'Inter'. Dracula adds its own
 * colours on top.
 */
describe('frontxThemes', () => {
  it('registers more than one theme', () => {
    expect(frontxThemes.length).toBeGreaterThan(1);
  });

  it.each(frontxThemes.map((theme) => [theme.id, theme] as const))(
    'theme %s declares the appearance the MFEs map its id to',
    (id, theme) => {
      expect(theme.appearance).toBe(toKitTheme(id));
    }
  );

  it.each(frontxThemes.map((theme) => [theme.id, theme] as const))(
    'theme %s declares a --font-sans stack led by Inter Variable, with a system fallback',
    (_id, theme) => {
      const stack = theme.variables['--font-sans'];
      expect(stack).toMatch(/^'Inter Variable'/);
      expect(stack).toMatch(/system-ui/);
    }
  );

  it('leaves the kit palette alone on the light and dark themes', () => {
    for (const id of ['default', 'light', 'dark']) {
      const theme = frontxThemes.find((entry) => entry.id === id);
      expect(theme, id).toBeDefined();
      const kitNames = Object.keys(theme!.variables).filter(
        (name) => name !== '--font-sans'
      );
      expect(kitNames).toEqual([]);
    }
  });

  // The kit's dark block fixes these to blue/slate literals; without them a
  // Dracula button turns blue on hover and focus.
  it.each(['dracula', 'dracula-large'])(
    'theme %s derives the kit tokens that follow the palette from its own tokens',
    (id) => {
      const theme = frontxThemes.find((entry) => entry.id === id);
      expect(theme, id).toBeDefined();
      for (const name of [
        '--primary-hover',
        '--primary-ring',
        '--destructive-ring',
        '--link-foreground',
        '--border-strong',
        '--surface-elevated',
      ]) {
        expect(theme!.variables[name], name).toMatch(/var\(--/);
      }
    }
  );

  it('dracula-large scales the body role above the kit ramp', () => {
    const theme = frontxThemes.find((entry) => entry.id === 'dracula-large');
    expect(theme).toBeDefined();
    for (const [name, kit] of [
      ['--text-body-size', 0.875],
      ['--text-body-line-height', 1.25],
    ] as const) {
      const value = theme!.variables[name];
      expect(value, name).toMatch(/^\d+(\.\d+)?rem$/);
      expect(parseFloat(value!), name).toBeGreaterThan(kit);
    }
  });
});
