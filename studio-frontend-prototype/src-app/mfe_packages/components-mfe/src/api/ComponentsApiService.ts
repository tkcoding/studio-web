/**
 * What the Components kit reads and writes, ported from the prototype's
 * client (ADR-0069 §5): the `studio-components-catalog` gear — the
 * organization's registry and catalogue, the field schemas a component page
 * is drawn against, the platform's sources and its publication requests —
 * plus what it borrows: GitHub connections (`studio-connector`), the kit
 * registry (`studio-kits`), people's names (`studio-user`) and the one
 * `studio-tasks` run a sync is waited on through.
 *
 * Every catalogue route names the organization on screen (`organization_id`)
 * when there is one: a caller's home tenant need not be it — a platform
 * administrator's is the platform root (the prototype's `orgScoped`).
 */

import { BaseApiService, RestEndpointProtocol, RestPlugin, RestProtocol, type RestRequestContext } from '@gears-frontx/react';
import type {
  CatalogNode,
  CatalogRepoSource,
  Colleague,
  ComponentValues,
  Connection,
  FieldSchema,
  GearCurator,
  OrgMember,
  Page,
  PlatformSources,
  PublicationRequest,
  RegistryDecisionInput,
  RegistryDeclareInput,
  RegistryDeclareResult,
  RegistryEntry,
  RegistryProjectWalk,
  RegistryReadiness,
  RegistrySuggestion,
  StudioKit,
  StudioProfile,
  TaskRun,
} from './types';
import type { ComponentSnapshot } from '../model/field-trend';

export const CATALOG = '/studio-components-catalog/v1';

/** The page size the paged lists are read in. */
export const PAGE = 200;

/** `path` naming the organization on screen, when there is one. */
export function orgScoped(path: string, org: string | null | undefined): string {
  if (!org || /[?&]organization_id=/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(org)}`;
}

/** A registry entry's own route. */
export function entryPath(name: string, rest = ''): string {
  return `${CATALOG}/registry/${encodeURIComponent(name)}${rest}`;
}

/** A source as the server takes it: without the marks it answers with. */
export function bareSource(s: CatalogRepoSource): CatalogRepoSource {
  const out = { ...s };
  delete out.shadowed_by_platform;
  return out;
}

/** The two POSTs that start background work: a lost answer retried answers
 *  the run the first one started instead of a second (D1). */
const startsSync = (url: string) => /\/studio-components-catalog\/v1\/(platform\/)?sync(\?|$)/.test(url);

class SyncIdempotencyPlugin extends RestPlugin {
  onRequest(context: RestRequestContext): RestRequestContext {
    if (context.method !== 'POST' || !startsSync(context.url) || context.headers['Idempotency-Key'] !== undefined) {
      return context;
    }
    return { ...context, headers: { ...context.headers, 'Idempotency-Key': crypto.randomUUID() } };
  }
}

type Org = { org: string | null };

/** The body of a catalogue sync naming its sources; none means the stored ones. */
export interface SyncBody {
  crates_io: string | null;
  repositories: CatalogRepoSource[];
}

export class ComponentsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 60000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
    restProtocol.plugins.add(new SyncIdempotencyPlugin());
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── the registry (ADR-0041) ── */

  readonly registry = this.protocol(RestEndpointProtocol).queryWith<{ items: RegistryEntry[]; total: number }, Org>(({ org }) =>
    orgScoped(`${CATALOG}/registry?limit=500`, org)
  );

  /** One entry with its decisions, newest first. */
  readonly registryEntry = this.protocol(RestEndpointProtocol).queryWith<RegistryEntry, Org & { name: string }>(
    ({ org, name }) => orgScoped(entryPath(name), org)
  );

  readonly registryProjects = this.protocol(RestEndpointProtocol).queryWith<
    { items: RegistryProjectWalk[]; total: number },
    Org
  >(({ org }) => orgScoped(`${CATALOG}/registry/projects`, org));

  readonly registryExcludedProjects = this.protocol(RestEndpointProtocol).queryWith<{ project_ids: string[] }, Org>(
    ({ org }) => orgScoped(`${CATALOG}/registry/excluded-projects`, org)
  );

  /** Whether an entry could leave its project as a crate of its own (ADR-0044 §1). */
  readonly registryReadiness = this.protocol(RestEndpointProtocol).queryWith<RegistryReadiness, Org & { name: string }>(
    ({ org, name }) => orgScoped(entryPath(name, '/readiness'), org)
  );

  saveExcludedProjects(org: string | null) {
    return this.rest.mutation<{ project_ids: string[] }, { project_ids: string[] }>(
      'PUT',
      orgScoped(`${CATALOG}/registry/excluded-projects`, org)
    );
  }

  /** Move an entry through its lifecycle (ADR-0041 P2); an administrator's. */
  decide(org: string | null, name: string) {
    return this.rest.mutation<RegistryEntry, RegistryDecisionInput>('POST', orgScoped(entryPath(name, '/decisions'), org));
  }

  /** A model's description, category and capabilities, on the caller's own key. */
  suggest(org: string | null, name: string) {
    return this.rest.mutation<RegistrySuggestion, void>('POST', orgScoped(entryPath(name, '/suggest'), org));
  }

  /** Declare a candidate a gear (ADR-0041 P3): a pull request adding its manifest. */
  declare(org: string | null, name: string) {
    return this.rest.mutation<RegistryDeclareResult, RegistryDeclareInput>('POST', orgScoped(entryPath(name, '/declare'), org));
  }

  /** Read the projects (and, with a body, the named sources) now. */
  sync(org: string | null) {
    return this.rest.mutation<{ run_id: string; status: string }, SyncBody | undefined>('POST', orgScoped(`${CATALOG}/sync`, org));
  }

  /* ── the catalogue ── */

  /** The organization's catalogue sources kept on the server (ADR-0041). */
  readonly catalogSources = this.protocol(RestEndpointProtocol).queryWith<{ items: CatalogRepoSource[]; total: number }, Org>(
    ({ org }) => orgScoped(`${CATALOG}/sources`, org)
  );

  saveCatalogSources(org: string | null) {
    return this.rest.mutation<{ items: CatalogRepoSource[]; total: number }, { items: CatalogRepoSource[] }>(
      'PUT',
      orgScoped(`${CATALOG}/sources`, org)
    );
  }

  readonly fieldSchemas = this.protocol(RestEndpointProtocol).queryWith<{ schemas: FieldSchema[] }, Org>(({ org }) =>
    orgScoped(`${CATALOG}/field-schemas`, org)
  );

  readonly components = this.protocol(RestEndpointProtocol).queryWith<
    { nodes: CatalogNode[]; truncated?: boolean; shadowed?: string[] },
    Org
  >(({ org }) => orgScoped(`${CATALOG}/components`, org));

  readonly profiles = this.protocol(RestEndpointProtocol).queryWith<{ nodes: CatalogNode[] }, Org>(({ org }) =>
    orgScoped(`${CATALOG}/profiles`, org)
  );

  /** Each component's fields with its three sources reconciled. */
  readonly componentValues = this.protocol(RestEndpointProtocol).queryWith<
    { items: ComponentValues[]; total: number; truncated: boolean },
    Org
  >(({ org }) => orgScoped(`${CATALOG}/component-values`, org));

  /** Each component's earliest snapshot in the last `days` days. */
  readonly componentHistory = this.protocol(RestEndpointProtocol).queryWith<
    { items: ComponentSnapshot[]; total: number },
    Org & { days: number }
  >(({ org, days }) => orgScoped(`${CATALOG}/component-history?days=${days}`, org));

  /** One crate's versions, newest first. */
  readonly versions = this.protocol(RestEndpointProtocol).queryWith<{ nodes: CatalogNode[] }, Org & { crate: string }>(
    ({ org, crate }) => orgScoped(`${CATALOG}/versions?crate=${encodeURIComponent(crate)}`, org)
  );

  /** Replace the Studio-managed profile of one component. */
  saveProfile(org: string | null, name: string) {
    return this.rest.mutation<CatalogNode, { profile: Record<string, unknown> }>(
      'POST',
      orgScoped(`${CATALOG}/components/${encodeURIComponent(name)}/profile`, org)
    );
  }

  /* ── the platform (ADR-0042) ── */

  readonly platformSources = this.protocol(RestEndpointProtocol).queryWith<PlatformSources, Org>(({ org }) =>
    orgScoped(`${CATALOG}/platform/sources`, org)
  );

  savePlatformSources(org: string | null) {
    return this.rest.mutation<PlatformSources, { items: CatalogRepoSource[]; crates_io: string | null }>(
      'PUT',
      orgScoped(`${CATALOG}/platform/sources`, org)
    );
  }

  /** Queue a sync of the platform's catalogue from its stored sources; the
   *  run is queued in the caller's home tenant. */
  syncPlatform(org: string | null) {
    return this.rest.mutation<{ run_id: string; status: string }, void>('POST', orgScoped(`${CATALOG}/platform/sync`, org));
  }

  /** Every organization's requests to give a gear to the platform; a curator's. */
  readonly publicationRequests = this.protocol(RestEndpointProtocol).queryWith<{ items: PublicationRequest[] }, Org>(
    ({ org }) => orgScoped(`${CATALOG}/platform/publication-requests`, org)
  );

  /** A curator's answer to one request: `publish` (with `dry_run`, a preview) or `decline_publication`. */
  answerPublication(organizationId: string, name: string) {
    return this.rest.mutation<RegistryEntry, RegistryDecisionInput>(
      'POST',
      `${CATALOG}/platform/publication-requests/${encodeURIComponent(name)}/decisions?organization_id=${encodeURIComponent(organizationId)}`
    );
  }

  readonly curators = this.protocol(RestEndpointProtocol).queryWith<{ items: GearCurator[]; may_manage: boolean }, Org>(
    ({ org }) => orgScoped(`${CATALOG}/platform/curators`, org)
  );

  saveCurators(org: string | null) {
    return this.rest.mutation<{ items: GearCurator[]; may_manage: boolean }, { items: GearCurator[] }>(
      'PUT',
      orgScoped(`${CATALOG}/platform/curators`, org)
    );
  }

  /* ── borrowed ── */

  /** The tenant's connections (inherited ones included). */
  readonly connections = this.protocol(RestEndpointProtocol).queryWith<{ items: Connection[] }, { tenant: string }>(
    ({ tenant }) => `/studio-connector/v1/connections?tenant=${encodeURIComponent(tenant)}`
  );

  /** One run; `tenant` is where it was queued. */
  readonly taskRun = this.protocol(RestEndpointProtocol).queryWith<TaskRun, { runId: string; tenant: string | null }>(
    ({ runId, tenant }) => `/studio-tasks/v1/runs/${encodeURIComponent(runId)}${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`
  );

  readonly myProfile = this.protocol(RestEndpointProtocol).query<StudioProfile>('/studio-user/v1/me');

  private readonly kitsPage = this.protocol(RestEndpointProtocol).queryWith<Page<StudioKit>, { offset: number }>(
    ({ offset }) => `/studio-kits/v1/catalog?offset=${offset}&limit=${PAGE}`
  );

  private readonly colleaguesPage = this.protocol(RestEndpointProtocol).queryWith<Page<Colleague>, { offset: number }>(
    ({ offset }) => `/studio-user/v1/me/colleagues?offset=${offset}&limit=${PAGE}`
  );

  private readonly membersPage = this.protocol(RestEndpointProtocol).queryWith<Page<OrgMember>, { org: string; offset: number }>(
    ({ org, offset }) => `/studio-user/v1/organizations/${encodeURIComponent(org)}/members?offset=${offset}&limit=${PAGE}`
  );

  /** The kit registry's catalogue, every page. */
  kits(): Promise<StudioKit[]> {
    return allPages((offset) => this.kitsPage({ offset }).fetch({ staleTime: 0 }));
  }

  /** The caller's colleagues, every page. */
  colleagues(): Promise<Colleague[]> {
    return allPages((offset) => this.colleaguesPage({ offset }).fetch({ staleTime: 0 }));
  }

  /** The organization's members, every page. */
  members(org: string): Promise<OrgMember[]> {
    return allPages((offset) => this.membersPage({ org, offset }).fetch({ staleTime: 0 }));
  }
}

/** Every page of a list read by `offset`; an empty page also ends it, so a
 *  server that ignores the parameters does not spin forever. */
export async function allPages<T>(read: (offset: number) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await read(offset);
    const got = page.items ?? [];
    items.push(...got);
    const total = typeof page.total === 'number' ? page.total : items.length;
    if (got.length === 0 || items.length >= total) return items;
  }
}
