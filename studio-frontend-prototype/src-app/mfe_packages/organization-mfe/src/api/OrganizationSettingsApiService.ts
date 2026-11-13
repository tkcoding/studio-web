/**
 * What Organization › Settings writes besides the account system's rename and
 * delete (those are `AccountsApiService`'s): the organization's logo
 * (`studio-organizations`) and a request to convert it between managed and
 * self-managed (account-management's dual-consent conversion). The same
 * routes the prototype's Admin › Organizations card called.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';

export interface OrganizationLogo {
  content_type: string;
  /** The image, base64. */
  data: string;
  digest?: string;
}

export interface ConversionRequest {
  request_id?: string;
  id?: string;
  tenant_id?: string;
  target_mode: string;
  status: string;
}

export type ManagementMode = 'managed' | 'self_managed';

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export class OrganizationSettingsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    super({ baseURL: '/cf' }, restProtocol, new RestEndpointProtocol(restProtocol));
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /** The organization's logo; 404 when it has none. */
  readonly logo = this.protocol(RestEndpointProtocol).queryWith<OrganizationLogo, { orgId: string }>(
    ({ orgId }) => `/studio-organizations/v1/logo?${q({ organization_id: orgId })}`
  );

  setLogo(orgId: string) {
    return this.rest.mutation<OrganizationLogo, { content_type: string; data: string }>(
      'PUT',
      `/studio-organizations/v1/logo?${q({ organization_id: orgId })}`
    );
  }

  deleteLogo(orgId: string) {
    return this.rest.mutation<void, void>('DELETE', `/studio-organizations/v1/logo?${q({ organization_id: orgId })}`);
  }

  requestConversion(tenantId: string) {
    return this.rest.mutation<ConversionRequest, { target_mode: ManagementMode; comment: string }>(
      'POST',
      `/account-management/v1/tenants/${encodeURIComponent(tenantId)}/conversions`
    );
  }
}
