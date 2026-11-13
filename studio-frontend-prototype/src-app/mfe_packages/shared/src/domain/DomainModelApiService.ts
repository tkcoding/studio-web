/**
 * `studio-domain-model`, for the shell and every MFE that reads the Studio
 * domain model at run time (ADR-0066): the organization's model, one query
 * over a type's objects, and one batch of writes. Per organization
 * (`?organization_id=`): a platform administrator's home tenant is the
 * platform root, whose model is not the organization's on screen.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { GtsCatalog } from './runtime';
import type { DomainMutation, DomainMutationResult, DomainQueryRequest, DomainQueryResult } from './domainQuery';

export const DOMAIN_MODEL_API_BASE_URL = '/cf/studio-domain-model/v1';

/** `GET /studio-domain-model/v1/types`: the organization's Studio domain model. */
export interface DomainTypesResponse {
  ontology: { entities?: unknown[]; buckets?: unknown[] };
  /** Whether this caller may change the model (`domain.model`, ADR-0035). */
  can_edit_model: boolean;
  /** The GTS ids each type and relation kind is registered under. */
  gts?: GtsCatalog;
}

const scoped = (path: string, orgId: string): string =>
  `${path}?${new URLSearchParams({ organization_id: orgId }).toString()}`;

export const domainTypesPath = ({ orgId }: { orgId: string }): string => scoped('/types', orgId);

export class DomainModelApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    super({ baseURL: DOMAIN_MODEL_API_BASE_URL }, restProtocol, new RestEndpointProtocol(restProtocol));
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /** The organization's model, and whether the caller may change it. */
  readonly types = this.protocol(RestEndpointProtocol).queryWith<DomainTypesResponse, { orgId: string }>(
    domainTypesPath
  );

  /** One type's objects filtered, ordered and paged, with relations followed. */
  query(orgId: string) {
    return this.rest.mutation<DomainQueryResult, DomainQueryRequest>('POST', scoped('/query', orgId));
  }

  /** A batch of upserts and patches, checked against the model and the caller's rights. */
  mutate(orgId: string) {
    return this.rest.mutation<DomainMutationResult, DomainMutation>('POST', scoped('/mutate', orgId));
  }
}
