/** A dialog you can leave with the keyboard.
 *
 *  The five dialogs on the Specs screen — write the missing documents, publish
 *  to a repository, the intake questionnaire, scaffold a gear, the composition
 *  plan — each opened a backdrop with `onClick={onClose}` and nothing else.
 *  Click outside to dismiss, and no other way out: no Escape, no `role`, and
 *  focus left behind on whatever button opened the thing. Somebody who does
 *  not use a mouse could open all five and leave none of them.
 *
 *  This owns the four things a dialog has to do and nothing else. The caller
 *  keeps its own header and body exactly as they were — the headers differ
 *  (one has a back button, two have a subtitle) and folding them in here would
 *  have meant a prop per variation.
 *
 *  1. **Escape closes.** Listened on the document, because focus may be inside
 *     an input that stops the event bubbling through React's tree.
 *  2. **Focus goes in, and comes back.** The element that had focus when the
 *     dialog opened gets it again when the dialog closes, so the reader is
 *     returned to the button they pressed rather than to the top of the page.
 *  3. **Tab stays inside.** `aria-modal` tells assistive technology to ignore
 *     the rest of the page; it does not stop Tab walking into it. The wrap is
 *     what makes the two agree.
 *  4. **It says what it is.** `role="dialog"` with a label, so it is announced
 *     as a dialog rather than as an unexplained pile of text.
 */

import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

/** Everything the browser will put focus on with Tab. `[tabindex="-1"]` is
 *  excluded on purpose: it means "focusable by script, not by Tab", which is
 *  exactly what the dialog itself is. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab should land, given what is focusable and where focus is now.
 *
 *  Pure, and separate from the component, because this is the part with the
 *  edge cases: the two wrap points, the dialog itself counting as "before the
 *  first" so Shift+Tab from it reaches the last control, and an empty dialog
 *  where Tab must go nowhere rather than out.
 *
 *  `null` means "let the browser do what it was going to do".
 */
export function tabTarget<T>(
  items: T[],
  active: T | null,
  shiftKey: boolean,
  /** The dialog itself, which holds focus when it has no controls. */
  container: T | null = null,
): { move: T | null; prevent: boolean } {
  if (items.length === 0) {
    // Nothing to move between; Tab stays put rather than walking out to the
    // page the dialog is covering.
    return { move: null, prevent: true };
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!shiftKey && active === last) return { move: first, prevent: true };
  if (shiftKey && (active === first || (container !== null && active === container))) {
    return { move: last, prevent: true };
  }
  return { move: null, prevent: false };
}

export interface ModalProps {
  /** What to announce it as. The dialog's own visible heading, repeated —
   *  a dialog with no accessible name is announced as "dialog" and nothing
   *  more. */
  label: string;
  onClose: () => void;
  /** Overrides for the card, for the two dialogs that are wider. */
  cardStyle?: CSSProperties;
  /** For a caller that already has its own stylesheet for this. Given, the
   *  inline styles step aside entirely rather than fighting the class over
   *  the same properties. */
  backdropClassName?: string;
  cardClassName?: string;
  children: ReactNode;
}

const BACKDROP: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "6vh 16px",
  zIndex: 50,
  overflowY: "auto",
};

const CARD: CSSProperties = {
  background: "var(--card)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 16,
  width: "min(560px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  boxShadow: "var(--shadow-lg)",
};

export function Modal({
  label,
  onClose,
  cardStyle,
  backdropClassName,
  cardClassName,
  children,
}: ModalProps) {
  const card = useRef<HTMLDivElement | null>(null);
  /** Whoever had focus when this opened, so it can be handed back. */
  const opener = useRef<Element | null>(null);

  const focusable = useCallback(
    () => Array.from(card.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    opener.current = document.activeElement;
    // The first control, or the dialog itself when it has none — a dialog that
    // is only text still has to take focus, or Escape has nothing to act on
    // and the reader is still standing on the page behind.
    const first = focusable()[0] ?? card.current;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const { move, prevent } = tabTarget(
        focusable(),
        document.activeElement as HTMLElement | null,
        e.shiftKey,
        card.current,
      );
      if (prevent) e.preventDefault();
      move?.focus();
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Only if focus is still somewhere in here: a close that already moved
      // focus on purpose (opening the next dialog, say) must not be undone.
      if (card.current?.contains(document.activeElement)) {
        (opener.current as HTMLElement | null)?.focus?.();
      }
    };
  }, [focusable, onClose]);

  return (
    <div
      className={backdropClassName}
      style={backdropClassName ? undefined : BACKDROP}
      onClick={onClose}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cardClassName}
        style={cardClassName ? cardStyle : cardStyle ? { ...CARD, ...cardStyle } : CARD}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
