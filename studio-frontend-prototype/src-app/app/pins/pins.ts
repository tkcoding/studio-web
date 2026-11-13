//! What somebody keeps within one click: the pins.
//!
//! From the prototype's `pins.ts` (00828880), with its rules kept and its
//! shape changed. There a pin was a rail destination (`view`) or one
//! project's section (`project` + `tab`), because that is what the prototype's
//! rail could open. Here every place in the portal is an address (ADR-0028), so
//! a pin is the address of a section — the screen's token, the level context
//! (organization, workspace, project) and the section — plus the words to draw
//! it with before anything has been read.
//!
//! The rules that carry over unchanged:
//! - a section is part of a pin's identity: "the Specs of X" and "the Team of
//!   X" are two pins, and the second must not silently replace the first;
//! - a new pin goes to the END: pinning is not a claim that it matters more
//!   than what is already pinned, and a list that reorders itself under the
//!   cursor is a list nobody can build a habit on;
//! - nothing is pinned until somebody pins it;
//! - the store is a browser's, so it holds whatever an older or newer build
//!   wrote, and one unreadable entry must not cost the rest of the list;
//! - an empty SAVED list is a real answer (somebody unpinned everything); only
//!   the absence of the key falls back to the defaults.
//!
//! Kept per browser, as in the prototype: a pin is a list of addresses with
//! their labels, and the person's `/me/ui-preferences` record holds 128
//! characters a value — a choice, not a payload (`MAX_UI_PREFERENCE_VALUE`).
//!
//! Nothing here touches the DOM or the API beyond the storage accessors.

/** The address a pin opens: the shell's route without the editor's artifact. */
export interface PinRoute {
  token: string;
  org?: string;
  workspace?: string;
  project?: string;
  section?: string;
}

export interface Pin {
  route: PinRoute;
  /** The section's label, as its tab draws it. */
  label: string;
  /**
   * Where it is, outermost first — organization, workspace, project names. A
   * cache of labels, not the truth: a renamed project shows its old name until
   * it is pinned again.
   */
  where: string[];
}

const ROUTE_PARTS = ['token', 'org', 'workspace', 'project', 'section'] as const;

/** Identity of a pin, for comparison and for React keys. */
export function pinKey(pin: Pin): string {
  return ROUTE_PARTS.map((part) => pin.route[part] ?? '').join('|');
}

export function isPinned(pins: readonly Pin[], pin: Pin): boolean {
  const key = pinKey(pin);
  return pins.some((p) => pinKey(p) === key);
}

/** Pin it, or unpin it if it is already there. A new pin goes to the end. */
export function togglePin(pins: readonly Pin[], pin: Pin): Pin[] {
  const key = pinKey(pin);
  const without = pins.filter((p) => pinKey(p) !== key);
  return without.length === pins.length ? [...pins, pin] : without;
}

/** Nothing: every level lists its own sections in its tabs. */
export const DEFAULT_PINS: readonly Pin[] = [];

export const PINS_KEY = 'studio.pins.v2';

const optionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

/** Drop anything that is not a pin this build understands. */
export function parsePins(raw: unknown): Pin[] {
  if (!Array.isArray(raw)) return [];
  const out: Pin[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const route = e.route as Record<string, unknown> | undefined;
    if (!route || typeof route !== 'object') continue;
    if (typeof route.token !== 'string' || !route.token) continue;
    if (!ROUTE_PARTS.every((part) => optionalString(route[part]))) continue;
    if (typeof e.label !== 'string' || !e.label) continue;
    const where = Array.isArray(e.where) ? e.where.filter((w): w is string => typeof w === 'string') : [];
    const parts: Record<string, string> = {};
    for (const part of ROUTE_PARTS) {
      const value = route[part];
      if (typeof value === 'string' && value) parts[part] = value;
    }
    const pin: Pin = { route: parts as unknown as PinRoute, label: e.label, where };
    const key = pinKey(pin);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pin);
  }
  return out;
}

/** What is pinned, or the defaults when nothing has been saved. */
export function loadPins(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Pin[] {
  try {
    const raw = storage?.getItem(PINS_KEY) ?? null;
    if (raw === null) return [...DEFAULT_PINS];
    return parsePins(JSON.parse(raw));
  } catch {
    // Private mode, blocked storage, or something that is not JSON.
    return [...DEFAULT_PINS];
  }
}

export function savePins(pins: readonly Pin[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* ignore — the pins still work for this session */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
