/* The pinned section is the top of the rail, so its list algebra is worth
 * pinning down: the two failure shapes are a pin that silently replaces
 * another, and defaults that come back after somebody deliberately cleared
 * them. Both are invisible until they happen to somebody who had built a habit
 * on the list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PINS,
  isPinned,
  loadPins,
  parsePins,
  pinKey,
  savePins,
  togglePin,
  type Pin,
} from "./pins";

const view = (id: string): Pin => ({ kind: "view", id });
const project = (projectId: string, tab: string, name = "Shop"): Pin => ({
  kind: "project",
  projectId,
  workspaceId: "ws-1",
  name,
  tab,
});

describe("pinKey", () => {
  it("tells two sections of the same project apart", () => {
    // "the Specs of X" and "the Components of X" are two things somebody may
    // want side by side; one key for both would make the second replace the
    // first without saying so.
    expect(pinKey(project("p1", "specs"))).not.toBe(pinKey(project("p1", "components")));
  });

  it("ignores the cached name, which is a label and not an identity", () => {
    expect(pinKey(project("p1", "specs", "Shop"))).toBe(pinKey(project("p1", "specs", "Renamed")));
  });

  it("never collides a view with a project", () => {
    expect(pinKey(view("projects"))).not.toBe(pinKey(project("projects", "overview")));
  });
});

describe("togglePin", () => {
  it("appends rather than prepends", () => {
    // Pinning something is not a claim that it outranks what is already there,
    // and a list that reorders under the cursor cannot be learned.
    const pins = togglePin([view("a"), view("b")], view("c"));
    expect(pins.map(pinKey)).toEqual(["view:a", "view:b", "view:c"]);
  });

  it("removes what is already pinned", () => {
    const pins = togglePin([view("a"), view("b")], view("a"));
    expect(pins.map(pinKey)).toEqual(["view:b"]);
  });

  it("matches on identity, so a renamed project unpins itself", () => {
    const pins = togglePin([project("p1", "specs", "Shop")], project("p1", "specs", "Renamed"));
    expect(pins).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const before: Pin[] = [view("a")];
    togglePin(before, view("b"));
    expect(before).toEqual([view("a")]);
  });
});

describe("isPinned", () => {
  it("answers on identity rather than on object equality", () => {
    expect(isPinned([project("p1", "specs", "Shop")], project("p1", "specs", "Renamed"))).toBe(
      true,
    );
    expect(isPinned([view("a")], view("b"))).toBe(false);
  });
});

describe("parsePins", () => {
  it("drops entries this build cannot read and keeps the rest", () => {
    const parsed = parsePins([
      { kind: "view", id: "people" },
      { kind: "view" },
      { kind: "wormhole", id: "x" },
      null,
      "nonsense",
      { kind: "project", projectId: "p1", workspaceId: "ws-1", name: "Shop", tab: "specs" },
      { kind: "project", projectId: "p2" },
    ]);
    expect(parsed.map(pinKey)).toEqual(["view:people", "project:p1:specs"]);
  });

  it("drops a repeat rather than drawing the same row twice", () => {
    const parsed = parsePins([
      { kind: "view", id: "people" },
      { kind: "view", id: "people" },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it("answers an empty list for anything that is not one", () => {
    expect(parsePins(null)).toEqual([]);
    expect(parsePins({ kind: "view", id: "people" })).toEqual([]);
  });
});

describe("loadPins", () => {
  afterEach(() => vi.unstubAllGlobals());

  const store = (value: string | null) => {
    vi.stubGlobal("localStorage", {
      getItem: () => value,
      setItem: () => {},
    });
  };

  it("starts from the defaults when nothing was ever saved", () => {
    store(null);
    expect(loadPins()).toEqual([...DEFAULT_PINS]);
  });

  it("respects an empty saved list instead of restoring the defaults", () => {
    // Unpinning everything is a decision. Reading it as "never chose" would
    // put the three back on the next page load, every time.
    store("[]");
    expect(loadPins()).toEqual([]);
  });

  it("falls back rather than throwing when storage is unusable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });
    expect(loadPins()).toEqual([...DEFAULT_PINS]);
  });

  it("falls back on stored text that is not JSON", () => {
    store("{not json");
    expect(loadPins()).toEqual([...DEFAULT_PINS]);
  });
});

describe("savePins", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("swallows a storage that refuses to be written", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => savePins([view("a")])).not.toThrow();
  });
});
