/**
 * What Project › Project domain model reads and writes, ported from the prototype's
 * client (src/api.ts at 00828880, ADR-0069 §5) — the calls its
 * `spec-model-tab.tsx` made. Each gear keeps its own path under the gateway
 * prefix:
 *
 * - `studio-documents` — the project domain model, its builds, reviews, requirements,
 *   traces, work links, related requirements, the glossary, check methods,
 *   the proposals it writes to the repository, a pasted material;
 * - `studio-spec-mapping` — the documents against the code, the plan (the
 *   project's own gears);
 * - `studio-product` — the engine's gear catalogue (who keeps an entity);
 * - `studio-kits` — the project's installed kits (their check methods).
 *
 * The spec-mapping and product routes name the organization on screen
 * (`organization_id`), as the prototype's `orgScoped` did.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { Doc, GlossaryDoc, GlossaryDocRow, GlossaryRenameProposal, KitCheckMethod, KitInstallation, PlanRow, ProfileAdvice, SpecModelEntityEdit, SpecModelSentence, SpecModelWrite } from './types';
import type { SpecModelBuildEstimate } from '../model/build-eta';
import type { SpecModelReview } from '../model/review-state';
import type {
  GlossaryEntry,
  ProductFinding,
  RelatedRequirements,
  RequirementTraces,
  SpecModel,
  SpecModelBuild,
  SpecModelUpload,
  SpecModelUploads,
  SpecRequirements,
  WorkLinks,
} from '../model/spec-model';
import type { GearCatalogue } from '../model/product-configurator';

/** The routes that name the organization on screen (the prototype's `ORG_SCOPED`). */
const ORG_SCOPED = ['/studio-spec-mapping/', '/studio-product/'];

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
const PROJECT_MODEL = '/studio-documents/v1/project-domain-model';

/** A fact review as it is written. */
export interface ReviewItem {
  fact_key: string;
  state: string;
  path: string;
  revision: string;
  note?: string | null;
  /** With `state: corrected`: the fact's value as it should read. */
  value?: string | null;
}

export class DomainModelApiService extends BaseApiService {
  constructor() {
    // A build estimate and a trace read every document and code file: allow it time.
    const restProtocol = new RestProtocol({ timeout: 120000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── the model and its builds ── */

  readonly specModel = this.protocol(RestEndpointProtocol).queryWith<SpecModel, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}?${project(projectId)}`
  );

  readonly buildEstimate = this.protocol(RestEndpointProtocol).queryWith<
    SpecModelBuildEstimate,
    { projectId: string; path?: string }
  >(({ projectId, path }) => `${PROJECT_MODEL}/build-estimate?${project(projectId)}${path ? `&path=${enc(path)}` : ''}`);

  startBuild() {
    return this.rest.mutation<SpecModelBuild, { project_id: string; path?: string }>('POST', `${PROJECT_MODEL}/builds`);
  }

  /* ── uploaded sources: CSV, JSON and plain text kept out of the repository ── */

  readonly uploads = this.protocol(RestEndpointProtocol).queryWith<SpecModelUploads, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}/uploads?${project(projectId)}`
  );

  upload() {
    return this.rest.mutation<SpecModelUpload, { project_id: string; name: string; content: string }>(
      'POST',
      `${PROJECT_MODEL}/uploads`
    );
  }

  removeUpload(projectId: string, uploadId: string) {
    return this.rest.mutation<void, void>('DELETE', `${PROJECT_MODEL}/uploads/${enc(uploadId)}?${project(projectId)}`);
  }

  /* ── reviews: accept, reject, evidence, decisions kept by key ── */

  readonly reviews = this.protocol(RestEndpointProtocol).queryWith<
    { items: SpecModelReview[]; total: number },
    { projectId: string }
  >(({ projectId }) => `${PROJECT_MODEL}/reviews?${project(projectId)}`);

  review() {
    return this.rest.mutation<{ items: SpecModelReview[]; total: number }, { project_id: string; items: ReviewItem[] }>(
      'POST',
      `${PROJECT_MODEL}/reviews`
    );
  }

  /* ── what the documents define ── */

  readonly requirements = this.protocol(RestEndpointProtocol).queryWith<SpecRequirements, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}/requirements?${project(projectId)}`
  );

  readonly trace = this.protocol(RestEndpointProtocol).queryWith<RequirementTraces, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}/trace?${project(projectId)}`
  );

  readonly related = this.protocol(RestEndpointProtocol).queryWith<RelatedRequirements, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}/related?${project(projectId)}`
  );

  readonly work = this.protocol(RestEndpointProtocol).queryWith<WorkLinks, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}/work?${project(projectId)}`
  );

  readonly checkMethods = this.protocol(RestEndpointProtocol).queryWith<
    { items: KitCheckMethod[]; total: number; unread: Record<string, string> },
    { projectId: string; kits: string[] }
  >(({ projectId, kits }) => `${PROJECT_MODEL}/check-methods?${project(projectId)}&kits=${enc(kits.join(','))}`);

  /* ── the entities as a person edits them ── */

  saveEntity(projectId: string) {
    return this.rest.mutation<SpecModelWrite, SpecModelEntityEdit>('POST', `${PROJECT_MODEL}/entities?${project(projectId)}`);
  }

  /* ── the glossary ── */

  readonly glossary = this.protocol(RestEndpointProtocol).queryWith<
    { items: GlossaryEntry[]; total: number },
    { projectId: string }
  >(({ projectId }) => `${PROJECT_MODEL}/glossary?${project(projectId)}`);

  readonly glossaryDocument = this.protocol(RestEndpointProtocol).queryWith<GlossaryDoc, { projectId: string }>(
    ({ projectId }) => `${PROJECT_MODEL}/glossary/document?${project(projectId)}`
  );

  decideGlossaryEntry() {
    return this.rest.mutation<
      { key: string; name: string | null; alias_of: string | null },
      { project_id: string; key: string; name: string | null; alias_of: string | null }
    >('POST', `${PROJECT_MODEL}/glossary/decisions`);
  }

  decideGlossaryDistinct() {
    return this.rest.mutation<void, { project_id: string; a: string; b: string }>('POST', `${PROJECT_MODEL}/glossary/distinct`);
  }

  proposeGlossaryRename(projectId: string) {
    return this.rest.mutation<GlossaryRenameProposal, { from: string; to: string }>(
      'POST',
      `${PROJECT_MODEL}/glossary/proposals?${project(projectId)}`
    );
  }

  proposeGlossaryDocument() {
    return this.rest.mutation<SpecModelWrite, { project_id: string; rows: GlossaryDocRow[] }>(
      'POST',
      `${PROJECT_MODEL}/glossary/document/proposals`
    );
  }

  /* ── proposals to the repository ── */

  proposeSentence(projectId: string) {
    return this.rest.mutation<SpecModelWrite, SpecModelSentence>('POST', `${PROJECT_MODEL}/sentences/proposals?${project(projectId)}`);
  }

  proposeFile() {
    return this.rest.mutation<SpecModelWrite, { project_id: string; path: string; content: string; title: string }>(
      'POST',
      `${PROJECT_MODEL}/files/proposals`
    );
  }

  /** A pasted material, kept as a project document (`type_key: material`). */
  createProjectDocument(workspaceId: string, projectId: string) {
    return this.rest.mutation<Doc, { type_key: string; title: string; content?: string }>(
      'POST',
      `/studio-documents/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/documents`
    );
  }

  /* ── the documents against the code; the project's own gears ── */

  readonly productFindings = this.protocol(RestEndpointProtocol).queryWith<
    { repo: string | null; items: ProductFinding[]; total: number },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-spec-mapping/v1/findings?${project(projectId)}`));

  readonly projectPlan = this.protocol(RestEndpointProtocol).queryWith<
    { items: PlanRow[]; total: number; profile?: ProfileAdvice | null },
    { projectId: string }
  >(({ projectId }) => orgScoped(`/studio-spec-mapping/v1/plan?${project(projectId)}`));

  /** The engine's catalogue: every gear its roots hold, and whose roots they are. */
  readonly gearboxCatalogue = this.protocol(RestEndpointProtocol).queryWith<
    {
      catalogue: GearCatalogue;
      corpus_ref: string;
      corpus_commit?: string | null;
      roots?: { source_id: string; tier?: string | null }[];
      project_sources?: string[];
      project_source_owners?: Record<string, string[]>;
    },
    Record<string, never>
  >(() => orgScoped('/studio-product/v1/gearbox/catalogue'));

  /* ── the project's kits ── */

  readonly kitInstallations = this.protocol(RestEndpointProtocol).queryWith<
    { items: KitInstallation[]; total?: number },
    { projectId: string; offset: number }
  >(({ projectId, offset }) => `/studio-kits/v1/projects/${enc(projectId)}/installations?offset=${offset}&limit=100`);
}
