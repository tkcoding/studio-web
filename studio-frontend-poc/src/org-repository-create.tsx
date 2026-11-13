/* Create a new GitHub repository for the organization's gears, from its
 * Repositories list (ADR-0042 §2): the server creates it through an
 * organization-scoped GitHub connection and makes it where "Create a gear"
 * writes. It was the "Create new" of the Gear repository card. */

import { useState } from "react";

import { ApiError, api, type Connection, type OrgGearRepositoryState } from "./api";
import { errText } from "./format";
import { connectionScopeWarning, gearRepoConnections } from "./org-gear-repository";

/** A checkbox beside its words, whatever the page does to labels and inputs. */
const CHECK = { display: "inline-flex", gap: 6, alignItems: "center", flex: "0 0 auto", width: "auto" } as const;
const BOX = { width: 16, minWidth: 0, height: 16, margin: 0, flex: "0 0 auto" } as const;

export function CreateGearRepository({
  token,
  tenantId,
  connections,
  onCreated,
  onCancel,
}: {
  token: string;
  tenantId: string;
  connections: readonly Connection[];
  onCreated: (s: OrgGearRepositoryState) => void;
  onCancel: () => void;
}) {
  const offered = gearRepoConnections(connections, tenantId);
  const [connectionId, setConnectionId] = useState(offered[0]?.id ?? "");
  const [name, setName] = useState("gears");
  const [owner, setOwner] = useState("");
  const [isOrg, setIsOrg] = useState(true);
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warning = connectionScopeWarning(offered.find((c) => c.id === connectionId) ?? null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.createOrgGearRepository(token, {
          connection_id: connectionId,
          name: name.trim(),
          ...(owner.trim() ? { owner: owner.trim() } : {}),
          is_org: isOrg,
          private: isPrivate,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Only an organization administrator can create it." : errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card gear-source-add" data-create-gear-repository>
      <h3>Create a repository for the organization&apos;s gears</h3>
      <p className="hint">
        Studio creates it on GitHub through the connection and makes it where Create a gear writes for a project without a
        gear repository of its own.
      </p>
      <div className="gear-source-form">
        <label>
          Connection
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            {offered.length === 0 && <option value="">no GitHub connection of the organization</option>}
            {offered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.scope}){c.account ? ` · ${c.account}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="gears" />
        </label>
        <label>
          Owner
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="the connection's account" />
        </label>
      </div>
      <div className="row">
        <label style={CHECK}>
          <input type="checkbox" style={BOX} checked={isOrg} onChange={(e) => setIsOrg(e.target.checked)} /> the owner is a GitHub
          organization
        </label>
        <label style={CHECK}>
          <input type="checkbox" style={BOX} checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> private
        </label>
      </div>
      {(warning || error) && <div className="error">{error ?? warning}</div>}
      <div className="row">
        <button type="button" className="primary" disabled={busy || !connectionId || !name.trim()} onClick={() => void create()}>
          {busy ? "Creating…" : "Create and write new gears there"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
