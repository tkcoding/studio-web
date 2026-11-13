/**
 * What the Activity kit reads and writes:
 *
 * - Activity: the project's feed of checks and comments, ordered and named by
 *   the gear that owns the nodes (`studio-artifact-ingest`,
 *   `artifact_ingest/activity.rs`).
 * - Timeline: `milestone` objects of the Studio domain model (ADR-0066),
 *   read with one `POST /query` and written with `POST /mutate`; the model
 *   itself (`GET /types`) says whether the type is installed and which fields
 *   it has. `milestone` is project-lifecycle's type (ADR-0070 §7); this kit
 *   only shows it.
 *
 * The domain model is the organization's (`?organization_id=`), as the
 * prototype's `orgScoped` named it.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { ActivityFeed, DomainMutation, DomainQuery, DomainQueryResult, DomainTypesResponse } from './types';

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export class ActivityApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 60000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  readonly activity = this.protocol(RestEndpointProtocol).queryWith<ActivityFeed, { projectId: string }>(
    ({ projectId }) => `/studio-artifact-ingest/v1/activity?${q({ project_id: projectId })}`
  );

  /** The installed model: without `include=dormant`, so a dormant `milestone` is absent (ADR-0070 §4). */
  readonly domainTypes = this.protocol(RestEndpointProtocol).queryWith<DomainTypesResponse, { orgId: string }>(
    ({ orgId }) => `/studio-domain-model/v1/types?${q({ organization_id: orgId })}`
  );

  /** A read: a POST, so a mutation descriptor, but it answers 200 and writes nothing. */
  queryDomain(orgId: string) {
    return this.protocol(RestEndpointProtocol).mutation<DomainQueryResult, DomainQuery>(
      'POST',
      `/studio-domain-model/v1/query?${q({ organization_id: orgId })}`
    );
  }

  /** Change domain objects in one batch, each checked against the model and the caller's rights. */
  mutateDomain(orgId: string) {
    return this.protocol(RestEndpointProtocol).mutation<{ results: unknown[] }, DomainMutation>(
      'POST',
      `/studio-domain-model/v1/mutate?${q({ organization_id: orgId })}`
    );
  }
}
