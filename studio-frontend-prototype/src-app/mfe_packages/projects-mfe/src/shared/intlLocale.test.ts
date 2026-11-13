import { describe, expect, it } from 'vitest';
import { intlLocale } from './intlLocale';

describe('intlLocale', () => {
  it('writes English dates the British way', () => {
    expect(intlLocale('en')).toBe('en-GB');
  });

  it('passes any other language through', () => {
    expect(intlLocale('ru')).toBe('ru');
  });

  it('falls back to British English before the app has a language', () => {
    expect(intlLocale(null)).toBe('en-GB');
    expect(intlLocale(undefined)).toBe('en-GB');
    expect(intlLocale('')).toBe('en-GB');
  });
});
