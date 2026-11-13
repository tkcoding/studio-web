/** studio-artifact-ingest — the graph of what a project's repositories contain */

import {
  BaseApiService,
  RestEndpointProtocol,
  RestProtocol,
} from '@gears-frontx/react';
import type {
  ArtifactNodeListDto,
  DetachSourceBody,
  SourceDetachQueuedDto,
  ReconcileRequest,
  ReconcileResponse,
  SourceActivityListDto,
  SyncBody,
  SyncEnqueuedDto,
} from './artifactTypes';
import { IdempotencyKeyPlugin } from './idempotencyKeyPlugin';

export const ARTIFACT_INGEST_API_BASE_URL = '/cf/studio-artifact-ingest/v1';

/** `POST /sync`: the one route here that starts a run. */
export const SYNC_PATH = '/sync';

/** `POST /sources/detach?project_id=`: a source taken out as one run (#1042). */
export const DETACH_PATH = '/sources/detach';

/** Whether a request URL, as the plugins see it (base included), is `POST /sync`'s. */
export function startsSync(url: string): boolean {
  return url.split('?')[0] === `${ARTIFACT_INGEST_API_BASE_URL}${SYNC_PATH}`;
}

/** Whether a request URL starts a run here: a sync, or a source's detach. */
export function startsWork(url: string): boolean {
  return startsSync(url) || url.split('?')[0] === `${ARTIFACT_INGEST_API_BASE_URL}${DETACH_PATH}`;
}

/**
 * A page is cheap now, but the read still fires on every window focus without
 * this; the shared fetch cache uses the same 30 s.
 */
const NODES_STALE_TIME_MS = 30_000;

export interface NodesParams {
  scope: string;
  type?: string;
  repo?: string;
  sort?: 'updated';
  q?: string;
  offset?: number;
  limit?: number;
}

function nodesPath({ scope, type, repo, sort, q, offset, limit }: NodesParams): string {
  const search = new URLSearchParams({ scope });
  if (type) search.set('type', type);
  if (repo) search.set('repo', repo);
  if (sort) search.set('sort', sort);
  if (q) search.set('q', q);
  if (offset) search.set('offset', String(offset));
  if (limit) search.set('limit', String(limit));
  return `/nodes?${search.toString()}`;
}

export class ArtifactIngestApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // `POST /sync` and `POST /sources/detach` start a run (202 + run_id): a
    // retry must answer that run.
    restProtocol.plugins.add(new IdempotencyKeyPlugin(startsWork));

    super({ baseURL: ARTIFACT_INGEST_API_BASE_URL }, restProtocol, restEndpoints);
  }

  // @cpt-dod:cpt-studiofrontend-dod-project-artifacts-scope:p1
  // @cpt-dod:cpt-studiofrontend-dod-project-artifacts-page:p1
  // TODO: ask the framework team for a `queryWith` that takes its own cacheKey.
  // The key is `[baseURL, 'GET', resolvedPath, params]`, and the query string is
  // glued into `resolvedPath`, so `/nodes` has no prefix under which its pages
  // sit
  readonly nodes = this.protocol(RestEndpointProtocol).queryWith<
    ArtifactNodeListDto,
    NodesParams
  >(nodesPath, { staleTime: NODES_STALE_TIME_MS });

  readonly sync = this.protocol(RestEndpointProtocol).mutation<SyncEnqueuedDto, SyncBody>(
    'POST',
    SYNC_PATH
  );

  /** Pull requests and commits per repository of a workspace or project, over the last 7 days. */
  readonly sourceActivity = this.protocol(RestEndpointProtocol).queryWith<
    SourceActivityListDto,
    { scope: string }
  >(({ scope }) => `/source-activity?${new URLSearchParams({ scope })}`);

  /**
   * Takes a source out of the project and forgets what was synced from it, as
   * one durable run the backend owns (#1042): the config write and the prune
   * that the browser used to make one after the other.
   */
  detachSource(projectId: string) {
    return this.protocol(RestEndpointProtocol).mutation<SourceDetachQueuedDto, DetachSourceBody>(
      'POST',
      `${DETACH_PATH}?${new URLSearchParams({ project_id: projectId })}`
    );
  }

  /** Forgets every repository synced into the scope that `keep` does not name. */
  readonly reconcile = this.protocol(RestEndpointProtocol).mutation<
    ReconcileResponse,
    ReconcileRequest
  >('POST', '/reconcile');
}
