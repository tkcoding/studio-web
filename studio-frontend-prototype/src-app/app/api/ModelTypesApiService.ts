/**
 * Which types the Studio domain model has installed for the organization in
 * scope (ADR-0070 §2, §4), for the shell: a screen that shows another kit's
 * type declares it (`presentation.needs`) and shows only where the type is
 * installed. `GET /types` without `include=dormant` already leaves out what a
 * kit left dormant.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';

/** The part of `GET /studio-domain-model/v1/types` the shell reads. */
export interface ModelTypesSummary {
  ontology: { entities?: { id?: string }[] };
}

export class ModelTypesApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf/studio-domain-model/v1' }, restProtocol, restEndpoints);
  }

  readonly types = this.protocol(RestEndpointProtocol).queryWith<ModelTypesSummary, { organizationId: string }>(
    ({ organizationId }) => `/types?${new URLSearchParams({ organization_id: organizationId }).toString()}`
  );
}
