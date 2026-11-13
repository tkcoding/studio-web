import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDayTime, useDayTime } from './dayTime';

const { registry } = vi.hoisted(() => ({ registry: { language: 'en' } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useTranslation: () => ({ t: (key: string) => key, language: registry.language }),
}));

// Local time on both sides, so the zone the tests run in does not matter.
const NOW = new Date(2026, 9, 27, 10, 0);
const SEPT_3 = new Date(2026, 8, 3, 16, 6);

describe('formatDayTime', () => {
  it('writes a day of this year as the design does: day, short month, 24-hour time', () => {
    expect(formatDayTime(SEPT_3, 'en', NOW)).toBe('3 Sept, 16:06');
  });

  it("follows the member's language", () => {
    expect(formatDayTime(SEPT_3, 'ru', NOW)).toBe('3 сент., 16:06');
  });

  it('adds the year to a day of another year', () => {
    expect(formatDayTime(new Date(2025, 11, 3, 9, 5), 'en', NOW)).toBe('3 Dec 2025, 09:05');
  });

  it('builds one formatter per language and year rule, not one per call', () => {
    const Real = Intl.DateTimeFormat;
    const made = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(function (...args: ConstructorParameters<typeof Real>) {
        return new Real(...args);
      } as unknown as typeof Real);
    expect(formatDayTime(SEPT_3, 'de', NOW)).toBe('3. Sept., 16:06');
    formatDayTime(new Date(2026, 1, 1, 8, 0), 'de', NOW);

    expect(made).toHaveBeenCalledTimes(1);
    made.mockRestore();
  });

  it('reads an ISO string, and gives nothing for a value that is not a time', () => {
    expect(formatDayTime(SEPT_3.toISOString(), 'en', NOW)).toBe('3 Sept, 16:06');
    expect(formatDayTime('not a time', 'en', NOW)).toBe('');
  });
});

describe('useDayTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats in the app's language", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    registry.language = 'ru';
    const { result } = renderHook(() => useDayTime());

    expect(result.current(SEPT_3)).toBe('3 сент., 16:06');
  });
});
