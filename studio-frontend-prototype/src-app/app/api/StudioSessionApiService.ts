/**
 * Studio Session Domain - API Service
 *
 * The project's Theia session (`studio-session`): launched or reused by one
 * `POST`, read by id only where no run follows it.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { SessionSource } from '@constructor-studio/mfe-shared';

export const STUDIO_SESSION_API_BASE_URL = '/cf/studio-session/v1';

export type StudioSessionState = 'starting' | 'running' | 'stopped';

/** `SessionDto`. */
export interface StudioSession {
  id: string;
  workspace_id: string;
  state: StudioSessionState;
  /** The IDE's address with the gate's `?token=`: the frame property only — never the store, the browser address or a log. */
  url: string;
  created_at_epoch_secs: number;
  sources: string[];
  /** The `session.await_ready` run, on a launch's answer while `starting`. */
  ready_run_id?: string;
}

/** The part of `CreateSessionRequest` the portal sends. */
export interface LaunchStudioSessionBody {
  workspace_id: string;
  repos: SessionSource[];
}

function sessionPath({ sessionId }: { sessionId: string }): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

export class StudioSessionApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: STUDIO_SESSION_API_BASE_URL }, restProtocol, restEndpoints);
  }

  /** Idempotent per workspace: 200 for a live session, 201 for a new one. */
  readonly launch = this.protocol(RestEndpointProtocol).mutation<
    StudioSession,
    LaunchStudioSessionBody
  >('POST', '/sessions');

  /** Stops the session and releases what it holds; unsaved work in it is lost. */
  stop(sessionId: string) {
    return this.protocol(RestEndpointProtocol).mutation<void, void>('DELETE', sessionPath({ sessionId }));
  }

  /** One session; the read probes a starting one. Read with `staleTime: 0`. */
  readonly session = this.protocol(RestEndpointProtocol).queryWith<
    StudioSession,
    { sessionId: string }
  >(sessionPath);
}
