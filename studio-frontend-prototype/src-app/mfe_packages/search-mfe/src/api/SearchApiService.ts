/** The artifact graph's search (`studio-artifact-ingest`). */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { ArtifactNode } from '../model/search';

export class SearchApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    super({ baseURL: '/cf/studio-artifact-ingest/v1' }, restProtocol, new RestEndpointProtocol(restProtocol));
  }

  /** Semantic when embeddings exist, else lexical; within what the caller may read. */
  readonly artifacts = this.protocol(RestEndpointProtocol).mutation<
    { nodes: ArtifactNode[]; total: number },
    { text: string; limit: number }
  >('POST', '/search');
}
