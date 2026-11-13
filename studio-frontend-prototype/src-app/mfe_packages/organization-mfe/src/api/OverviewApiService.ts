/**
 * The organization overview (ADR-0069 parity: Organization › Overview). The
 * rules — which connection is refused, what is stuck, whose spend it is — are
 * the server's (`studio-backend/src/organizations/overview.rs`), in one read.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { OrgOverview } from '../overview/types';

export class OverviewApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 60000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf/studio-organizations/v1' }, restProtocol, restEndpoints);
  }

  readonly overview = this.protocol(RestEndpointProtocol).queryWith<OrgOverview, { organizationId: string }>(
    ({ organizationId }) => `/overview?${new URLSearchParams({ organization_id: organizationId })}`
  );
}
