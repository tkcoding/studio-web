/**
 * Which projects, and which of their repositories, this tab has already asked
 * a sync for. The store forgets on reload, and the gear lists only the runs
 * still in flight, so this is what keeps a reload after a failed import from
 * enqueueing every repository again.
 */

const KEY = 'projects/artifact-sync/attempted';

function read(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function attemptedInTab(projectId: string): boolean {
  return read().includes(projectId);
}

export function recordAttempt(projectId: string): void {
  try {
    const ids = read();
    if (!ids.includes(projectId)) ids.push(projectId);
    window.sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage denied: the store still remembers for as long as the tab lives.
  }
}

const REPOS_KEY = 'projects/artifact-sync/requested-repos';

function readRepos(): Record<string, string[]> {
  try {
    const raw = window.sessionStorage.getItem(REPOS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** The repositories of a project this tab has asked a sync for, or recorded as unsyncable. */
export function requestedInTab(projectId: string): string[] {
  const repos = readRepos()[projectId];
  return Array.isArray(repos) ? repos.filter((repo) => typeof repo === 'string') : [];
}

export function recordRequests(projectId: string, repos: readonly string[]): void {
  if (repos.length === 0) return;
  try {
    const all = readRepos();
    all[projectId] = [...new Set([...requestedInTab(projectId), ...repos])];
    window.sessionStorage.setItem(REPOS_KEY, JSON.stringify(all));
  } catch {
    // Storage denied: the import's lines still keep a repository from being asked for twice.
  }
}
