//! What somebody keeps at the top of the navigation rail.
//!
//! The rail used to open with a group called WORK — Workspaces, People,
//! Connections — which was not a category so much as the three surfaces that
//! were left after concept v2 moved everything else onto a project. Three
//! unrelated destinations under a heading that claims they belong together is a
//! heading that has stopped meaning anything, and the slot above PLATFORM is
//! the most valuable one in the rail.
//!
//! So it holds what this person always needs instead, which is a different
//! thing per person and per week: a destination, or one project's own section.
//! Those three were the defaults until the rail followed the path: they are
//! the organization level's own sections now, so pinning them by default
//! would list them twice. Nothing is pinned until somebody pins it.
//!
//! Nothing here touches the DOM or the API — a pin is a list operation and a
//! string key, and the rail is where that gets drawn.

/** A destination in the rail's own list (`view === id`). */
export interface ViewPin {
  kind: "view";
  id: string;
}

/** One project, opened at one of its sections.
 *
 *  Carries the name because the rail has to draw the row before anything has
 *  fetched that project, and a row that says nothing until a request lands is
 *  a row that flickers on every page load. It is a cache of a label, not the
 *  truth: a renamed project is re-pinned, or shows its old name until it is. */
export interface ProjectPin {
  kind: "project";
  projectId: string;
  /** The workspace tenant the project hangs under — the rail has to restore
   *  both halves of the crumb, not just the leaf. */
  workspaceId: string;
  name: string;
  tab: string;
}

export type Pin = ViewPin | ProjectPin;

/** Identity of a pin, for comparison and for React keys.
 *
 *  A project's section is part of it: "the Specs of X" and "the Components of
 *  X" are two things somebody may want side by side, and collapsing them would
 *  make the second pin silently replace the first. */
export function pinKey(pin: Pin): string {
  return pin.kind === "view" ? `view:${pin.id}` : `project:${pin.projectId}:${pin.tab}`;
}

export function isPinned(pins: readonly Pin[], pin: Pin): boolean {
  const key = pinKey(pin);
  return pins.some((p) => pinKey(p) === key);
}

/** Pin it, or unpin it if it is already there.
 *
 *  A new pin goes to the END. Pinning something is not a claim that it matters
 *  more than what is already pinned, and a list that reorders itself under the
 *  cursor is a list nobody can build a habit on. */
export function togglePin(pins: readonly Pin[], pin: Pin): Pin[] {
  const key = pinKey(pin);
  const without = pins.filter((p) => pinKey(p) !== key);
  return without.length === pins.length ? [...pins, pin] : without;
}

/** Nothing: every level lists its own sections (see LEVEL_NAV). */
export const DEFAULT_PINS: readonly Pin[] = [];

const KEY = "studio.pins";

/** Drop anything that is not a pin this build understands.
 *
 *  The store is a browser's, so it holds whatever an older or newer build wrote
 *  — and one unreadable entry must not cost the rest of the list. */
export function parsePins(raw: unknown): Pin[] {
  if (!Array.isArray(raw)) return [];
  const out: Pin[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    let pin: Pin | null = null;
    if (e.kind === "view" && typeof e.id === "string" && e.id) {
      pin = { kind: "view", id: e.id };
    } else if (
      e.kind === "project" &&
      typeof e.projectId === "string" &&
      e.projectId &&
      typeof e.workspaceId === "string" &&
      typeof e.name === "string" &&
      typeof e.tab === "string" &&
      e.tab
    ) {
      pin = {
        kind: "project",
        projectId: e.projectId,
        workspaceId: e.workspaceId,
        name: e.name,
        tab: e.tab,
      };
    }
    if (!pin) continue;
    const key = pinKey(pin);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pin);
  }
  return out;
}

/** What is pinned, or the defaults when nothing has been saved.
 *
 *  An empty SAVED list is a real answer — somebody unpinned everything — and
 *  must not be read as "never chosen", or the defaults would come back every
 *  time the rail is drawn. That is why the absence of the key is what falls
 *  back, not the emptiness of the list. */
export function loadPins(): Pin[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [...DEFAULT_PINS];
    return parsePins(JSON.parse(raw));
  } catch {
    // Private mode, blocked storage, or something that is not JSON.
    return [...DEFAULT_PINS];
  }
}

export function savePins(pins: readonly Pin[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    /* ignore — the rail still works for this session */
  }
}
