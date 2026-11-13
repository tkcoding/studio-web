/**
 * What kits apply where (ADR-0068 §5, ADR-0069 §4), for the shell: a kit's
 * screens show only where the kit is installed — as a base kit, by the
 * organization, or, inside a project, by the project itself.
 *
 * The base URL and path are the ones kits-mfe's own service uses, so both read
 * one cache entry: installing a kit on a Kits tab refreshes the tabs.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';

/** One micro-frontend package of a kit, as `GET /studio-kits/v1/mfe-manifests` lists it. */
export interface KitMfeManifest {
  kit_slug: string;
  version: string;
  package: string;
  /** Where the package's files are served, through the gateway, ending in `/`. */
  base_path: string;
  /** The package's `mfe-manifest.json`; null when it does not read. */
  config: unknown;
  /** Why `config` is null. */
  error?: string | null;
}

export interface InstalledKitsSummary {
  organization_id: string;
  project_id?: string | null;
  effective: { kit_slug: string; version?: string }[];
}

export interface KitMfeManifestList {
  organization_id: string;
  project_id?: string | null;
  items: KitMfeManifest[];
  total: number;
}

/** An organization, or a project in it: the project's read includes its organization's and the base kits. */
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

export class InstalledKitsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf/studio-kits/v1' }, restProtocol, restEndpoints);
  }

  readonly installed = this.protocol(RestEndpointProtocol).queryWith<InstalledKitsSummary, InstalledScope>(
    (scope) => `/installed-kits?${scopeQuery(scope)}`
  );

  /** The micro-frontends of the kits effective in the scope (ADR-0068 phase 5): `mfe/runtimeKits.ts`. */
  readonly mfeManifests = this.protocol(RestEndpointProtocol).queryWith<KitMfeManifestList, InstalledScope>(
    (scope) => `/mfe-manifests?${scopeQuery(scope)}`
  );
}
