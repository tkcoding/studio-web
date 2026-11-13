// The prototype's src/infra-store.ts at 00828880, over the server's route.
/* Where a product's infra services are kept, behind one small interface so
 * the views do not know.
 *
 * ADR-0065: what the product runs -- the service, its image, its settings --
 * is in the product description (`infra = [use_service(…)]` in product.gdl),
 * so a save is a new revision. What each environment does with it -- its
 * copy of the image, a ready chart's values, its public address -- stays in
 * the project's list. The prototype read and wrote product.gdl's text here
 * (infra-gdl.ts); the server does both now (`GET`/`PUT
 * /studio-product/v1/product-infra`): it merges the catalogue's passports
 * with the description's choice and the project's records, writes only what
 * differs from the catalogue into the description, and the whole list into
 * the project's records. */

import { api, type InfraService } from "../api/client";

/** Where the list was read from: said on screen, so a member knows what a
 *  save writes. */
export type InfraSource = "project-list" | "product-description";

export interface InfraLoaded {
  items: InfraService[];
  source: InfraSource;
  /** The description revision the list was read from; null for a store
   *  without revisions. A save is made against it. */
  revision: number | null;
}

export interface InfraStore {
  source: InfraSource;
  load(): Promise<InfraLoaded>;
  /** Write the whole list; what comes back is what was kept. `base` is the
   *  revision it was read at: the server refuses an older one (409). */
  save(items: InfraService[], base: number | null): Promise<InfraLoaded>;
}

const loaded = (r: { items: InfraService[]; source: InfraSource; revision: number | null }): InfraLoaded => ({
  items: r.items,
  source: r.source,
  revision: r.revision ?? null,
});

/** The store the product's views use: the server's. */
export function infraStore(token: string, projectId: string): InfraStore {
  return {
    source: "product-description",
    // Async, so a client that cannot be reached is a rejection, not a throw.
    load: async () => loaded(await api.productInfra(token, projectId)),
    save: async (items, base) => loaded(await api.putProductInfra(token, projectId, { base_revision: base, items })),
  };
}

/** The source in words, for the editor's footer. */
export const INFRA_SOURCE_TEXT: Record<InfraSource, string> = {
  "project-list": "Kept in the project's infra-services list; a save replaces it whole.",
  "product-description":
    "Kept in product.gdl: a save makes a new description revision. Each environment's copy of the image and public address stay with the project.",
};
