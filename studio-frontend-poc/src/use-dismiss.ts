// A menu stays open until the person is done with it: a press outside it, or
// Escape, closes it. Closing on mouse-leave did not work: the gap between a
// button and the menu under it counts as leaving, so the menu folded away
// before the pointer reached it.

import { useEffect, type RefObject } from "react";

/** Whether a press at `target` lands outside `root`. */
export function isOutside(root: Pick<Node, "contains"> | null, target: EventTarget | null): boolean {
  const node = target && typeof (target as Node).nodeType === "number" ? (target as Node) : null;
  return !!root && !(node && root.contains(node));
}

/** Call `close` when, while `open`, the person presses outside `ref` or hits
 *  Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (isOutside(ref.current, e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}
