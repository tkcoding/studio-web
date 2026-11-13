// The Studio domain model at run time now lives in mfe-shared (`domain/runtime.ts`): the shell draws a level's tabs
// from it too. Re-exported here so Admin's own modules keep their imports.
export {
  ancestorsOf,
  fieldsOfModel,
  kindOf,
  modelOf,
  relationTarget,
  relationsOfModel,
  type DomainFieldKind,
  type DomainModel,
  type GtsCatalog,
  type GtsId,
  type ModelEntity,
  type ModelField,
  type ModelProperty,
  type ModelRelation,
} from '@constructor-studio/mfe-shared';

import { ancestorsOf, relationTarget, type DomainModel, type ModelProperty } from '@constructor-studio/mfe-shared';

const isRelation = (p: ModelProperty) => p.extends === 'edge' || p.extends === 'link';

/** The relations a saved view's `include` follows from `id`, by name, and the entity each reaches (the
 *  prototype's `relationsOfModel` as views-model uses it). A name two bases point at different entities is
 *  left out: the query could not tell which one it means. */
export function includableRelations(model: DomainModel, id: string): Record<string, string> {
  const chain = new Set(ancestorsOf(model, id));
  const found: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const e of model.entities) {
    if (!chain.has(e.id)) continue;
    for (const p of e.properties ?? []) {
      if (!isRelation(p) || !p.name) continue;
      const target = relationTarget(model, p);
      if (!target) continue;
      if (p.name in found && found[p.name] !== target) ambiguous.add(p.name);
      else found[p.name] = target;
    }
  }
  for (const a of ambiguous) delete found[a];
  return found;
}
