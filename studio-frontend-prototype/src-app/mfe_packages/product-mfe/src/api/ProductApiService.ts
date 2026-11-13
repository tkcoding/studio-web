/**
 * What Project › Product and Project › Components read and write, ported from
 * the prototype's client (src/api.ts at 00828880, ADR-0069 §5). Each gear keeps
 * its own path under the gateway prefix:
 *
 * - `studio-product` — the product record, product.gdl's revisions, Gearbox
 *   (status, config schemas, complete), gear explanations, the gear repository;
 * - `studio-environments` — targets, infra services and plans, deployments, images;
 * - `studio-components-catalog` — the catalogue, its profiles and sources, a
 *   project's components, the registry, screen previews;
 * - `studio-spec-mapping`, `studio-documents` — what the specs say;
 * - `studio-artifact-ingest` — the graph's nodes (builds);
 * - `account-management` — the project's configuration (tenant metadata).
 *
 * The catalogue, product, spec-mapping and reports routes name the
 * organization on screen (`organization_id`), as the prototype's `orgScoped`
 * did: a caller's home tenant need not be it.
 */

import { BaseApiService, RestEndpointProtocol, RestPlugin, RestProtocol, type RestRequestContext } from '@gears-frontx/react';
import type {
  ArtifactNodePage,
  Capability,
  CatalogNode,
  CatalogRepoSource,
  Conformance,
  Connection,
  DeclaredCapability,
  DeclaredRequirement,
  Deployment,
  DescriptionOutline,
  GearboxStatus,
  GearConfig,
  GearConfigSchema,
  GearExplanation,
  InfraPlan,
  InfraService,
  PlanRow,
  ProductChange,
  ProductDescription,
  ProductDescriptionRevision,
  ProductInfra,
  ProductKindAnswer,
  ProductPreview,
  ProfileAdvice,
  ProjectConfig,
  ProjectGearRepo,
  ProjectImage,
  ProjectProduct,
  ProjectTargets,
  RegistryEntry,
  ScreenPreview,
  TaskRun,
  UnreadableSource,
} from './types';
import type { ProjectComponent } from '../model/project-checks';
import type { GlossaryEntry, SpecModel } from '../model/spec-model';
import type { GearCatalogue } from '../model/product-configurator';
import type { GearBrings } from '../model/gear-brings';

/** The tenant-metadata type a project's configuration is kept under. */
export const PROJECT_CONFIG_TYPE = 'gts.cf.core.am.tenant_metadata.v1~cf.studio.project.config.v1~';

/** The routes that name the organization on screen (the prototype's `ORG_SCOPED`). */
const ORG_SCOPED = [
  '/studio-components-catalog/',
  '/studio-reports/',
  '/studio-spec-mapping/',
  '/studio-product/',
  '/studio-domain-model/',
];

let organization: string | null = null;

/** The organization on screen: the root sets it from the shell's context. */
export function setOrganization(id: string | null): void {
  organization = id;
}

/** `path` naming the organization on screen, when it is one of `ORG_SCOPED` and there is one. */
export function orgScoped(path: string, org: string | null = organization): string {
  if (!org || !ORG_SCOPED.some((p) => path.startsWith(p)) || /[?&]organization_id=/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(org)}`;
}

const enc = encodeURIComponent;
const project = (id: string) => `project_id=${enc(id)}`;

/** The POSTs that start background work: a lost answer retried answers the
 *  run the first one started instead of a second. */
const idempotentPost = (url: string) =>
  /\/studio-components-catalog\/v1\/sync(\?|$)|\/studio-environments\/v1\/images\/imports(\?|$)/.test(url);

class IdempotencyPlugin extends RestPlugin {
  onRequest(context: RestRequestContext): RestRequestContext {
    if (context.method !== 'POST' || !idempotentPost(context.url) || context.headers['Idempotency-Key'] !== undefined) {
      return context;
    }
    return { ...context, headers: { ...context.headers, 'Idempotency-Key': crypto.randomUUID() } };
  }
}

export interface SaveProductBody {
  product_id?: string;
  name?: string;
  gears?: string[];
  profile?: string;
  config?: GearConfig;
  frontend?: ProjectProduct['frontend'];
}

export interface PreviewProductBody {
  product_id: string;
  name?: string;
  gears: string[];
  profile?: string;
  write?: boolean;
  base_revision?: number;
  publish?: boolean;
  open_pr?: boolean;
  config?: GearConfig;
  onto_base?: boolean;
  strictness?: 'dev' | 'prod';
}

export interface SyncComponentsBody {
  crates_io: string | null;
  repositories: { tenant: string; connection_id: string | null; repo: string; git_ref: string | null; mode: string }[];
}

export class ProductApiService extends BaseApiService {
  constructor() {
    // A Gearbox preview resolves the whole product: minutes, not seconds.
    const restProtocol = new RestProtocol({ timeout: 300000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
    restProtocol.plugins.add(new IdempotencyPlugin());
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── the project's configuration (account-management) ── */

  readonly projectConfig = this.protocol(RestEndpointProtocol).queryWith<{ value: ProjectConfig }, { projectId: string }>(
    ({ projectId }) => `/account-management/v1/tenants/${projectId}/metadata/${PROJECT_CONFIG_TYPE}`
  );

  putProjectConfig(projectId: string) {
    return this.rest.mutation<unknown, ProjectConfig>(
      'PUT',
      `/account-management/v1/tenants/${projectId}/metadata/${PROJECT_CONFIG_TYPE}`
    );
  }

  /* ── the product (studio-product) ── */

  readonly projectProduct = this.protocol(RestEndpointProtocol).queryWith<
    { nodes: { value: ProjectProduct }[] },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-product/v1/projects/${enc(projectId)}/product`));

  saveProjectProduct(projectId: string) {
    return this.rest.mutation<{ value: ProjectProduct }, SaveProductBody>(
      'PUT',
      orgScoped(`/studio-product/v1/projects/${enc(projectId)}/product`)
    );
  }

  previewProduct(projectId: string) {
    return this.rest.mutation<ProductPreview, PreviewProductBody>(
      'POST',
      orgScoped(`/studio-product/v1/projects/${enc(projectId)}/product/preview`)
    );
  }

  readonly productDescription = this.protocol(RestEndpointProtocol).queryWith<ProductDescription, { projectId: string }>(
    ({ projectId }) => orgScoped(`/studio-product/v1/product-description?${project(projectId)}`)
  );

  /** The description's history (ADR-0053), newest first, without the texts. */
  readonly productDescriptionRevisions = this.protocol(RestEndpointProtocol).queryWith<
    { items: Omit<ProductDescriptionRevision, 'text'>[]; total: number },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-product/v1/product-description-revisions?${project(projectId)}`));

  readonly productDescriptionRevision = this.protocol(RestEndpointProtocol).queryWith<
    ProductDescriptionRevision,
    { projectId: string; revision: number }
  >(({ projectId, revision }) =>
    orgScoped(`/studio-product/v1/product-description-revisions/${revision}?${project(projectId)}`)
  );

  /** The infra services as the description says them, merged with the catalogue's passports and the project's records. */
  readonly productInfra = this.protocol(RestEndpointProtocol).queryWith<ProductInfra, { projectId: string }>(
    ({ projectId }) => orgScoped(`/studio-product/v1/product-infra?${project(projectId)}`)
  );

  /** Save the whole list: the description's `infra` (a new revision when it changes) and the project's records. */
  putProductInfra(projectId: string) {
    return this.rest.mutation<ProductInfra, { base_revision?: number | null; items: InfraService[] }>(
      'PUT',
      orgScoped(`/studio-product/v1/product-infra?${project(projectId)}`)
    );
  }

  /** What a product.gdl says (a text, a revision, or the latest): infra, profiles, which lines say which part. */
  outlineProductDescription(projectId: string) {
    return this.rest.mutation<DescriptionOutline, { text?: string; revision?: number }>(
      'POST',
      orgScoped(`/studio-product/v1/product-description-outlines?${project(projectId)}`)
    );
  }

  /** What the product is: Studio's proposal from the specs, and the member's choice. */
  readonly productKind = this.protocol(RestEndpointProtocol).queryWith<ProductKindAnswer, { projectId: string }>(
    ({ projectId }) => orgScoped(`/studio-product/v1/product-kind?${project(projectId)}`)
  );

  confirmProductKind(projectId: string) {
    return this.rest.mutation<ProductKindAnswer, { kind: string }>(
      'PUT',
      orgScoped(`/studio-product/v1/product-kind?${project(projectId)}`)
    );
  }

  saveProductDescription(projectId: string) {
    return this.rest.mutation<
      { revision: ProductDescriptionRevision; created: boolean },
      { base_revision?: number | null; text: string; from_repository?: boolean }
    >('POST', orgScoped(`/studio-product/v1/product-description-revisions?${project(projectId)}`));
  }

  readonly gdlFile = this.protocol(RestEndpointProtocol).queryWith<
    { source: string; path: string; text: string },
    { projectId: string; what: { gear: string } | { path: string } }
  >(({ projectId, what }) =>
    orgScoped(
      `/studio-product/v1/gdl-file?${project(projectId)}&${'gear' in what ? `gear=${enc(what.gear)}` : `path=${enc(what.path)}`}`
    )
  );

  gearConfigSchemas() {
    return this.rest.mutation<{ items: GearConfigSchema[]; total: number }, { gears: string[] }>(
      'POST',
      orgScoped('/studio-product/v1/gearbox/config-schema')
    );
  }

  completeProduct() {
    return this.rest.mutation<
      { gears: string[]; changes: ProductChange[]; config: GearConfig },
      { gears: string[]; config: GearConfig }
    >('POST', orgScoped('/studio-product/v1/gearbox/complete'));
  }

  readonly gearboxStatus = this.protocol(RestEndpointProtocol).queryWith<
    GearboxStatus,
    { refresh?: boolean; organizationId?: string }
  >(({ refresh, organizationId }) => {
    const q = [refresh ? 'refresh=true' : '', organizationId ? `organization_id=${enc(organizationId)}` : ''].filter(Boolean);
    return orgScoped(`/studio-product/v1/gearbox${q.length ? `?${q.join('&')}` : ''}`);
  });

  /** The engine's catalogue: every gear its roots hold, and whose roots they are. */
  readonly gearboxCatalogue = this.protocol(RestEndpointProtocol).queryWith<
    {
      catalogue: GearCatalogue;
      corpus_ref: string;
      corpus_commit?: string | null;
      roots?: { source_id: string; tier?: string | null }[];
      /** The roots read out of the organization's projects' own repositories. */
      project_sources?: string[];
      /** Whose each of those roots is: project ids by source id. */
      project_source_owners?: Record<string, string[]>;
    },
    Record<string, never>
  >(() => orgScoped('/studio-product/v1/gearbox/catalogue'));

  /** The organization's explanations of gears, and whether the caller may change them. */
  readonly gearExplanations = this.protocol(RestEndpointProtocol).queryWith<
    { items: GearExplanation[]; total: number; may_manage?: boolean },
    Record<string, never>
  >(() => orgScoped('/studio-product/v1/gear-explanations'));

  /** What a candidate gear would bring into the product with it. */
  gearBrings() {
    return this.rest.mutation<GearBrings, { gears: string[]; candidate: string; config: GearConfig }>(
      'POST',
      orgScoped('/studio-product/v1/gearbox/brings')
    );
  }

  /** The project's tenant: its name names a product that has none yet. */
  readonly tenant = this.protocol(RestEndpointProtocol).queryWith<{ id: string; name: string }, { tenantId: string }>(
    ({ tenantId }) => `/account-management/v1/tenants/${enc(tenantId)}`
  );

  generateGearExplanation(gearId: string) {
    return this.rest.mutation<GearExplanation, { force: boolean }>(
      'POST',
      orgScoped(`/studio-product/v1/gear-explanations/${enc(gearId)}/generations`)
    );
  }

  updateGearExplanation(gearId: string) {
    return this.rest.mutation<GearExplanation, { text: string }>(
      'PUT',
      orgScoped(`/studio-product/v1/gear-explanations/${enc(gearId)}`)
    );
  }

  readonly projectGearRepo = this.protocol(RestEndpointProtocol).queryWith<
    { nodes: { value: ProjectGearRepo }[] },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-product/v1/projects/${enc(projectId)}/gear-repo`));

  /* ── environments (studio-environments) ── */

  readonly projectTargets = this.protocol(RestEndpointProtocol).queryWith<ProjectTargets, { projectId: string }>(
    ({ projectId }) => `/studio-environments/v1/targets?${project(projectId)}`
  );

  readonly infraPlan = this.protocol(RestEndpointProtocol).queryWith<
    InfraPlan,
    { projectId: string; environmentId: string }
  >(
    ({ projectId, environmentId }) =>
      `/studio-environments/v1/environments/${enc(environmentId)}/infra-plan?${project(projectId)}`
  );

  readonly infraServices = this.protocol(RestEndpointProtocol).queryWith<
    { items: InfraService[]; total: number },
    { projectId: string }
  >(({ projectId }) => `/studio-environments/v1/infra-services?${project(projectId)}`);

  putInfraServices(projectId: string) {
    return this.rest.mutation<{ items: InfraService[]; total: number }, { items: InfraService[] }>(
      'PUT',
      `/studio-environments/v1/infra-services?${project(projectId)}`
    );
  }

  readonly deployments = this.protocol(RestEndpointProtocol).queryWith<
    { items: Deployment[]; total: number },
    { org?: string; project?: string; environment?: string }
  >((params) => {
    const qs = new URLSearchParams();
    if (params.org) qs.set('organization_id', params.org);
    if (params.project) qs.set('project_id', params.project);
    if (params.environment) qs.set('environment_id', params.environment);
    return `/studio-environments/v1/deployments?${qs}`;
  });

  readonly projectImages = this.protocol(RestEndpointProtocol).queryWith<
    { items: ProjectImage[]; total: number },
    { projectId: string; filter: Record<string, string | number | undefined> }
  >(({ projectId, filter }) => {
    const qs = new URLSearchParams({ project_id: projectId });
    for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return `/studio-environments/v1/images?${qs}`;
  });

  importImage(projectId: string) {
    return this.rest.mutation<
      { run_id: string; image_id: string },
      { environment_id: string; source: string; name?: string; kind?: 'image' | 'chart' }
    >('POST', `/studio-environments/v1/images/imports?${project(projectId)}`);
  }

  /* ── the catalogue (studio-components-catalog) ── */

  readonly listComponents = this.protocol(RestEndpointProtocol).queryWith<
    { nodes: CatalogNode[]; truncated?: boolean; shadowed?: string[] },
    { projectId?: string }
  >(({ projectId }) =>
    orgScoped(`/studio-components-catalog/v1/components${projectId ? `?${project(projectId)}` : ''}`)
  );

  readonly listComponentProfiles = this.protocol(RestEndpointProtocol).queryWith<
    { nodes: CatalogNode[] },
    { projectId?: string }
  >(({ projectId }) =>
    orgScoped(`/studio-components-catalog/v1/profiles${projectId ? `?${project(projectId)}` : ''}`)
  );

  readonly screenPreviews = this.protocol(RestEndpointProtocol).queryWith<
    { items: ScreenPreview[]; total: number },
    { component: string }
  >(({ component }) => orgScoped(`/studio-components-catalog/v1/screen-previews?component=${enc(component)}`));

  /** Parameterized by nothing but the organization on screen, which the path names. */
  readonly catalogSources = this.protocol(RestEndpointProtocol).queryWith<
    { items: CatalogRepoSource[]; total: number },
    Record<string, never>
  >(() => orgScoped('/studio-components-catalog/v1/sources'));

  /** One registry entry with its evidence (Project › Components' "could be a gear"). */
  readonly registryEntry = this.protocol(RestEndpointProtocol).queryWith<
    import('./types').RegistryEntry,
    { name: string }
  >(({ name }) => orgScoped(`/studio-components-catalog/v1/registry/${enc(name)}`));

  /** Declare a candidate a gear (ADR-0041 P3): a pull request adding its manifest. */
  declareRegistry(name: string) {
    return this.rest.mutation<import('./types').RegistryDeclareResult, import('./types').RegistryDeclareInput>(
      'POST',
      orgScoped(`/studio-components-catalog/v1/registry/${enc(name)}/declare`)
    );
  }

  /** A starter gear for a capability nobody has built, on the project's route. */
  scaffoldGear(projectId: string) {
    return this.rest.mutation<import('./types').ScaffoldResult, import('./types').ScaffoldBody>(
      'POST',
      orgScoped(`/studio-product/v1/projects/${enc(projectId)}/scaffold`)
    );
  }

  saveCatalogSources() {
    return this.rest.mutation<{ items: CatalogRepoSource[]; total: number }, { items: CatalogRepoSource[] }>(
      'PUT',
      orgScoped('/studio-components-catalog/v1/sources')
    );
  }

  syncComponents() {
    return this.rest.mutation<{ run_id: string; status: string }, SyncComponentsBody | undefined>(
      'POST',
      orgScoped('/studio-components-catalog/v1/sync')
    );
  }

  readonly projectComponents = this.protocol(RestEndpointProtocol).queryWith<
    { items: ProjectComponent[]; total: number; repos: number; unreadable?: { sources: UnreadableSource[] } },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-components-catalog/v1/project-components?${project(projectId)}`));

  readonly componentRegistry = this.protocol(RestEndpointProtocol).queryWith<
    { items: RegistryEntry[]; total: number },
    { state?: string; project_id?: string; q?: string }
  >((params) => {
    const qs = new URLSearchParams({ limit: '500' });
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return orgScoped(`/studio-components-catalog/v1/registry?${qs}`);
  });

  /* ── the specs (studio-spec-mapping, studio-documents) ── */

  readonly declaredCapabilities = this.protocol(RestEndpointProtocol).queryWith<
    { items: DeclaredCapability[]; total: number },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-spec-mapping/v1/capabilities?${project(projectId)}`));

  readonly declaredRequirements = this.protocol(RestEndpointProtocol).queryWith<
    { items: DeclaredRequirement[]; total: number },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-spec-mapping/v1/requirements?${project(projectId)}`));

  readonly projectPlan = this.protocol(RestEndpointProtocol).queryWith<
    { items: PlanRow[]; total: number; profile?: ProfileAdvice | null },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-spec-mapping/v1/plan?${project(projectId)}`));

  conformance() {
    return this.rest.mutation<
      Conformance,
      { project_id: string; capabilities: string[]; terms: Record<string, string[]>; contracts: Record<string, string[]> }
    >('POST', orgScoped('/studio-spec-mapping/v1/conformance'));
  }

  readonly capabilities = this.protocol(RestEndpointProtocol).queryWith<{ items: Capability[] }, { workspaceId: string }>(
    ({ workspaceId }) => `/studio-documents/v1/workspaces/${workspaceId}/capabilities`
  );

  readonly glossary = this.protocol(RestEndpointProtocol).queryWith<
    { items: GlossaryEntry[]; total: number },
    { projectId: string }
  >(({ projectId }) => `/studio-documents/v1/project-domain-model/glossary?${project(projectId)}`);

  readonly specModel = this.protocol(RestEndpointProtocol).queryWith<SpecModel, { projectId: string }>(
    ({ projectId }) => `/studio-documents/v1/project-domain-model?${project(projectId)}`
  );

  /** One `studio-tasks` run, read in the tenant it was queued in. */
  readonly taskRun = this.protocol(RestEndpointProtocol).queryWith<TaskRun, { runId: string; tenant: string | null }>(
    ({ runId, tenant }) => `/studio-tasks/v1/runs/${enc(runId)}${tenant ? `?tenant=${enc(tenant)}` : ''}`
  );

  /** The connections visible from a tenant (`studio-connector`): what a repository's token is. */
  readonly connections = this.protocol(RestEndpointProtocol).queryWith<{ items: Connection[] }, { tenant: string }>(
    ({ tenant }) => `/studio-connector/v1/connections?tenant=${enc(tenant)}`
  );

  /* ── the graph (studio-artifact-ingest) ── */

  readonly artifactNodes = this.protocol(RestEndpointProtocol).queryWith<ArtifactNodePage, { query: string }>(
    ({ query }) => `/studio-artifact-ingest/v1/nodes${query ? `?${query}` : ''}`
  );
}
