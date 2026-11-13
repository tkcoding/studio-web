import { useCallback } from 'react';
import { useTranslation } from '@gears-frontx/react';
import { intlLocale } from './intlLocale';

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function daysAgoFormatter(language: string | null | undefined): Intl.RelativeTimeFormat {
  const locale = intlLocale(language);
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    formatters.set(locale, formatter);
  }
  return formatter;
}

export function formatDaysAgo(back: number, language: string | null | undefined): string {
  return daysAgoFormatter(language).format(-back, 'day');
}

export function useDaysAgo(): (back: number) => string {
  const { language } = useTranslation();
  return useCallback((back: number) => formatDaysAgo(back, language), [language]);
}
