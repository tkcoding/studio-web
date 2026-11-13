// Under a document on the Specs tab: a brief for its reviewers, every review
// remark on it from the pull requests that changed it (including the ones a
// merge left open), a reply that goes back to the thread, and the decisions
// recorded on its requirements.

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import {
  decisionFromRemark,
  orderChanges,
  remarkState,
  type Decision,
  type Remark,
  type Remarks,
  type ReviewBrief,
} from "./remarks";

const TONE = {
  late: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  wait: { bg: "var(--info-soft)", fg: "var(--info)" },
  ok: { bg: "var(--success-soft)", fg: "var(--success)" },
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BriefPanel({ token, projectId, path }: { token: string; projectId: string; path: string }) {
  const [brief, setBrief] = useState<ReviewBrief | { error: string } | "loading" | null>(null);
  const ask = async () => {
    setBrief("loading");
    try {
      setBrief(await api.reviewBrief(token, projectId, path));
    } catch (e) {
      setBrief({ error: errText(e) });
    }
  };
  return (
    <div className="dq-panel">
      <div className="dq-title">
        Brief for reviewers{" "}
        {brief === null && (
          <button className="rv-link" onClick={() => void ask()} title="Written on your own model key">
            Write it
          </button>
        )}
      </div>
      {brief === "loading" && <div className="dq-muted">Reading the document and what changed…</div>}
      {brief && brief !== "loading" && "error" in brief && <div className="rv-err">{brief.error}</div>}
      {brief && brief !== "loading" && "problem" in brief && (
        <>
          <div>
            <b>Problem.</b> {brief.problem}
          </div>
          {brief.roles.length > 0 && <div className="dq-muted">For: {brief.roles.join(", ")}</div>}
          {brief.scope && (
            <div>
              <b>Scope.</b> {brief.scope}
              {brief.out_of_scope.length > 0 && <span className="dq-muted"> Not: {brief.out_of_scope.join("; ")}</span>}
            </div>
          )}
          {brief.assumptions.length > 0 && (
            <div>
              <b>Assumptions.</b>
              <ul className="dq-experts">
                {brief.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.open_decisions.length > 0 && (
            <div>
              <b>To decide.</b>
              <ul className="dq-experts">
                {brief.open_decisions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.changes.length > 0 && (
            <div>
              <b>Changed since {brief.base_ref ? brief.base_ref.slice(0, 7) : "the previous version"}.</b>
              <ul className="dq-experts">
                {orderChanges(brief.changes).map((c) => (
                  <li key={c.id}>
                    <code>{c.id}</code> {c.kind} — {c.meaning ? <b>changes what is required</b> : "rewording"}
                    {c.why && <span className="dq-muted"> · {c.why}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="dq-muted">
            Written by {brief.provider} {brief.model}. Changes are computed from the requirements; the model only says
            whether each changes what is required.
          </div>
        </>
      )}
    </div>
  );
}

export function RemarksPanel({ token, projectId, path }: { token: string; projectId: string; path: string }) {
  const [remarks, setRemarks] = useState<Remarks | { error: string } | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([
        api.remarks(token, projectId, path),
        api.decisions(token, projectId, path).catch(() => ({ items: [] as Decision[], total: 0 })),
      ]);
      setRemarks(r);
      setDecisions(d.items);
    } catch (e) {
      setRemarks({ error: errText(e) });
    }
  }, [token, projectId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (r: Remark) => {
    setBusy(true);
    setErr(null);
    try {
      await api.replyToRemark(token, projectId, r.repo, r.thread_id, reply);
      setReply("");
      setReplying(null);
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (r: Remark) => {
    const draft = decisionFromRemark(r, path);
    const statement = window.prompt("The decision, as it should be recorded", draft.statement);
    if (!statement) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createDecision(token, { project_id: projectId, ...draft, statement });
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (remarks === null) return null;
  if ("error" in remarks) return <div className="dq-panel dq-muted">Remarks: {remarks.error}</div>;
  return (
    <div className="dq-panel">
      <div className="dq-title">
        Remarks{remarks.total > 0 ? ` (${remarks.total})` : ""}
        {remarks.left_open > 0 && (
          <span className="ing-state" style={{ background: TONE.late.bg, color: TONE.late.fg, marginLeft: 6 }}>
            {remarks.left_open} left open after merge
          </span>
        )}
      </div>
      {err && <div className="rv-err">{err}</div>}
      {!remarks.reached && <div className="dq-muted">No repository connection of this project can be asked.</div>}
      {remarks.reached && remarks.items.length === 0 && (
        <div className="dq-muted">No pull request that changed this document has review threads on it.</div>
      )}
      {remarks.items.map((r) => {
        const st = remarkState(r);
        return (
          <div key={r.thread_id} className="dq-q">
            <div>
              <span className="ing-state" style={{ background: TONE[st.tone].bg, color: TONE[st.tone].fg }}>
                {st.label}
              </span>{" "}
              {r.pull_url ? (
                <a href={r.pull_url} target="_blank" rel="noreferrer">
                  #{r.pull_number}
                </a>
              ) : (
                `#${r.pull_number}`
              )}{" "}
              {r.line != null && <span className="dq-muted">line {r.line}</span>}
              {r.outdated && <span className="dq-muted"> · outdated</span>}
            </div>
            {r.comments.map((c, i) => (
              <div key={i} className={i === 0 ? "" : "dq-muted"}>
                <b>{c.author ?? "someone"}:</b> {c.body}
              </div>
            ))}
            <div className="rv-decide">
              {replying === r.thread_id ? (
                <>
                  <input
                    aria-label="Reply"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Your reply, posted to the pull request"
                  />
                  <button disabled={busy || !reply.trim()} onClick={() => void send(r)}>
                    Send
                  </button>
                  <button onClick={() => setReplying(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="rv-link" onClick={() => setReplying(r.thread_id)}>
                    Reply
                  </button>
                  <button className="rv-link" disabled={busy} onClick={() => void decide(r)}>
                    Record as a decision
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {decisions.length > 0 && (
        <div className="dq-q">
          <b>Decisions on this document</b>
          <ul className="dq-experts">
            {decisions.map((d) => (
              <li key={d.id}>
                {d.statement}{" "}
                <span className="dq-muted">
                  — {d.decided_by_name ?? "a member"}, {d.decided_at.slice(0, 10)}
                  {d.requirements.length > 0 && <> · {d.requirements.join(", ")}</>}
                  {d.source_url && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={d.source_url} target="_blank" rel="noreferrer">
                        where
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
