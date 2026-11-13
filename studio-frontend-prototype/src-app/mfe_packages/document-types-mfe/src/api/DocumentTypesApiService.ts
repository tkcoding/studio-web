/**
 * What Workspace › Document types reads and writes (ported from the
 * prototype's client, ADR-0069 §5): the workspace's effective document types
 * and saving one as the workspace's own (`studio-documents`), and which type
 * keys the spec-quality analyser accepts (`studio-spec-quality`).
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { DocType, DocTypeList, SpecQualityCapabilities, UpsertDocTypeBody } from './types';

export class DocumentTypesApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  /** The workspace's effective types: built-in, the organization's, and its own. */
  readonly types = this.protocol(RestEndpointProtocol).queryWith<DocTypeList, { workspaceId: string }>(
    ({ workspaceId }) => `/studio-documents/v1/workspaces/${encodeURIComponent(workspaceId)}/types`
  );

  /** The type keys the analyser accepts, asked of the service rather than restated here. */
  readonly capabilities = this.protocol(RestEndpointProtocol).query<SpecQualityCapabilities>(
    '/studio-spec-quality/v1/capabilities'
  );

  /** Save a type as the workspace's own, overriding one of the same key it inherits. */
  upsertType(workspaceId: string) {
    return this.protocol(RestEndpointProtocol).mutation<DocType, UpsertDocTypeBody>('POST', `/studio-documents/v1/workspaces/${encodeURIComponent(workspaceId)}/types`);
  }
}
