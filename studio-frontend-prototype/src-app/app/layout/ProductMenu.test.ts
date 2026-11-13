import { describe, expect, it } from 'vitest';
import { productScreens } from './ProductMenu';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';

const screen = (id: string, presentation: Record<string, unknown>) =>
  ({ id, presentation: { label: id, route: `/${id}`, ...presentation } }) as unknown as StudioScreenExtension;

describe('the product menu (ADR-0069)', () => {
  const screens = [
    screen('kits', { level: 'platform' }),
    screen('architecture', { level: 'platform', placement: 'product', order: 20, kit: 'studio-architecture' }),
    screen('docs', { level: 'platform', placement: 'product', order: 10, kit: 'studio-api-docs' }),
  ];

  it("lists the kits' product screens in their order, and no tab", () => {
    expect(productScreens(screens, null).map((s) => s.id)).toEqual(['docs', 'architecture']);
  });

  it('leaves out a product screen whose kit is not installed', () => {
    expect(productScreens(screens, new Set(['studio-api-docs'])).map((s) => s.id)).toEqual(['docs']);
  });
});
