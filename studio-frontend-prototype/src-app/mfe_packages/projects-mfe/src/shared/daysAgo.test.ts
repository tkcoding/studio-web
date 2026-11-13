import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatDaysAgo, useDaysAgo } from './daysAgo';

const { registry } = vi.hoisted(() => ({ registry: { language: 'en' } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useTranslation: () => ({ t: (key: string) => key, language: registry.language }),
}));

describe('formatDaysAgo', () => {
  it('names a day by how many days back it is', () => {
    expect([0, 1, 2, 6].map((back) => formatDaysAgo(back, 'en'))).toEqual([
      'today',
      'yesterday',
      '2 days ago',
      '6 days ago',
    ]);
  });

  it("follows the member's language", () => {
    expect([0, 1, 2].map((back) => formatDaysAgo(back, 'ru'))).toEqual([
      'сегодня',
      'вчера',
      'позавчера',
    ]);
  });

  it('builds one formatter per language, not one per call', () => {
    const Real = Intl.RelativeTimeFormat;
    const made = vi
      .spyOn(Intl, 'RelativeTimeFormat')
      .mockImplementation(function (...args: ConstructorParameters<typeof Real>) {
        return new Real(...args);
      } as unknown as typeof Real);
    expect(formatDaysAgo(1, 'de')).toBe('gestern');
    formatDaysAgo(3, 'de');

    expect(made).toHaveBeenCalledTimes(1);
    made.mockRestore();
  });
});

describe('useDaysAgo', () => {
  it("names the day in the app's language", () => {
    registry.language = 'ru';
    const { result } = renderHook(() => useDaysAgo());

    expect(result.current(1)).toBe('вчера');
  });
});
