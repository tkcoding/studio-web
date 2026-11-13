/* A tier's component repositories, one row per repository (ADR-0042 and
 * ADR-0046 on one page). A repository plays up to two roles, kept in two
 * places on the server:
 *
 * - **in the catalogue**: a catalogue source, synced into the Components list
 *   (descriptions, versions, activity) -- `CatalogRepoSource`;
 * - **built from**: a gear repository the Gearbox engine reads as its corpus
 *   when it composes a product -- a `gear-repository` connection.
 *
 * Seen side by side, a repository the products are built from but the
 * catalogue does not list (or lists at another ref) stops being invisible. */

import type { CatalogRepoSource, GearboxSource } from "./api";
import type { GearRepositoryRow } from "./gear-repositories";

/** One repository and its two roles. */
export interface RepositoryRoles {
  /** `owner/repo`, as the first role that names it spells it. */
  repo: string;
  /** Its catalogue sources: one per mode (gears, frontx, kits). */
  catalogue: CatalogRepoSource[];
  /** Its gear repository, when the engine reads it. */
  engine: GearRepositoryRow | null;
  /** The engine reads it only because the platform has no gear repository:
   *  the deployment's corpus, which nobody added here. */
  fallback: boolean;
}

const key = (repo: string) => repo.trim().toLowerCase().replace(/\.git$/, "");

/** Both lists as one, a repository once: the engine's order first (it is the
 *  order the corpus reads them in), then what only the catalogue lists. */
export function repositoryRoles(
  engine: readonly GearRepositoryRow[],
  catalogue: readonly CatalogRepoSource[],
  fallback: GearboxSource | null = null,
): RepositoryRoles[] {
  const out: RepositoryRoles[] = [];
  const at = new Map<string, RepositoryRoles>();
  const row = (repo: string) => {
    let r = at.get(key(repo));
    if (!r) {
      r = { repo: repo.trim(), catalogue: [], engine: null, fallback: false };
      at.set(key(repo), r);
      out.push(r);
    }
    return r;
  };
  for (const e of engine) row(e.repo).engine = e;
  if (fallback && engine.length === 0) {
    const r = row(fallback.repo);
    r.engine = { connection: null, sourceId: fallback.source_id, repo: fallback.repo, ref: fallback.git_ref, read: fallback };
    r.fallback = true;
  }
  for (const c of catalogue) if (c.repo.trim()) row(c.repo).catalogue.push(c);
  return out;
}

/** A ref as people read it: blank and HEAD are the default branch. */
export function refLabel(ref: string | null | undefined): string {
  return !ref || ref === "HEAD" ? "default branch" : ref;
}

/** What is odd about a row, in a line; `null` when nothing. */
export function rolesNote(r: RepositoryRoles): string | null {
  const gears = r.catalogue.find((c) => (c.mode || "gears") === "gears");
  if (r.engine && r.catalogue.length === 0)
    return r.fallback
      ? "Products are built from the deployment's corpus, which the catalogue does not list. Build from a listed repository instead."
      : "Products are built from it, but the catalogue does not list it.";
  if (r.engine && gears && refLabel(gears.git_ref) !== refLabel(r.engine.ref))
    return `The catalogue reads ${refLabel(gears.git_ref)}, products are built from ${refLabel(r.engine.ref)}.`;
  return null;
}
