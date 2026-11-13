/**
 * Studio AI — the assistant docked to the right edge of the shell.
 *
 * Real, not a mock: it talks to the mini-chat gear (createChat + streamMessage).
 * A single chat is created lazily on first question and reused, so the widget
 * keeps a short thread without spamming the backend. Read-only context for now —
 * it answers about what the portal shows; it does not act on the user's behalf.
 *
 * It used to float over the bottom-right corner of whatever screen was open.
 * The product docks it instead, as the third column of the shell grid — 48px of
 * rail at rest, 368px open — so it takes room from the content rather than
 * covering it. That is why `open` is a PROP and not state: the grid track lives
 * on .shell-body, so the shell has to know the panel's width, and two copies of
 * that boolean would drift apart the first time either side changed it.
 *
 * Styling lives in styles.css under `.studio-ai`.
 */
import { useState } from "react";
import { api } from "./api";
import { ArrowUpIcon, ChevronRightIcon, SparkleIcon } from "./icons";

export function StudioAI({
  token,
  open,
  onOpenChange,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setErr(null);
    setAnswer("");
    try {
      let id = chatId;
      if (!id) {
        const c = await api.createChat(token, "Portal assistant");
        id = c.id;
        setChatId(id);
      }
      await api.streamMessage(token, id, content, (full) => setAnswer(full));
    } catch {
      // mini-chat can be absent (no LLM key) or the token can lapse — say so
      // plainly instead of a spinner that never resolves.
      setErr("Studio AI is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  const send = (text: string) => {
    setQ("");
    void ask(text);
  };

  if (!open) {
    // The rail: one control in a 48px column, nothing else. It is a button
    // rather than a clickable div because at this width the mark IS the whole
    // affordance, and it has to be reachable from the keyboard.
    return (
      <aside className="studio-ai collapsed" aria-label="Studio AI">
        <button
          className="sa-rail-open"
          aria-label="Open Studio AI"
          aria-expanded={false}
          title="Studio AI"
          onClick={() => onOpenChange(true)}
        >
          <span className="sa-mark">
            <SparkleIcon size={20} />
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="studio-ai" aria-label="Studio AI">
      <div className="sa-head">
        <span className="sa-mark">
          <SparkleIcon size={20} />
        </span>
        <span className="sa-title">Studio AI</span>
        <button
          className="ghost"
          aria-label="Collapse Studio AI"
          aria-expanded
          title="Collapse"
          onClick={() => onOpenChange(false)}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="sa-ctx">
        <div className="sa-ctx-label">Context · Studio portal · read-only</div>

        {answer === null && !err ? (
          <button className="sa-chip" onClick={() => send("What should I look at first?")}>
            <SparkleIcon size={14} /> What should I look at first?
          </button>
        ) : (
          // No maxHeight any more: the dock is full-height, so the thread takes
          // whatever the head and the composer leave it (.sa-ctx is the flex
          // child that grows) instead of capping itself at 220px and stranding
          // empty column below.
          <div className="sa-thread" data-error={err ? "true" : "false"}>
            {err ?? (answer || (busy ? "…" : ""))}
          </div>
        )}
      </div>

      <form
        className="sa-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <input
          placeholder="Ask Studio…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={busy}
        />
        <button
          className="sa-send"
          type="submit"
          disabled={busy || !q.trim()}
          title="Send"
          aria-label="Send"
        >
          <ArrowUpIcon />
        </button>
      </form>
    </aside>
  );
}
