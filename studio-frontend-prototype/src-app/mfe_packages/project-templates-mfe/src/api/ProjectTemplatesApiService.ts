/**
 * What Workspace › Project templates reads and writes (ported from the
 * prototype's client, ADR-0069 §5): a tenant's project templates, kept by
 * `studio-organizations` as `project-type` domain objects and inherited down
 * the tenant tree, and the kit catalogue (`studio-kits`) a template ticks kits
 * from.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { ProjectTemplatesDoc } from '../model/project-types';

const tenant = (tenantId: string) => new URLSearchParams({ tenant_id: tenantId }).toString();

/** `GET /studio-organizations/v1/project-types`: what the tenant sets itself, and what applies there. */
export interface ProjectTypesRead {
  /** The tenant's own list; absent when it inherits. Read through `parseTemplates`. */
  own?: unknown | null;
  /** Its own, else the nearest ancestor's; absent when nobody set any. */
  resolved?: unknown | null;
}

/** One kit in the catalogue (`KitDto`), as far as the editor needs it. */
export interface CatalogKit {
  slug: string;
  name: string;
  description?: string;
}

export interface CatalogPage {
  items: CatalogKit[];
  total: number;
}

export class ProjectTemplatesApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  /** The project templates at a tenant (organization or workspace). */
  readonly projectTypes = this.protocol(RestEndpointProtocol).queryWith<ProjectTypesRead, { tenantId: string }>(
    ({ tenantId }) => `/studio-organizations/v1/project-types?${tenant(tenantId)}`
  );

  /** The whole kit catalogue: the gear pages at 200, and holds far fewer. */
  readonly kits = this.protocol(RestEndpointProtocol).query<CatalogPage>('/studio-kits/v1/catalog?limit=200');

  /** Replace a tenant's own list; its workspaces inherit it unless they set their own. */
  putProjectTypes(tenantId: string) {
    return this.protocol(RestEndpointProtocol).mutation<unknown, ProjectTemplatesDoc>(
      'PUT',
      `/studio-organizations/v1/project-types?${tenant(tenantId)}`
    );
  }

  /** Drop a tenant's own list, so what it inherits applies again. */
  deleteProjectTypes(tenantId: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>(
      'DELETE',
      `/studio-organizations/v1/project-types?${tenant(tenantId)}`
    );
  }
}
