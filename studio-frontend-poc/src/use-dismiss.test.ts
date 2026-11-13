// A menu closes on a press outside it, never on a press inside it.
import { describe, expect, it } from "vitest";

import { isOutside } from "./use-dismiss";

describe("a menu's outside", () => {
  const inside = { nodeType: 1 };
  const root = { contains: (n: unknown) => n === inside } as unknown as Pick<Node, "contains">;
  it("is anything the menu does not contain", () => {
    // Not a DOM node (as a press on the window is): outside.
    expect(isOutside(root, null)).toBe(true);
    expect(isOutside(root, { nodeType: 1 } as unknown as EventTarget)).toBe(true);
    expect(isOutside(root, inside as unknown as EventTarget)).toBe(false);
  });
  it("is nothing while there is no menu", () => {
    expect(isOutside(null, null)).toBe(false);
  });
});
