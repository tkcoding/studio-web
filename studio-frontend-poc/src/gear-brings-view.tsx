// Shown under a candidate gear on the Components tab, before it is added.

import { useEffect, useState } from "react";
import { api, type GearConfig } from "./api";
import { bringsSummary, contractLabel, type GearBrings } from "./gear-brings";

export function BringsWithIt({
  token,
  picks,
  config,
  candidate,
  onClose,
}: {
  token: string;
  picks: string[];
  config: GearConfig;
  candidate: string;
  onClose: () => void;
}) {
  const [read, setRead] = useState<GearBrings | { error: string } | null>(null);

  useEffect(() => {
    let live = true;
    setRead(null);
    api
      .gearBrings(token, picks, candidate, config)
      .then((b) => live && setRead(b))
      .catch((e: unknown) => live && setRead({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
    // The picks and the configuration as keys: a new array or object with the
    // same content is the same question, and an edited configuration is a new
    // one -- it decides vendors and what completion drops (#744).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, candidate, picks.join("\n"), JSON.stringify(config)]);

  return (
    <div className="gb-panel" role="region" aria-label={`What ${candidate} brings with it`}>
      <div className="gb-head">
        <b>What {candidate} brings with it</b>
        <button type="button" className="linklike" onClick={onClose}>
          close
        </button>
      </div>
      {read === null && <div className="gb-muted">Reading the gear catalogue…</div>}
      {read && "error" in read && <div className="gb-err">{read.error}</div>}
      {read && "brought" in read && (
        <>
          <div>{bringsSummary(candidate, read)}</div>
          {read.overlaps.length > 0 && (
            <ul className="gb-list gb-warn">
              {read.overlaps.map((o) => (
                <li key={o.contract}>
                  <b>{contractLabel(o.contract)}</b> would come from {o.brought.join(", ")}
                  {o.already.length > 0 ? <> and is already provided by {o.already.join(", ")}</> : <>, twice</>}.
                </li>
              ))}
            </ul>
          )}
          {read.brought.length > 0 && (
            <ul className="gb-list">
              {read.brought.map((g) => (
                <li key={g.gear}>
                  <code>{g.gear}</code> <span className="gb-muted">— {g.reason}</span>
                  {g.database && <span className="gb-tag">own database</span>}
                </li>
              ))}
            </ul>
          )}
          {read.changes.length > 0 && (
            <ul className="gb-list gb-muted">
              {read.changes.map((c, i) => (
                <li key={i}>
                  {c.added ? "+" : "−"} {c.gear}: {c.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
