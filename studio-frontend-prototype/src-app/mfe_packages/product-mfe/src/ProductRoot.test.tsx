import { describe, expect, it } from 'vitest';
import { viewOf } from './ProductRoot';

describe('ProductRoot', () => {
  it('switches on the section the shell publishes', () => {
    expect(viewOf(undefined, 'components')).toBe('components');
    expect(viewOf(undefined, 'product')).toBe('product');
  });

  it('falls back on the extension id where no section is published', () => {
    expect(viewOf('gts…~constructor_studio.product.screens.components.v1', null)).toBe('components');
    expect(viewOf('gts…~constructor_studio.product.screens.product.v1', null)).toBe('product');
    expect(viewOf(undefined, undefined)).toBe('product');
  });
});
