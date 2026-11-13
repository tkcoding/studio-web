// Under a document on the Specs tab: what it leaves out of the project's
// domain, the words it uses where the project named things otherwise, and,
// for each entity asked about, who changed the documents that describe it.

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { expertLine, questionSentence, type DomainExpert, type DomainQuestions, type TermDrift } from "./domain-questions";

export function DomainQuestionsPanel({ token, projectId, path }: { token: string; projectId: string; path: string }) {
  const [read, setRead] = useState<DomainQuestions | { error: string } | null>(null);
  const [drift, setDrift] = useState<TermDrift[]>([]);
  const [experts, setExperts] = useState<Record<string, DomainExpert[] | "loading" | { error: string }>>({});
  // Which document the panel shows: an answer for an earlier one is dropped,
  // because the same entity can be asked about under the next (#744).
  const shownFor = useRef(0);

  useEffect(() => {
    let live = true;
    shownFor.current += 1;
    setRead(null);
    setExperts({});
    api
      .domainQuestions(token, projectId, path)
      .then((r) => live && setRead(r))
      .catch((e: unknown) => live && setRead({ error: e instanceof Error ? e.message : String(e) }));
    api
      .termDrift(token, projectId, path)
      .then((r) => live && setDrift(r.items))
      .catch(() => live && setDrift([]));
    return () => {
      live = false;
    };
  }, [token, projectId, path]);

  const ask = async (entity: string) => {
    const asked = shownFor.current;
    setExperts((x) => ({ ...x, [entity]: "loading" }));
    try {
      const r = await api.domainExperts(token, projectId, entity);
      if (asked === shownFor.current) setExperts((x) => ({ ...x, [entity]: r.items }));
    } catch (e) {
      if (asked === shownFor.current)
        setExperts((x) => ({ ...x, [entity]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  if (read === null) return null;
  if ("error" in read) return <div className="dq-panel dq-muted">Domain questions: {read.error}</div>;
  if (!read.built) {
    return (
      <div className="dq-panel dq-muted">
        Domain questions appear once the project&apos;s domain model is built (Domain model tab).
      </div>
    );
  }
  if (read.items.length === 0 && drift.length === 0) return null;
  return (
    <div className="dq-panel">
      <div className="dq-title">Domain questions</div>
      {read.items.map((q) => {
        const found = experts[q.entity];
        return (
          <div key={q.entity} className="dq-q">
            <div>{questionSentence(q)}</div>
            <div className="dq-muted">
              {q.facts} fact{q.facts === 1 ? "" : "s"} in {q.documents.join(", ")}
              {q.example?.quote && <> · “{q.example.quote}”</>}
            </div>
            {found === undefined ? (
              <button className="rv-link" onClick={() => void ask(q.entity)}>
                Whom to ask about {q.entity}?
              </button>
            ) : found === "loading" ? (
              <div className="dq-muted">Reading the history of those documents…</div>
            ) : "error" in found ? (
              <div className="dq-muted">{found.error}</div>
            ) : found.length === 0 ? (
              <div className="dq-muted">Nobody found: no repository connection reaches those documents.</div>
            ) : (
              <ul className="dq-experts">
                {found.map((e) => (
                  <li key={e.person}>
                    <b>{e.person}</b> — {expertLine(e)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {drift.length > 0 && (
        <div className="dq-drift">
          {drift.map((d, i) => (
            <div key={i}>
              Line {d.line}: “{d.used}” — the project calls it <b>{d.project_name}</b>.
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
