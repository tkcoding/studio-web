/**
 * Presence Domain - API Service
 *
 * `studio-presence`: who is in Studio right now. The shell reports in on a
 * heartbeat and, on the same call, collects the notes somebody left for the
 * person (the prototype's `usePresence`, `presence.tsx`). The administrator's
 * list of who is here is Admin › System's.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';

export const PRESENCE_API_BASE_URL = '/cf/studio-presence/v1';

/** Somebody in Studio (`PresenceDto`). */
export interface PresenceEntry {
  user_id: string;
  display_name?: string | null;
  tenant_id: string;
  place: string;
  detail?: string | null;
  since_ms: number;
  last_seen_ms: number;
}

/** A note left for the caller: handed over once by the heartbeat and not stored. */
export interface PresenceNote {
  id: string;
  from_user_id: string;
  from_display_name?: string | null;
  text: string;
  sent_ms: number;
}

/** `HeartbeatRequest`: the user id is the token's; these are labels beside it. */
export interface HeartbeatBody {
  display_name?: string;
  place?: string;
  detail?: string;
}

/** `HeartbeatDto`. */
export interface Heartbeat {
  me: PresenceEntry;
  messages: PresenceNote[];
  /** Everyone in Studio now, the caller included. */
  online: number;
}

export class PresenceApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: PRESENCE_API_BASE_URL }, restProtocol, restEndpoints);
  }

  /** Say the caller is still here, and collect anything left for them. */
  readonly heartbeat = this.protocol(RestEndpointProtocol).mutation<Heartbeat, HeartbeatBody>('POST', '/me');

  /** Leave without waiting for the presence to lapse. */
  readonly leave = this.protocol(RestEndpointProtocol).mutation<void, void>('DELETE', '/me');
}
