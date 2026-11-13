/* What the product is (the prototype's src/product-kind.ts at 00828880).
 *
 * The proposal -- the kind the specs point to, with its reasons -- and the
 * kept choice are the server's now (`GET`/`PUT /studio-product/v1/product-kind`,
 * studio-product's `kind.rs`, which carries the prototype's rules and tests).
 * What is left here is what the step draws with: the kinds' names, and the
 * stored choice's shape. */

export type ProductKind = 'gear_product' | 'gear_service' | 'frontx_app' | 'source_built';

/** The confirmed kind, as the project's configuration keeps it. */
export interface ProductKindChoice {
  kind: ProductKind;
  /** What Studio proposed when it was confirmed. */
  proposed?: ProductKind | null;
  confirmed_by?: string | null;
  /** RFC 3339. */
  confirmed_at: string;
}

/** One kind as the server describes it. */
export interface ProductKindInfo {
  id: ProductKind;
  title: string;
  what: string;
  builds: string;
}

/** A kind's title from the server's list, else its id. */
export function kindTitle(kinds: readonly ProductKindInfo[], id: ProductKind): string {
  return kinds.find((k) => k.id === id)?.title ?? id;
}
