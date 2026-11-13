// The one function of the prototype's src/frontend-constructor.ts (at 00828880) that infra-services.test.ts needs,
// copied unchanged: the rest of that module is the product's frontend constructor, not this kit's.

/** A gear's key as a route names it: `cf-gears-account-management` and
 *  `account-management` are the same gear; so are `studio-documents` and
 *  `cf-studio-documents`. */
export function gearKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^cf-gears-/, "")
    .replace(/^cf-/, "");
}
