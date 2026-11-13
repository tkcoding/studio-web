/* Where Organization › Components syncs its catalogue from: the platform
 * Gears repository, the FrontX micro-frontends repository, two kit
 * repositories (each through a connection) and/or crates.io. This browser
 * keeps its choice for the next sync; the server keeps the repositories too,
 * so the scheduled sync reads the same ones (ADR-0041).
 *
 * Taken unchanged out of the prototype's components-catalog.tsx (at
 * 00828880), where it sat inside the view; only the storage is a parameter. */

/** One repository source: a connection + repo + ref. */
export interface RepoSel {
  enabled: boolean;
  connectionId: string;
  repo: string;
  gitRef: string;
}

export interface Sources {
  cratesIo: boolean;
  keyword: string;
  gears: RepoSel;
  frontx: RepoSel;
  kits: RepoSel;
  kitsPm: RepoSel;
}

export type RepoKey = "gears" | "frontx" | "kits" | "kitsPm";

/** The branches worth one click; `HEAD` is the repository's default branch. */
export const BRANCH_CHOICES: { value: string; label: string }[] = [
  { value: "HEAD", label: "HEAD (default branch)" },
  { value: "main", label: "main" },
  { value: "develop", label: "develop" },
];
/** Sentinel for "Other…": `~` is forbidden in a git ref name. */
export const CUSTOM_BRANCH = "~custom";

export const DEFAULT_SOURCES: Sources = {
  cratesIo: true,
  keyword: "constructorfabric",
  gears: { enabled: false, connectionId: "", repo: "constructorfabric/gears-rust", gitRef: "HEAD" },
  // FrontX is developed on `develop`.
  frontx: { enabled: false, connectionId: "", repo: "constructorfabric/gears-frontx", gitRef: "develop" },
  kits: { enabled: false, connectionId: "", repo: "constructorfabric/studio-kit-sdlc", gitRef: "HEAD" },
  // A MULTI-kit repository: its root manifest holds one `[[kits]]` entry per kit.
  kitsPm: { enabled: false, connectionId: "", repo: "constructorfabric/studio-kits-pm", gitRef: "HEAD" },
};

export const SOURCES_KEY = "cf.components.sources";

type Store = Pick<Storage, "getItem" | "setItem">;

export function loadSources(store: Store | null): Sources {
  try {
    const raw = store?.getItem(SOURCES_KEY);
    if (raw) return { ...DEFAULT_SOURCES, ...(JSON.parse(raw) as Partial<Sources>) };
  } catch {
    /* private mode / no storage — fall back to defaults */
  }
  return DEFAULT_SOURCES;
}

export function saveSources(store: Store | null, s: Sources): void {
  try {
    store?.setItem(SOURCES_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface RepoBody {
  tenant: string;
  connection_id: string | null;
  repo: string;
  git_ref: string | null;
  mode: string;
}

/** The POST body for /sync derived from the selection, or an error string. */
export function syncBody(
  s: Sources,
  tenantId: string | undefined | null,
): { crates_io: string | null; repositories: RepoBody[] } | string {
  const crates_io = s.cratesIo ? s.keyword.trim() || "constructorfabric" : null;
  const repositories: RepoBody[] = [];
  const pairs: [string, RepoSel][] = [
    ["gears", s.gears],
    ["frontx", s.frontx],
    ["kits", s.kits],
    ["kits", s.kitsPm],
  ];
  for (const [mode, sel] of pairs) {
    if (!sel.enabled) continue;
    if (!tenantId) return "No workspace/organization in context to read connections from.";
    if (!sel.repo.trim()) return `Enter the ${mode} repository (owner/name).`;
    repositories.push({
      tenant: tenantId,
      connection_id: sel.connectionId || null,
      repo: sel.repo.trim(),
      git_ref: sel.gitRef.trim() || null,
      mode,
    });
  }
  if (!crates_io && repositories.length === 0) return "Enable at least one source.";
  return { crates_io, repositories };
}
