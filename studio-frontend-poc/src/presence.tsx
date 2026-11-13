/** Who is in Studio right now, and a way to say something to them.
 *
 *  Two halves that need each other. The heartbeat is what makes anybody
 *  appear in the list, and the same request is what collects notes written to
 *  you — one call, because a client that has to be here anyway to report
 *  presence should not need a second request to find out it was written to.
 *
 *  What this deliberately is not: a chat. A note reaches somebody who is in
 *  Studio now, within one heartbeat, and is not stored. Writing to somebody
 *  who is not there says so instead of queueing something they would read
 *  tomorrow out of context — that is what the notification connectors are for.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type PresenceEntry, type PresenceMessage } from "./api";
import { DataTable, When } from "./data-table";
import { errText, relTime } from "./format";

/** How often we report in. The server judges by three of these, so missing
 *  one to a sleeping laptop costs nothing. */
const BEAT_MS = 30_000;

/** Say we are here, every BEAT_MS, and surface anything left for us.
 *
 *  `place` is whatever the shell calls the current screen. It changes as the
 *  person moves, and a change beats immediately rather than waiting for the
 *  next tick — the list is most useful when it is about now.
 */
export function usePresence(
  token: string,
  displayName: string | undefined,
  place: string,
  detail?: string,
): { messages: PresenceMessage[]; dismiss: (id: string) => void; online: number } {
  const [messages, setMessages] = useState<PresenceMessage[]>([]);
  const [online, setOnline] = useState(0);
  // Held in a ref so changing where we are does not restart the timer — only
  // what the next beat says.
  const where = useRef({ displayName, place, detail });
  where.current = { displayName, place, detail };

  const beat = useCallback(async () => {
    try {
      const r = await api.presenceHeartbeat(token, {
        display_name: where.current.displayName,
        place: where.current.place,
        detail: where.current.detail,
      });
      setOnline(r.online);
      // Appended, not replaced: the heartbeat hands each note over exactly
      // once, so anything already on screen is the only copy there is.
      if (r.messages.length > 0) setMessages((current) => [...current, ...r.messages]);
    } catch {
      // Presence is a nicety. A backend without the gear, or a network blip,
      // must not put an error on a screen somebody is working in.
    }
  }, [token]);

  useEffect(() => {
    void beat();
    const timer = setInterval(() => void beat(), BEAT_MS);
    // Leaving properly, so the list does not hold somebody for a minute and a
    // half after they closed the tab. Best-effort by nature — a killed tab
    // never runs this, which is exactly why the server also has a timeout.
    const leave = () => void api.presenceLeave(token).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [beat, token]);

  // Beat at once when the screen changes, so the list follows the person
  // rather than trailing half a minute behind them.
  useEffect(() => {
    void beat();
  }, [beat, place, detail]);

  const dismiss = useCallback(
    (id: string) => setMessages((current) => current.filter((m) => m.id !== id)),
    [],
  );

  return { messages, dismiss, online };
}

/** Who is online, for a list that is about people rather than about presence.
 *
 *  Returns the set of ids reported online, and the number reported at all. The
 *  second is what lets a caller tell "nobody is here" from "people are here
 *  but none of them matched the rows I am drawing" — see [`OnlineDot`]'s
 *  caveat about which id each side is keyed by.
 */
export function useOnline(token: string): { ids: Set<string>; reported: number } {
  const [state, setState] = useState<{ ids: Set<string>; reported: number }>({
    ids: new Set(),
    reported: 0,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.presenceOnline(token);
        if (!alive) return;
        setState({ ids: new Set(r.items.map((p) => p.user_id)), reported: r.items.length });
      } catch {
        // A backend without the gear, or a blip. A missing dot is a missing
        // dot; it must not take a list of people down with it.
      }
    };
    void load();
    // The gear's own cadence: polling faster returns the same answer.
    const timer = setInterval(() => void load(), BEAT_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);

  return state;
}

/** The green dot beside somebody who is in Studio right now.
 *
 *  Absent, not grey, when they are not: a list of twenty people with twenty
 *  grey dots says nothing and costs a column's worth of attention.
 *
 *  KEYED BY THE SIGN-IN SUBJECT. The gear records whoever the token says is
 *  calling, and these rows are keyed by the account id the directory returns.
 *  Those are the same value in this deployment and need not be in another, so
 *  a caller that draws these should also say when the gear reported people and
 *  none of them matched — a dot that never lights is worse than no dot,
 *  because nobody can tell it apart from an empty office.
 */
export function OnlineDot({ online }: { online: boolean }) {
  if (!online) return null;
  return <span className="online-dot" title="In Studio right now" aria-label="online" />;
}

/** Notes that arrived, stacked in the corner until they are dismissed.
 *
 *  Nothing auto-hides: the note was not stored anywhere, so a toast that
 *  faded after four seconds while somebody was looking at another window
 *  would be the only copy of it disappearing. */
export function PresenceNotes({
  messages,
  onDismiss,
}: {
  messages: PresenceMessage[];
  onDismiss: (id: string) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="notes" role="status" aria-live="polite">
      {messages.map((m) => (
        <div key={m.id} className="note">
          <div className="note-head">
            <span className="note-from">{m.from_display_name ?? m.from_user_id}</span>
            <span className="note-when">{relTime(new Date(m.sent_ms).toISOString())}</span>
            <button className="note-x" onClick={() => onDismiss(m.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
          <div className="note-text">{m.text}</div>
        </div>
      ))}
    </div>
  );
}

/** The administrator's view: everybody in Studio, where they are, and a box to
 *  write to them. */
export function WhoIsOnline({ token, meId }: { token: string; meId?: string }) {
  const [people, setPeople] = useState<PresenceEntry[] | null>(null);
  const [ttl, setTtl] = useState(90_000);
  const [err, setErr] = useState<string | null>(null);
  const [writingTo, setWritingTo] = useState<PresenceEntry | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.presenceOnline(token);
      setPeople(r.items);
      setTtl(r.online_ttl_ms);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
      setPeople([]);
    }
  }, [token]);

  useEffect(() => {
    void load();
    // Refreshed on the same cadence people report in on: polling faster would
    // show the same answer more often.
    const timer = setInterval(() => void load(), BEAT_MS);
    return () => clearInterval(timer);
  }, [load]);

  const send = async () => {
    if (!writingTo || !text.trim()) return;
    setSending(true);
    setSent(null);
    try {
      const r = await api.presenceSend(token, {
        to_user_id: writingTo.user_id,
        text: text.trim(),
      });
      // The one thing the sender has to read: a note to somebody who left
      // between the list loading and the send is not queued.
      setSent(
        r.delivered
          ? `Delivered — they will see it within ${Math.round(BEAT_MS / 1000)}s.`
          : "Not delivered — they are no longer in Studio, and notes are not queued.",
      );
      if (r.delivered) {
        setText("");
        setWritingTo(null);
      }
    } catch (e) {
      setSent(errText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>In Studio now{people ? ` · ${people.length}` : ""}</h2>
        <button className="ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p className="hint">
        Everybody whose Studio reported in within the last {Math.round(ttl / 1000)} seconds, most
        recently seen first. This is held in the backend process, so a restart empties it until
        each client's next heartbeat — an empty list right after a deploy means nothing.
      </p>
      {err && people !== null && people.length > 0 && <p className="error">{err}</p>}
      <DataTable<PresenceEntry>
        list="presence"
        rows={people === null && err ? [] : people}
        error={people === null || people.length === 0 ? err : null}
        rowKey={(p) => p.user_id}
        rowLabel={(p) => p.display_name ?? p.user_id}
        search={{ placeholder: "Search people" }}
        searchText={(p) => [p.display_name, p.place, p.detail]}
        empty={{ title: "Nobody is in Studio right now." }}
        columns={[
          {
            id: "name",
            header: "Person",
            className: "acell-lead",
            compare: (a, b) => (a.display_name ?? a.user_id).localeCompare(b.display_name ?? b.user_id),
            cell: (p) => (
              <>
                {p.display_name ?? <code>{p.user_id.slice(0, 12)}…</code>}
                {p.user_id === meId && <span className="sub"> (you)</span>}
              </>
            ),
          },
          {
            id: "place",
            header: "Where",
            cell: (p) => (
              <>
                {p.place}
                {p.detail ? <span className="sub"> · {p.detail}</span> : null}
              </>
            ),
          },
          {
            id: "since",
            header: "Here since",
            compare: (a, b) => a.since_ms - b.since_ms,
            cell: (p) => <When iso={new Date(p.since_ms).toISOString()} className="sub" />,
          },
          {
            id: "seen",
            header: "Last seen",
            compare: (a, b) => a.last_seen_ms - b.last_seen_ms,
            cell: (p) => <When iso={new Date(p.last_seen_ms).toISOString()} className="sub" />,
          },
        ]}
        inline={(p) =>
          /* Writing to yourself is not forbidden by the backend, and it is a
             useful way to check the channel works — but it is not what this
             button is for, so it is not offered. */
          p.user_id !== meId ? (
            <button
              onClick={() => {
                setWritingTo(p);
                setSent(null);
              }}
            >
              Message
            </button>
          ) : null
        }
      />

      {writingTo && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head">
            <h2>To {writingTo.display_name ?? writingTo.user_id}</h2>
          </div>
          <textarea
            autoFocus
            rows={3}
            style={{ width: "100%" }}
            placeholder="A note they will see in Studio…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="primary" disabled={sending || !text.trim()} onClick={() => void send()}>
              {sending ? "Sending…" : "Send"}
            </button>
            <button className="ghost" onClick={() => setWritingTo(null)}>
              Cancel
            </button>
          </div>
          <p className="hint">
            Delivered in Studio only, and not stored. If they are not here it says so rather than
            saving it for later — for something that has to survive the session, use a notification
            connector.
          </p>
        </div>
      )}
      {sent && <p className="hint">{sent}</p>}
    </div>
  );
}
