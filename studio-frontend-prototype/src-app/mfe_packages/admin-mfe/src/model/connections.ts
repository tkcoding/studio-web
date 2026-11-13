// From the prototype at 00828880: `App.tsx`'s connectors constants (CATEGORIES, MISSING_MEANS, HEALTH_TTL_MS,
// ORG_ONLY_PROVIDER, Reach), `environments.ts`'s environmentsByConnection, `gear-repositories.ts`'s GEAR_REPOSITORY
// and `project-sources.ts`'s supportsPullRequests/repoKey/hasRepository/withPicked — the pure parts, unchanged
// (`project-sources.ts` itself also calls the api, so it did not move whole). Titles and blurbs are in i18n.

import type { ProjectSource } from '@constructor-studio/mfe-shared';
import type { ConnectorProvider, EnvironmentUse, RemoteRepo, StoredConnection } from '../api/types';

/** Provider groups in the picker, in its order. Keys match `ConnectorDriver::category()`. */
export const CATEGORY_KEYS = ['source_code', 'ai', 'notification', 'cluster', 'registry', 'compute'] as const;

/** The kinds whose absence the "Not connected yet" line explains (the prototype's MISSING_MEANS). */
export const MISSING_EXPLAINED: readonly string[] = ['source_code', 'ai', 'notification', 'cluster'];

/** How long a connection's answer to a test is trusted before it is asked again. */
export const HEALTH_TTL_MS = 5 * 60_000;

/** The id of a gear-repository connection (ADR-0046). */
export const GEAR_REPOSITORY = 'gear-repository';

/** A provider whose connections only the organization holds: a cluster or a registry, which only the server uses. */
export const orgOnlyProvider = (p: { provider: string; category?: string }): boolean =>
  p.category === 'cluster' || p.category === 'registry' || p.provider === 'kubernetes' || p.provider === 'registry';

/** Where a connection is attached, and how widely its token is readable. */
export type Reach = 'organization' | 'workspace' | 'personal';

/** The reach a newly picked provider starts with on the organization's page. */
export function reachFor(provider: Pick<ConnectorProvider, 'provider' | 'sign_in'>, current: Reach): Reach {
  // A signed-in account is the person's own (ADR-0049 §5).
  if (provider.sign_in) return 'personal';
  // An environment takes only a cluster the organization holds.
  if (provider.provider === 'kubernetes' || provider.provider === 'registry') return 'organization';
  return current;
}

/** The organization's page lists the shared connections: never a person's own. */
export function sharedConnections(connections: readonly StoredConnection[]): StoredConnection[] {
  return connections.filter((c) => c.scope !== 'personal');
}

/** The profile lists the caller's own: the connections stored as personal. */
export function personalConnections(connections: readonly StoredConnection[]): StoredConnection[] {
  return connections.filter((c) => c.scope === 'personal');
}

/** What a person may connect as their own: anything but a cluster or a registry, which only the organization holds. */
export function personalProviders<P extends { provider: string; category?: string }>(providers: readonly P[]): P[] {
  return providers.filter((p) => !orgOnlyProvider(p));
}

/** The kinds this Studio offers that nothing is connected for yet. */
export function missingCategories(
  providers: readonly Pick<ConnectorProvider, 'provider' | 'category'>[],
  connections: readonly Pick<StoredConnection, 'provider'>[]
): string[] {
  const categoryOf = (p: string) => providers.find((x) => x.provider === p)?.category;
  return CATEGORY_KEYS.filter(
    (key) => providers.some((p) => p.category === key) && !connections.some((c) => categoryOf(c.provider) === key)
  );
}

/** A connection's address, shown only when it is not the provider's default. */
export function nonDefaultAddress(baseUrl: string, defaultUrl: string): string | null {
  if (!baseUrl || baseUrl.replace(/\/$/, '') === defaultUrl.replace(/\/$/, '')) return null;
  return baseUrl.replace(/^https?:\/\//, '');
}

/** Which environments deploy with each cluster or registry connection. */
export function environmentsByConnection(environments: readonly EnvironmentUse[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of environments) {
    out.set(e.connection_id, [...(out.get(e.connection_id) ?? []), e.name]);
    if (e.registry_connection_id) out.set(e.registry_connection_id, [...(out.get(e.registry_connection_id) ?? []), e.name]);
  }
  return out;
}

/** How the IDE's "Share with the team" lands edits. */
export type ShareMode = 'branch' | 'pull_request';

/** Whether shares through `connection` can open a pull request: GitHub only for now. */
export function supportsPullRequests(connection: Pick<StoredConnection, 'provider'> | null | undefined): boolean {
  return connection?.provider === 'github';
}

/** What names a repository: host and path, case and `.git` aside. */
export function repoKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
    return path ? `${u.hostname}/${path}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Whether the config already lists the repository at `url`. */
export function hasRepository(sources: readonly ProjectSource[] | undefined, url: string): boolean {
  const key = repoKey(url);
  return !!key && (sources ?? []).some((s) => repoKey(s.clone_url) === key);
}

/** `sources` with the picked repositories added through `connection`; one already listed is not added twice. */
export function withPicked(
  sources: readonly ProjectSource[] | undefined,
  connection: Pick<StoredConnection, 'id'>,
  picks: readonly RemoteRepo[],
  shareMode: ShareMode = 'branch'
): { sources: ProjectSource[]; added: number } {
  const out = [...(sources ?? [])];
  let added = 0;
  for (const r of picks) {
    if (hasRepository(out, r.clone_url)) continue;
    out.push({
      connection_id: connection.id,
      full_path: r.full_path,
      clone_url: r.clone_url,
      ...(r.default_branch ? { branch: r.default_branch } : {}),
      share_mode: shareMode,
    });
    added += 1;
  }
  return { sources: out, added };
}
