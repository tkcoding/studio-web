/**
 * The kit library and the installer (ADR-0068 §4–5, ADR-0069 §4), over the
 * `studio-kits` gear: the catalogue, what an organization has installed, and
 * installing a kit as a base kit (the platform, for every organization) or
 * for one organization.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { KitInstallation, ProjectRepository } from '../model/ideKits';

export const KITS_API_BASE_URL = '/cf/studio-kits/v1';

/** One kit in the catalogue (`KitDto`). */
export interface CatalogKit {
  slug: string;
  name: string;
  description: string;
  publisher: string;
  visibility: string;
  source: string;
  repository_url: string;
  default_version: string;
  manifest_path: string;
  /** `builtin` (in Studio's image), `official`, or `organization`. */
  shelf?: string;
  /** The levels the kit places screens on. */
  levels?: string[];
}

export interface CatalogPage {
  items: CatalogKit[];
  total: number;
}

/** One installation (`InstalledKitDto`). */
export interface InstalledKit {
  kit_slug: string;
  version: string;
  shelf: string;
  /** `base` (the platform's, for every organization), `organization`, or `project`. */
  kind: 'base' | 'organization' | 'project';
  installed_by?: string | null;
  installed_at?: string | null;
  /** A built-in kit nobody removed: installed by default. */
  by_default?: boolean;
}

export interface InstalledKits {
  organization_id: string;
  /** Set when the read named a project. */
  project_id?: string | null;
  base: InstalledKit[];
  organization: InstalledKit[];
  /** What the project installed for itself; empty for an organization's read. */
  project?: InstalledKit[];
  effective: InstalledKit[];
}

/** Whose installations a read is about: an organization, or a project in it. */
export interface InstalledScope {
  organizationId?: string;
  projectId?: string;
}

function scopeQuery({ organizationId, projectId }: InstalledScope): string {
  const q = new URLSearchParams();
  if (projectId) q.set('project_id', projectId);
  else if (organizationId) q.set('organization_id', organizationId);
  return q.toString();
}

/** What a kit brings, by the sections of its manifest (ADR-0068 §3, §8). */
export interface KitContents {
  screens: { kind: 'tab' | 'section'; level: string; label: string; route: string | null; slot: string | null }[];
  types: { gts: string; name: string; description: string | null }[];
  rules: { name: string; description: string | null }[];
  functions: { name: string; runtime: 'wasm' | 'agent'; description: string | null }[];
  services: { name: string; description: string | null }[];
  inbox: { id: string; label: string }[];
  mcp_tools: { name: string; description: string | null }[];
  permissions: { reads: string[]; writes: string[]; listens: string[] };
  material: { path: string; description: string | null }[];
  kinds: string[];
  docs: string[];
}

/** Where an organization's own kit came from (`KitOriginDto`). */
export interface KitOrigin {
  connection_id: string;
  provider: string;
  /** `owner/name`. */
  repository: string;
  /** The kit's directory; empty for the repository's root. */
  path: string;
  git_ref: string | null;
  /** The commit it is pinned to. */
  commit: string;
  manifest_file: string;
  added_by: string;
  added_at: string;
  refreshed_at: string | null;
}

/** One kit with what is inside it (GET /studio-kits/v1/catalog/{slug}). */
export interface KitDetail {
  kit: CatalogKit;
  contents: KitContents;
  /** Where the description came from: built-in, kit.json, .cf-studio-kit.toml, kit.gdl — or unknown. */
  manifest: string | null;
  /** Set for a kit of an organization's own shelf. */
  origin?: KitOrigin | null;
}

/** Where a kit is, for the organization's shelf (`ShelfSourceDto`). */
export interface ShelfSource {
  connection_id: string;
  repository: string;
  path?: string;
  ref?: string;
  slug?: string;
}

/** A connection of the organization (studio-connector), as the picker needs it. */
export interface Connection {
  id: string;
  owner_tenant_id: string;
  provider: string;
  label: string;
  account?: string;
  /** personal | workspace | organization */
  scope: string;
}

/** Connections an organization's kit may be read through: its own, shared ones that reach repositories. */
export function shelfConnections(all: Connection[], organizationId: string): Connection[] {
  return all.filter(
    (c) => c.owner_tenant_id === organizationId && c.scope !== 'personal' && ['github', 'gitlab'].includes(c.provider)
  );
}

const org = (organizationId: string) => new URLSearchParams({ organization_id: organizationId }).toString();

/** The organization's connections (studio-connector), for the "from a repository" picker. */
export class ConnectionsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf/studio-connector/v1' }, restProtocol, restEndpoints);
  }

  readonly connections = this.protocol(RestEndpointProtocol).queryWith<{ items: Connection[] }, { organizationId: string }>(
    ({ organizationId }) => `/connections?tenant=${encodeURIComponent(organizationId)}`
  );
}

export class KitsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: KITS_API_BASE_URL }, restProtocol, restEndpoints);
  }

  /** The whole catalogue: the gear pages at 200, and holds far fewer. */
  readonly catalog = this.protocol(RestEndpointProtocol).query<CatalogPage>('/catalog?limit=200');

  readonly describe = this.protocol(RestEndpointProtocol).queryWith<KitDetail, { slug: string }>(
    ({ slug }) => `/catalog/${encodeURIComponent(slug)}`
  );

  readonly installed = this.protocol(RestEndpointProtocol).queryWith<InstalledKits, InstalledScope>(
    (scope) => `/installed-kits?${scopeQuery(scope)}`
  );

  installBase(slug: string) {
    return this.protocol(RestEndpointProtocol).mutation<InstalledKit, Record<string, never>>(
      'PUT',
      `/base-kits/${encodeURIComponent(slug)}`
    );
  }

  removeBase(slug: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>('DELETE', `/base-kits/${encodeURIComponent(slug)}`);
  }

  installForOrganization(slug: string, organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<InstalledKit, Record<string, never>>(
      'PUT',
      `/organization-kits/${encodeURIComponent(slug)}?${org(organizationId)}`
    );
  }

  installForProject(slug: string, projectId: string) {
    return this.protocol(RestEndpointProtocol).mutation<InstalledKit, Record<string, never>>(
      'PUT',
      `/project-kits/${encodeURIComponent(slug)}?${new URLSearchParams({ project_id: projectId })}`
    );
  }

  removeFromProject(slug: string, projectId: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>(
      'DELETE',
      `/project-kits/${encodeURIComponent(slug)}?${new URLSearchParams({ project_id: projectId })}`
    );
  }

  /** The organization's own kits, each with its origin. */
  readonly shelf = this.protocol(RestEndpointProtocol).queryWith<{ items: KitDetail[]; total: number }, { organizationId: string }>(
    ({ organizationId }) => `/organization-shelf?limit=200&${org(organizationId)}`
  );

  previewShelfKit(organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<KitDetail, ShelfSource>(
      'POST',
      `/organization-shelf/preview?${org(organizationId)}`
    );
  }

  addShelfKit(organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<KitDetail, ShelfSource>(
      'POST',
      `/organization-shelf?${org(organizationId)}`
    );
  }

  refreshShelfKit(slug: string, organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<KitDetail, Record<string, never>>(
      'POST',
      `/organization-shelf/${encodeURIComponent(slug)}/refresh?${org(organizationId)}`
    );
  }

  removeShelfKit(slug: string, organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>(
      'DELETE',
      `/organization-shelf/${encodeURIComponent(slug)}?${org(organizationId)}`
    );
  }

  /* ── The project's IDE (the installer `cfs` runs in its session) ── */

  /** The kits `cfs` can install: the official shelf only (the IDE allow-lists them). */
  readonly ideCatalog = this.protocol(RestEndpointProtocol).query<CatalogPage>('/catalog?shelf=official&limit=200');

  readonly ideInstallations = this.protocol(RestEndpointProtocol).queryWith<
    { items: KitInstallation[]; total: number },
    { projectId: string }
  >(({ projectId }) => `/projects/${encodeURIComponent(projectId)}/installations?limit=200`);

  /** 503 while the project has no running IDE session. */
  readonly ideRepositories = this.protocol(RestEndpointProtocol).queryWith<
    { items: ProjectRepository[]; total: number },
    { projectId: string }
  >(({ projectId }) => `/projects/${encodeURIComponent(projectId)}/repositories?limit=200`);

  requestIdeInstallation(projectId: string) {
    return this.protocol(RestEndpointProtocol).mutation<
      KitInstallation,
      { kit_slug: string; version: string; install_mode: 'copy'; scope: 'project' | 'all-repositories' }
    >('POST', `/projects/${encodeURIComponent(projectId)}/installations`);
  }

  /** Writes the kit into one repository through the running IDE. */
  materializeIdeInstallation(projectId: string, slug: string) {
    return this.protocol(RestEndpointProtocol).mutation<KitInstallation, { repository_id?: string }>(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/installations/${encodeURIComponent(slug)}/materialize`
    );
  }

  /** Writes the kit wherever its scope says; repositories already at the version are skipped. 503 without a session. */
  reconcileIdeInstallation(projectId: string, slug: string) {
    return this.protocol(RestEndpointProtocol).mutation<KitInstallation, Record<string, never>>(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/installations/${encodeURIComponent(slug)}/reconcile`
    );
  }

  removeIdeInstallation(projectId: string, slug: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>(
      'DELETE',
      `/projects/${encodeURIComponent(projectId)}/installations/${encodeURIComponent(slug)}`
    );
  }

  removeFromOrganization(slug: string, organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>(
      'DELETE',
      `/organization-kits/${encodeURIComponent(slug)}?${org(organizationId)}`
    );
  }
}
