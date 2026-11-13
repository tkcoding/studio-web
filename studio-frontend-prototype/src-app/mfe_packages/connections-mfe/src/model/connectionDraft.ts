/**
 * What the Connect source form collects, before anything is sent.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-scope:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-create-write:p2
import { type CreateConnectionBody } from '@constructor-studio/mfe-shared';
import { CONNECTION_SCOPE } from './connection';

export interface ConnectionDraft {
  readonly provider: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly token: string;
}

export const EMPTY_DRAFT: ConnectionDraft = {
  provider: '',
  label: '',
  baseUrl: '',
  token: '',
};

export function isDraftUsable(draft: ConnectionDraft): boolean {
  return draft.provider !== '' && draft.label.trim() !== '' && draft.token.trim() !== '';
}

export function toCreateBody(
  draft: ConnectionDraft,
  ownerTenantId: string
): CreateConnectionBody {
  // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-2
  const body: CreateConnectionBody = {
    provider: draft.provider,
    label: draft.label.trim(),
    token: draft.token,
    scope: CONNECTION_SCOPE,
    owner_tenant_id: ownerTenantId,
  };
  // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-2
  // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-3
  // Absent, not empty: the gear reads an empty string as an installation root.
  const baseUrl = draft.baseUrl.trim();
  if (baseUrl) body.base_url = baseUrl;
  // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-3
  return body;
}
