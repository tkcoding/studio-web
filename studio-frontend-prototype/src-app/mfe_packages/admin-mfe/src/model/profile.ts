// From the prototype's `people-profile.tsx` (the pure parts of `MyPersonCard` and `MyIdentitiesCard`): which
// address comes first, whether a photo is one Studio stores, where a linked photo comes from, reading a picked
// file into what `PUT /me/avatar` takes, the account kinds a person may claim and how sure Studio is of each, and
// what one confirmation pass found. The words are in i18n; this file returns keys and values.

import type { AliasConfirmReport, PersonEmail } from '../api/types';

/** Image types the backend stores as a photo; SVG is refused there. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** The backend's limit on a photo. */
export const MAX_AVATAR_BYTES = 1024 * 1024;

/** The address to show first: the one the backend marks primary, else the profile's own. */
export function primaryEmail(person: { email?: string | null; emails?: PersonEmail[] }): string | null {
  return person.emails?.find((e) => e.primary)?.address ?? (person.email?.trim() || null);
}

/** Whether the photo is one Studio stores (and can remove): its URL ends in the person's id and the image's SHA-256. */
export function isStoredPhoto(url: string | null | undefined): boolean {
  return !!url && /\/avatars\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(url);
}

/** Where a linked (not stored) photo comes from, or null when it is not one a provider serves. */
export function photoProvider(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname === 'avatars.githubusercontent.com' ? 'GitHub' : null;
  } catch {
    return null;
  }
}

/** Why a picked file cannot be a photo: an i18n key with its values, or null when it can. */
export type AvatarRefusal = { key: 'prof_photo_type' } | { key: 'prof_photo_size'; kib: number; max: number };

export function avatarRefusal(file: { type: string; size: number }): AvatarRefusal | null {
  if (!AVATAR_TYPES.includes(file.type)) return { key: 'prof_photo_type' };
  if (file.size > MAX_AVATAR_BYTES)
    return { key: 'prof_photo_size', kib: Math.ceil(file.size / 1024), max: MAX_AVATAR_BYTES / 1024 };
  return null;
}

/** The bytes as base64, in chunks so a 1 MiB photo does not overflow the argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The account kinds a person may claim, in the picker's order. */
export const ALIAS_KINDS = ['github', 'gitlab', 'bitbucket', 'email'] as const;

/** How sure Studio is that an account is the person's; anything unknown reads as a guess. */
export type AliasConfidence = 'confirmed' | 'claimed' | 'suggested';

export function aliasConfidence(value: string): AliasConfidence {
  return value === 'confirmed' || value === 'claimed' ? value : 'suggested';
}

/** The badge each confidence wears. */
export const CONFIDENCE_TONE: Record<AliasConfidence, 'success' | 'info' | 'secondary'> = {
  confirmed: 'success',
  claimed: 'info',
  suggested: 'secondary',
};

type Text = (key: string, values?: Record<string, string | number>) => string;

/** An account kind's name: the known ones translated, anything else as the backend wrote it. */
export function aliasKindLabel(kind: string, t: Text): string {
  return (ALIAS_KINDS as readonly string[]).includes(kind) ? t(`prof_kind_${kind}`) : kind;
}

/** One line on what a confirmation pass found. */
export function confirmSummary(report: AliasConfirmReport, t: Text): string {
  const parts = [
    report.confirmed.length
      ? t('prof_confirmed', {
          list: report.confirmed.map((a) => `${aliasKindLabel(a.kind, t)} ${a.external_id}`).join(', '),
        })
      : t('prof_nothing_to_confirm'),
  ];
  if (report.already_confirmed) parts.push(t('prof_already_confirmed', { count: report.already_confirmed }));
  if (report.skipped_shared) parts.push(t('prof_skipped_shared', { count: report.skipped_shared }));
  if (report.refused.length) parts.push(report.refused.join(' '));
  return parts.join(' ');
}

/** The provider's word for a sign-in: Studio's own sign-in by its name, others as they are. */
export function loginProvider(provider: string, t: Text): string {
  return provider === 'keycloak' ? t('prof_login_studio') : provider;
}
