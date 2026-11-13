/**
 * Organization › Settings' rules, apart from the markup. The prototype kept
 * an organization's own settings in Admin › Organizations (`org-admin.tsx`'s
 * card for the organization picked in the header); these are its rules.
 */

/** A logo is a small mark: what the backend keeps at most. */
export const MAX_LOGO_BYTES = 256 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type LogoProblem =
  | { kind: 'type' }
  | { kind: 'size'; sizeKb: number; maxKb: number };

/** Why a picked file cannot be a logo, or null when it can be sent. */
export function logoProblem(file: { type: string; size: number }): LogoProblem | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return { kind: 'type' };
  if (file.size > MAX_LOGO_BYTES) {
    return { kind: 'size', sizeKb: Math.ceil(file.size / 1024), maxKb: MAX_LOGO_BYTES / 1024 };
  }
  return null;
}

/** The bytes as base64, in chunks a call's argument list can hold. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const logoSrc = (logo: { content_type: string; data: string }): string =>
  `data:${logo.content_type};base64,${logo.data}`;

/**
 * What the management row offers. The barrier is easy to raise and hard to
 * lower: a self-managed organization that is not the caller's home is asked
 * from inside it, so it offers nothing here; raising it is asked first.
 */
export type ModeAction =
  | { kind: 'request'; target: 'managed' | 'self_managed'; confirm: boolean }
  | { kind: 'inside' };

export function modeAction(selfManaged: boolean, isHome: boolean): ModeAction {
  if (selfManaged && !isHome) return { kind: 'inside' };
  return selfManaged
    ? { kind: 'request', target: 'managed', confirm: false }
    : { kind: 'request', target: 'self_managed', confirm: true };
}

/** The Admin sections that hold the rest of an organization's settings, as the prototype's "Admin settings" led there. */
export const ADMIN_LINKS = [
  { key: 'people', route: '/admin/people' },
  { key: 'access', route: '/admin/access' },
  { key: 'secrets', route: '/admin/secrets' },
  { key: 'connections', route: '/connections' },
  { key: 'organizations', route: '/admin/organizations' },
] as const;
