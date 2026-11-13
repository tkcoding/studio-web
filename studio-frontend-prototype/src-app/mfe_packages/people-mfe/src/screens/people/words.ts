/** The People screen's sentences that depend on counts and figures, in the reader's language. */

import { INSIGHT_DAYS, type Activity, type ScreenText } from '@constructor-studio/mfe-shared';

/** What a person did in a project, in a few words. Empty when nothing was seen. */
export function activityWords(a: Activity | null | undefined, t: ScreenText): string {
  if (!a) return '';
  const parts: string[] = [];
  if (a.pullsAuthored) parts.push(t.count('w_pulls', a.pullsAuthored));
  if (a.pullsReviewing) parts.push(t('w_reviewing', { count: a.pullsReviewing }));
  if (a.events) parts.push(t.count('w_events', a.events));
  if (a.desktop) parts.push(t('w_desktop'));
  if (a.insightPrs) parts.push(t.count('w_insight_prs', a.insightPrs, { days: INSIGHT_DAYS }));
  if (a.insightReviews) parts.push(t.count('w_insight_reviews', a.insightReviews, { days: INSIGHT_DAYS }));
  return parts.join(' · ');
}

/** A membership role in words; an unknown one as it is. */
export function membershipLabel(role: string, t: ScreenText): string {
  return role === 'owner' || role === 'admin' || role === 'member' ? t(`role_${role}`) : role;
}

/** A git host's name. */
export function aliasKindLabel(kind: string, t: ScreenText): string {
  return kind === 'github' || kind === 'gitlab' || kind === 'bitbucket' ? t(`alias_${kind}`) : kind;
}

/** "3 h ago", in the screen's language; a dash for nothing. */
export function relTime(ms: number | null | undefined, language: string, now = Date.now()): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const seconds = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

/** The full instant, for a hover. */
export function fullTime(ms: number | null | undefined, language: string): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toLocaleString(language);
}
