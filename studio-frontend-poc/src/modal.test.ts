import { describe, expect, it } from "vitest";

import { tabTarget } from "./modal";

/**
 * Where Tab lands inside a dialog.
 *
 * `aria-modal` tells assistive technology to ignore the rest of the page; it
 * does not stop Tab walking into it. This is the part that makes the two
 * agree, and it is tested apart from the component because the wrap points are
 * where it would go wrong — the rest is `addEventListener` and `.focus()`.
 */
describe("tabTarget", () => {
  const [a, b, c] = ["a", "b", "c"];
  const dialog = "dialog";

  it("leaves Tab alone in the middle of the dialog", () => {
    // The browser already does the right thing between the first and the last.
    expect(tabTarget([a, b, c], b, false, dialog)).toEqual({ move: null, prevent: false });
    expect(tabTarget([a, b, c], b, true, dialog)).toEqual({ move: null, prevent: false });
  });

  it("wraps forward from the last control to the first", () => {
    expect(tabTarget([a, b, c], c, false, dialog)).toEqual({ move: a, prevent: true });
  });

  it("wraps backward from the first control to the last", () => {
    expect(tabTarget([a, b, c], a, true, dialog)).toEqual({ move: c, prevent: true });
  });

  it("treats the dialog itself as standing before the first control", () => {
    // It holds focus on open when nothing inside can, so Shift+Tab from there
    // has to reach the last control rather than the page behind.
    expect(tabTarget([a, b, c], dialog, true, dialog)).toEqual({ move: c, prevent: true });
    // Forward from the dialog is the browser's job: the first control is next.
    expect(tabTarget([a, b, c], dialog, false, dialog)).toEqual({ move: null, prevent: false });
  });

  it("keeps Tab inside a dialog with nothing to focus", () => {
    // Nowhere to move, but still nowhere to leave to: a dialog of plain text
    // must not hand focus back to the page it is covering.
    expect(tabTarget([], dialog, false, dialog)).toEqual({ move: null, prevent: true });
    expect(tabTarget([], dialog, true, dialog)).toEqual({ move: null, prevent: true });
  });

  it("handles a dialog with exactly one control", () => {
    // First and last are the same element, so both directions wrap to it.
    expect(tabTarget([a], a, false, dialog)).toEqual({ move: a, prevent: true });
    expect(tabTarget([a], a, true, dialog)).toEqual({ move: a, prevent: true });
  });

  it("does nothing special when focus is somewhere it does not know", () => {
    // Focus outside the dialog is not this function's problem to solve; the
    // component put it inside on mount and the wrap keeps it there.
    expect(tabTarget([a, b], "elsewhere", false, dialog)).toEqual({
      move: null,
      prevent: false,
    });
  });
});
