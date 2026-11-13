// The design's English dates are British: "3 Sept, 16:06", not "Sep 3, 4:06 PM".
const LOCALES: Record<string, string> = { en: 'en-GB' };

export function intlLocale(language: string | null | undefined): string {
  return LOCALES[language ?? ''] ?? (language || 'en-GB');
}
