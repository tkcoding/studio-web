import { useCallback } from 'react';
import { useTranslation } from '@gears-frontx/react';
import { intlLocale } from './intlLocale';

export type DayTimeInput = Date | string | number;

const formatters = new Map<string, Intl.DateTimeFormat>();

function toDate(value: DayTimeInput): Date | null {
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function dayTimeFormatter(
  language: string | null | undefined,
  withYear: boolean
): Intl.DateTimeFormat {
  const locale = intlLocale(language);
  const key = `${locale}|${withYear}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

// FrontX's `useFormatters()` has no style for a day, a short month, 24-hour time and the year
// only when it is not this one.
export function formatDayTime(
  value: DayTimeInput,
  language: string | null | undefined,
  now: Date = new Date()
): string {
  const at = toDate(value);
  if (!at) return '';
  return dayTimeFormatter(language, at.getFullYear() !== now.getFullYear()).format(at);
}

export function useDayTime(): (value: DayTimeInput) => string {
  const { language } = useTranslation();
  return useCallback((value: DayTimeInput) => formatDayTime(value, language), [language]);
}
