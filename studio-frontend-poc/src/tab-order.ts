//! The order somebody keeps a band of sections in.
//!
//! The band's own list is the default: the order the work happens in (see
//! PROJECT_TABS). A person who lives in two of them wants those two first, and
//! that is a choice about the person, not the project, so it is kept with
//! their other UI preferences (`/me/ui-preferences`) and follows them to every
//! project and every machine.
//!
//! What is stored is a list of ids, read against the band this build draws:
//! an id the build no longer has is skipped, and a section the stored order
//! never saw (added since) keeps its default place relative to its default
//! neighbours rather than being thrown to the end, where nobody would find it.
//!
//! Nothing here touches the DOM — it is list operations and a string codec.

/** A stored preference value is at most this long (MAX_UI_PREFERENCE_VALUE in
 *  the user-profile gear). One value over it fails the whole save, so the
 *  codec never writes one: ids past the limit are dropped from the tail, and
 *  those sections fall back to their default order behind the rest. */
export const MAX_ORDER_LENGTH = 128;

export function parseOrder(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function serializeOrder(ids: readonly string[]): string {
  let out = "";
  for (const id of ids) {
    const next = out ? `${out},${id}` : id;
    if (next.length > MAX_ORDER_LENGTH) break;
    out = next;
  }
  return out;
}

/** The band's tabs in the stored order.
 *
 *  Stored ids come first in their stored order; a tab the stored order does
 *  not name is placed right after the tab that precedes it by default (or
 *  first, when it is the default's first), so a new section lands where its
 *  authors put it rather than at the end. */
export function applyOrder<T extends { id: string }>(tabs: readonly T[], stored: readonly string[]): T[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const out: T[] = stored.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const placed = new Set(out.map((t) => t.id));
  tabs.forEach((tab, i) => {
    if (placed.has(tab.id)) return;
    // Behind the nearest default predecessor already in the list.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((t) => t.id === tabs[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, tab);
    placed.add(tab.id);
  });
  return out;
}

/** `ids` with `id` moved to `to` (an index into the result). */
export function moveTo(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, id);
  return out;
}

/** Whether `ids` is just the default order — then nothing needs storing. */
export function isDefaultOrder(ids: readonly string[], defaults: readonly { id: string }[]): boolean {
  return ids.length === defaults.length && ids.every((id, i) => defaults[i].id === id);
}
