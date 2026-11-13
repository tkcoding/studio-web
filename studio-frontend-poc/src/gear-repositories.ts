/* The platform's gear repositories (ADR-0046): connections of the
 * `gear-repository` kind in the root tenant, which the Gearbox engine reads
 * together as its corpus. What the Sources page shows of each, joined with
 * what the engine last read. */

import type { Connection, GearboxSource, GearboxStatus } from "./api";

export const GEAR_REPOSITORY = "gear-repository";

/** One row of the Sources page: the connection, and what the engine read. */
export interface GearRepositoryRow {
  /** The connection; null when the viewer may not read the platform's
   *  connections and the row comes from what the engine read. */
  connection: Connection | null;
  sourceId: string;
  /** `owner/repo`. */
  repo: string;
  /** Blank: the default branch. */
  ref: string;
  /** What the engine last read of it; null before the engine has. */
  read: GearboxSource | null;
}

/** `owner/repo` from `https://github.com/owner/repo(.git)`, or null. */
export function repositoryOf(url: string): string | null {
  const m = /^https:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The source id the server gives a repository when none is typed: its name,
 *  lowercase, `_` and `.` as `-`. */
export function defaultSourceId(url: string): string {
  const repo = repositoryOf(url);
  return repo ? repo.split("/")[1].toLowerCase().replace(/[_.]/g, "-") : "";
}

/** Whether `id` is a source id the engine takes as a directory name. */
export function isSourceId(id: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id);
}

/** The tenant's own gear repositories, oldest first (the engine's order),
 *  each with what the engine last read of it. */
export function gearRepositoryRows(
  connections: readonly Connection[],
  tenant: string,
  status: GearboxStatus | null,
): GearRepositoryRow[] {
  const read = status?.sources ?? [];
  return connections
    .filter((c) => c.provider === GEAR_REPOSITORY && c.owner_tenant_id === tenant)
    .sort((a, b) => a.created_at_epoch_secs - b.created_at_epoch_secs)
    .map((c) => ({
      connection: c,
      sourceId: c.options?.source_id ?? "",
      repo: repositoryOf(c.base_url) ?? c.base_url,
      ref: c.options?.ref ?? "",
      read: read.find((s) => s.connection_id === c.id) ?? null,
    }));
}

/** A tier's gear repositories as the engine read them, for a viewer who may
 *  not read its connections (every organization's member, for the
 *  platform's): the same rows, read-only. A source with no tier is the
 *  platform's (a backend from before ADR-0046 phase 3). */
export function gearRepositoryRowsFromStatus(
  status: GearboxStatus | null,
  tier: "platform" | "organization" = "platform",
): GearRepositoryRow[] {
  return (status?.sources ?? [])
    .filter((s) => !!s.connection_id && (s.tier ?? "platform") === tier)
    .map((s) => ({ connection: null, sourceId: s.source_id, repo: s.repo, ref: s.git_ref, read: s }));
}

/** The organization's repository "Create a gear" writes into (ADR-0046
 *  phase 3): the one marked `create_target`, else the first it added; its
 *  connection id, or null with none. */
export function createTargetOf(rows: readonly GearRepositoryRow[]): string | null {
  const marked = rows.find((r) => r.connection?.options?.create_target === "true");
  return (marked ?? rows.find((r) => r.connection))?.connection?.id ?? null;
}

/** While the platform has no gear repository, the engine reads the
 *  deployment's corpus: the one source with no connection. */
export function deploymentCorpus(status: GearboxStatus | null): GearboxSource | null {
  return status?.sources?.find((s) => !s.connection_id) ?? null;
}

/** "49 gears at 70a5354" / "not read yet". */
export function readLine(read: GearboxSource | null): string {
  if (!read) return "not read yet";
  const at = read.commit ? ` at ${read.commit.slice(0, 7)}` : "";
  return `${read.gears} gear${read.gears === 1 ? "" : "s"}${at}`;
}
