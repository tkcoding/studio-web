/**
 * Identity Domain - API Service
 *
 * The canonical Studio person and what it belongs to (`studio-user`).
 *
 * Separate from `AccountsApiService` because it is a separate gear on a separate
 * base path: account-management answers "what tenants exist", this answers "who
 * is this person and which organizations are they a member of". The organization
 * list comes from here rather than from the tenant tree — membership is the
 * authority for organization access (ADR-0011 §2), and a home-tenant attribute
 * on the token never was one.
 */

import {
  BaseApiService,
  RestEndpointProtocol,
  RestProtocol,
} from '@gears-frontx/react';
import { RestMockPlugin } from '@gears-frontx/frontx-template-shell';
import type { InvitationList, Membership, MembershipList } from './types';

/** `GET /me`: the person, as far as the header shows them (the rest is Profile's). */
export interface PersonSummary {
  id: string;
  display_name?: string | null;
  email?: string | null;
  /** Usable as is in an `<img>`: a stored photo or the one GitHub serves. */
  avatar_url?: string | null;
}

/** `GET`/`PUT /me/ui-preferences`: the whole map, both ways. */
export interface UiPreferences {
  preferences: Record<string, string>;
}
import { identityMockMap } from './mocks';

export const IDENTITY_API_BASE_URL = '/cf/studio-user/v1';

export class IdentityApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: IDENTITY_API_BASE_URL }, restProtocol, restEndpoints);

    this.registerPlugin(
      restProtocol,
      new RestMockPlugin({ mockMap: identityMockMap, delay: 100 })
    );
  }

  /**
   * The signed-in person's organization memberships, each carrying the role
   * held there.
   *
   * Only ids and roles — `studio-user` does not store organization names, so
   * the shell resolves each one through account-management. An empty list is a
   * valid, expected answer: it means this person has not been given access to
   * an organization yet.
   */
  readonly myMemberships =
    this.protocol(RestEndpointProtocol).query<MembershipList>('/me/memberships');

  /**
   * Invitations waiting for this person, matched to the addresses they have
   * proven — never to one they typed.
   *
   * This is how somebody with no organization gets one without an administrator
   * in the loop (ADR-0018 §2): the invitation was addressed to them, so it is
   * theirs to accept.
   */
  readonly myInvitations =
    this.protocol(RestEndpointProtocol).query<InvitationList>('/me/invitations');

  /**
   * Accept one, by the token that came with it.
   *
   * The membership it returns is the answer — the shell reloads its context
   * from it rather than guessing what changed.
   */
  readonly acceptInvitation = this.protocol(RestEndpointProtocol).mutation<
    Membership,
    { token: string } | { invitation_id: string }
  >('POST', '/me/invitations/accept');

  /** The canonical Studio person: the account button's name and photo, as in the prototype. */
  readonly myPerson = this.protocol(RestEndpointProtocol).query<PersonSummary>('/me');

  /**
   * The person's remembered UI choices — the order they keep a level's tabs
   * in, among others: one map per person, at most 64 short entries
   * (`studio-user`). Read once per session (`preferences/uiPreferences.ts`).
   */
  readonly uiPreferences =
    this.protocol(RestEndpointProtocol).query<UiPreferences>('/me/ui-preferences');

  /** Replace the whole map. Whole rather than merged: an absent key has to be able to mean "forget this one". */
  readonly saveUiPreferences = this.protocol(RestEndpointProtocol).mutation<UiPreferences, UiPreferences>(
    'PUT',
    '/me/ui-preferences'
  );
}
