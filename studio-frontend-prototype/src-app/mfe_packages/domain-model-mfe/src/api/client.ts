/**
 * The prototype's client calls the Project domain model tab made (src/api.ts at
 * 00828880), with its names and arguments minus the bearer (it travels with
 * `authShared()`), over `DomainModelApiService`. Every read asks the server
 * again: the tab reads after each write, as the prototype's did.
 */

import { apiRegistry } from '@gears-frontx/react';
import { DomainModelApiService, type ReviewItem } from './DomainModelApiService';
import type { GlossaryDocRow, KitInstallation, SpecModelEntityEdit, SpecModelSentence } from './types';

export * from './types';
export type { ReviewItem } from './DomainModelApiService';

const svc = (): DomainModelApiService => apiRegistry.getService(DomainModelApiService);

const FRESH = { staleTime: 0 };

/** A page of kit installations at most; the prototype walked every page. */
const KIT_PAGE = 100;

export const dmApi = {
  specModel: (projectId: string) => svc().specModel({ projectId }).fetch(FRESH),
  startSpecModelBuild: (projectId: string, path?: string) =>
    svc()
      .startBuild()
      .fetch(path ? { project_id: projectId, path } : { project_id: projectId }),
  specModelBuildEstimate: (projectId: string, path?: string) => svc().buildEstimate({ projectId, path }).fetch(FRESH),

  specModelUploads: (projectId: string) => svc().uploads({ projectId }).fetch(FRESH),
  uploadSpecModelSource: (projectId: string, name: string, content: string) =>
    svc().upload().fetch({ project_id: projectId, name, content }),
  removeSpecModelUpload: (projectId: string, uploadId: string) => svc().removeUpload(projectId, uploadId).fetch(undefined),

  specModelReviews: (projectId: string) => svc().reviews({ projectId }).fetch(FRESH),
  reviewSpecModelFacts: (projectId: string, items: ReviewItem[]) =>
    svc().review().fetch({ project_id: projectId, items }),

  specRequirements: (projectId: string) => svc().requirements({ projectId }).fetch(FRESH),
  requirementTrace: (projectId: string) => svc().trace({ projectId }).fetch(FRESH),
  relatedRequirements: (projectId: string) => svc().related({ projectId }).fetch(FRESH),
  workLinks: (projectId: string) => svc().work({ projectId }).fetch(FRESH),
  specModelCheckMethods: (projectId: string, kits: string[]) => svc().checkMethods({ projectId, kits }).fetch(FRESH),

  saveSpecModelEntity: (projectId: string, entity: SpecModelEntityEdit) => svc().saveEntity(projectId).fetch(entity),

  glossary: (projectId: string) => svc().glossary({ projectId }).fetch(FRESH),
  glossaryDocument: (projectId: string) => svc().glossaryDocument({ projectId }).fetch(FRESH),
  decideGlossaryEntry: (projectId: string, key: string, decision: { name: string | null; alias_of: string | null }) =>
    svc()
      .decideGlossaryEntry()
      .fetch({ project_id: projectId, key, ...decision }),
  decideGlossaryDistinct: (projectId: string, a: string, b: string) =>
    svc().decideGlossaryDistinct().fetch({ project_id: projectId, a, b }),
  proposeGlossaryRename: (projectId: string, from: string, to: string) =>
    svc().proposeGlossaryRename(projectId).fetch({ from, to }),
  proposeGlossaryDocument: (projectId: string, rows: GlossaryDocRow[]) =>
    svc().proposeGlossaryDocument().fetch({ project_id: projectId, rows }),

  proposeSpecModelSentence: (projectId: string, proposal: SpecModelSentence) =>
    svc().proposeSentence(projectId).fetch(proposal),
  proposeSpecModelFile: (projectId: string, path: string, content: string, title: string) =>
    svc().proposeFile().fetch({ project_id: projectId, path, content, title }),
  createProjectDocument: (
    workspaceId: string,
    projectId: string,
    body: { type_key: string; title: string; content?: string }
  ) => svc().createProjectDocument(workspaceId, projectId).fetch(body),

  productFindings: (projectId: string) => svc().productFindings({ projectId }).fetch(FRESH),
  projectPlan: (projectId: string) => svc().projectPlan({ projectId }).fetch(FRESH),
  gearboxCatalogue: () => svc().gearboxCatalogue({}).fetch(FRESH),

  /** Every installation of the project, page by page, as the prototype's `requestAllPages` read them. */
  kitInstallations: async (projectId: string): Promise<{ items: KitInstallation[] }> => {
    const items: KitInstallation[] = [];
    for (let offset = 0; ; offset += KIT_PAGE) {
      const page = await svc().kitInstallations({ projectId, offset }).fetch(FRESH);
      const got = page.items ?? [];
      items.push(...got);
      const total = typeof page.total === 'number' ? page.total : items.length;
      if (got.length === 0 || items.length >= total) return { items };
    }
  },
};

export type DomainModelApi = typeof dmApi;
