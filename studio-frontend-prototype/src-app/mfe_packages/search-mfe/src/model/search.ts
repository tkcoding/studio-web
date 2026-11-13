/**
 * Search across the organization in scope, apart from React.
 *
 * What the old prototype let a person find, gathered in one box: its path-bar
 * picker searched the workspaces and their projects by name (`App.tsx`,
 * "Search…"); the artifact graph's own search (`POST
 * /studio-artifact-ingest/v1/search`, semantic when embeddings exist, else
 * lexical) finds the files, issues and pull requests the projects' sources
 * hold. A place is matched here, in the browser — the lists are the
 * organization's own and small; the graph is searched by the server.
 */

/** A workspace or a project of the organization in scope. */
export interface Place {
  kind: 'workspace' | 'project';
  id: string;
  name: string;
  /** The project's workspace; the workspace's own id for a workspace. */
  workspaceId: string;
  workspaceName: string;
}

/**
 * Places whose name matches every word of `query`, best first: a name that
 * starts with the query, then one with a word that does, then any containing
 * it; workspaces before projects on a tie, then by name. An empty query lists
 * nothing — the places are a click away in the path bar.
 */
export function matchPlaces(query: string, places: readonly Place[], limit = 12): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const rank = (place: Place): number => {
    const name = place.name.toLowerCase();
    if (!words.every((word) => name.includes(word) || place.workspaceName.toLowerCase().includes(word))) return -1;
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s\-_./]+/).some((part) => part.startsWith(words[0]))) return 1;
    if (name.includes(q)) return 2;
    return 3;
  };
  return places
    .map((place) => ({ place, rank: rank(place) }))
    .filter((entry) => entry.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.place.kind === b.place.kind ? 0 : a.place.kind === 'workspace' ? -1 : 1) ||
        a.place.name.localeCompare(b.place.name)
    )
    .slice(0, limit)
    .map((entry) => entry.place);
}

/** `ArtifactNodeDto` as the search answers it (its text removed). */
export interface ArtifactNode {
  type_id: string;
  instance_id: string;
  value: {
    path?: string;
    title?: string;
    number?: number;
    full_path?: string;
    login?: string;
    url?: string;
    project_id?: string;
    workspace_id?: string;
    short_sha?: string;
  };
}

const KINDS: Record<string, ArtifactHit['kind']> = {
  'gts.cf.studio.artifact.repo.v1~': 'repo',
  'gts.cf.studio.artifact.file.v1~': 'file',
  'gts.cf.studio.artifact.issue.v1~': 'issue',
  'gts.cf.studio.artifact.pull_request.v1~': 'pullRequest',
  'gts.cf.studio.artifact.commit.v1~': 'commit',
  'gts.cf.studio.artifact.comment.v1~': 'comment',
  'gts.cf.studio.artifact.user.v1~': 'user',
};

/** One thing the graph found, and how it opens. */
export interface ArtifactHit {
  id: string;
  kind: 'repo' | 'file' | 'issue' | 'pullRequest' | 'commit' | 'comment' | 'user' | 'other';
  title: string;
  /** A file's path, an issue's number… what tells two hits apart. */
  detail: string;
  url: string | null;
  projectId: string | null;
  workspaceId: string | null;
  path: string | null;
  /**
   * `editor`: a file of a project in the workspace on screen, opened in the
   * project's IDE (the shell's artifact request keeps the workspace in scope);
   * `project`: a file of a project elsewhere, whose project is opened instead;
   * `link`: where it came from (the provider's page); `none`: nothing to open.
   */
  opens: 'editor' | 'project' | 'link' | 'none';
}

export function artifactHit(node: ArtifactNode, scope: { workspaceId: string | null }): ArtifactHit {
  const kind = KINDS[node.type_id] ?? 'other';
  const v = node.value;
  const path = kind === 'file' && v.path ? v.path : null;
  const title =
    kind === 'file'
      ? (v.path?.split('/').pop() ?? v.path ?? '')
      : kind === 'repo'
        ? (v.full_path ?? '')
        : kind === 'user'
          ? (v.login ?? v.title ?? '')
          : kind === 'commit'
            ? `${v.short_sha ?? ''} ${v.title ?? ''}`.trim()
            : v.number != null
              ? `#${v.number} ${v.title ?? ''}`.trim()
              : (v.title ?? '');
  const detail = kind === 'file' ? (v.path ?? '') : kind === 'repo' ? '' : (v.full_path ?? '');
  const projectId = v.project_id || null;
  const workspaceId = v.workspace_id || null;
  const url = v.url || null;
  let opens: ArtifactHit['opens'] = url ? 'link' : 'none';
  if (path && projectId) {
    opens = workspaceId && workspaceId === scope.workspaceId ? 'editor' : workspaceId ? 'project' : opens;
  }
  return { id: node.instance_id, kind, title: title || node.instance_id, detail, url, projectId, workspaceId, path, opens };
}

/** The shortest query sent to the graph: one letter matches everything. */
export const MIN_ARTIFACT_QUERY = 2;
