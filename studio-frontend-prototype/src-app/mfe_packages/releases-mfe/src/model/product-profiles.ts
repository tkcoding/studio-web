// The profile part of the prototype's src/product.ts (at 00828880), copied unchanged: the rest of that module
// composes the product, which is not this kit's.
/* The deployment profiles a product's description declares, and which of
 * them an environment can run (ADR-0057). */

import { readProfiles } from "./infra-gdl";

/** The shape a profile deploys the product in, as `product.gdl` spells its
 *  constructor. */
export type ProfileKind = "embedded" | "self_hosted" | "kubernetes";

/** The deployment profiles a generated product.gdl declares, in the order they
 *  are shown: the shape first, which is what somebody reading cares about,
 *  then the id the description and the bindings use. */
export const PRODUCT_PROFILES: readonly { id: string; kind: ProfileKind; label: string }[] = [
  { id: "prod", kind: "kubernetes", label: "Kubernetes · prod" },
  { id: "local", kind: "self_hosted", label: "One host · local" },
  { id: "dev", kind: "embedded", label: "One process · dev" },
];

/** The profiles an environment can run (ADR-0057: only kubernetes ones bind,
 *  for now): the ones whose shape is a cluster. */
export const KUBERNETES_PROFILES: readonly string[] = PRODUCT_PROFILES.filter((p) => p.kind === "kubernetes").map((p) => p.id);

/** How a profile's kind reads: the shape it deploys in. */
const KIND_LABEL: Record<string, string> = {
  kubernetes: "Kubernetes",
  self_hosted: "One host",
  embedded: "One process",
};

/** A profile a product's description declares, as it is shown. */
export interface DeclaredProfile {
  id: string;
  /** The constructor that makes it: `kubernetes`, `self_hosted`,
   *  `embedded`, or another the engine knows. */
  kind: string;
  label: string;
}

/** The profiles the saved description declares (its latest revision's
 *  text), each with its kind; the three a new description starts with when
 *  there is no text or it declares none Studio can read. */
export function declaredProfiles(text: string | null | undefined): DeclaredProfile[] {
  const read = text ? readProfiles(text) : null;
  if (!read || read.length === 0) return PRODUCT_PROFILES.map((p) => ({ ...p }));
  return read.map((p) => ({ id: p.id, kind: p.kind, label: `${KIND_LABEL[p.kind] ?? p.kind} · ${p.id}` }));
}

/** The profiles an environment can run: a cluster runs the `kubernetes`
 *  ones (ADR-0057), and so does Research, which deploys onto one. */
export function deployableProfiles(profiles: readonly DeclaredProfile[]): DeclaredProfile[] {
  return profiles.filter((p) => p.kind === "kubernetes");
}

/** A profile as a person reads it: "Kubernetes · prod"; an id the product
 *  does not declare, as it is. `declared` (the description's) first, then
 *  the profiles a new description starts with. */
export function profileLabel(id: string, declared: readonly DeclaredProfile[] = []): string {
  return declared.find((p) => p.id === id)?.label ?? PRODUCT_PROFILES.find((p) => p.id === id)?.label ?? id;
}
