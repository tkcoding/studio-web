import { describe, expect, it } from 'vitest';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { availableScreens } from './AvailableScreens';

function screen(route: string, kit?: string): StudioScreenExtension {
  return {
    id: `ext${route}`,
    domain: 'screen',
    entry: 'entry',
    presentation: { label: route, route, ...(kit ? { kit } : {}) },
  } as unknown as StudioScreenExtension;
}

const screens = [
  screen('/organization/overview'),
  screen('/issues', 'project-issues'),
  screen('/releases', 'product-releases'),
];

describe('availableScreens', () => {
  it("lists the shell's screens and a kit's only where its kit is installed", () => {
    expect(availableScreens(screens, new Set(['project-issues']))).toEqual({
      routes: ['/issues', '/organization/overview'],
      kits: ['project-issues'],
    });
  });

  it('hides nothing while the installed kits are unknown', () => {
    expect(availableScreens(screens, null)).toEqual({
      routes: ['/issues', '/organization/overview', '/releases'],
      kits: null,
    });
  });
});
