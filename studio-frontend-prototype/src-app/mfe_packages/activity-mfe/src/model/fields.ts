/**
 * What the Timeline needs of the Studio domain model as the server holds it:
 * a type's own and inherited fields, and a field's value as text and back.
 * The pure parts of the prototype's `domain-runtime.ts` (`kindOf`,
 * `fieldsOfModel`) and `object-attributes.tsx` (`shown`, `asInput`,
 * `parsed`, `SYSTEM_BUCKET`), as admin-mfe carries them
 * (`admin-mfe/src/model/domain-runtime.ts`); a kit cannot import another
 * MFE's code.
 */

/** A field's kind, as `domain-model.gen.ts` declares it. */
export type DomainFieldKind =
  | { kind: 'string' | 'number' | 'boolean' | 'list' | 'unknown' }
  | { kind: 'enum'; values: readonly string[] };

export interface ModelProperty {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  extends?: string;
  held_by?: string;
}

export interface ModelEntity {
  id: string;
  name?: string;
  bucket?: string;
  extends?: string | null;
  properties?: ModelProperty[];
}

export interface ModelField {
  name: string;
  type: string;
  kind: DomainFieldKind;
  required: boolean;
  description: string;
  /** The entity that declares it: this one, or a base. */
  declaredBy: string;
  /** The gear that writes it, when one does: not set from a screen. */
  heldBy?: string;
}

/** The bucket of the meta-model's own types (`system-object`, `entity`, …):
 *  their fields are bookkeeping, not something a person fills in. */
export const SYSTEM_BUCKET = 'system-primitives';

export interface DomainModel {
  entities: ModelEntity[];
  byId: Map<string, ModelEntity>;
}

export function modelOf(res: { ontology?: { entities?: unknown[] } | null }): DomainModel {
  const entities = ((res.ontology?.entities ?? []) as ModelEntity[]).filter(
    (e) => e && typeof e.id === 'string'
  );
  return { entities, byId: new Map(entities.map((e) => [e.id, e])) };
}

const isRelation = (p: ModelProperty) => p.extends === 'edge' || p.extends === 'link';

/** A type expression's kind: the generator's `fieldKind`, at runtime. */
export function kindOf(expr: string | undefined): DomainFieldKind {
  let t = String(expr ?? '').trim().replace(/\?$/, '').trim();
  if (t.endsWith('[]')) return { kind: 'list' };
  if (t.includes('|')) {
    const parts = t.split('|').map((s) => s.trim());
    if (parts.every((s) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) && /^[a-z]/.test(s))) {
      return { kind: 'enum', values: parts };
    }
    return { kind: 'unknown' };
  }
  t = t.toLowerCase();
  if (/^(string|text|url|uri|hash|sha|textcontent|email)$/.test(t)) return { kind: 'string' };
  if (/^timestamp|date-?time|date$/.test(t)) return { kind: 'string' };
  if (/^(integer|int|number|decimal|float)$/.test(t) || /^\d+\.\.\d+$/.test(t)) return { kind: 'number' };
  if (/^bool(ean)?$/.test(t)) return { kind: 'boolean' };
  if (/(id|ref)$/.test(t)) return { kind: 'string' };
  return { kind: 'unknown' };
}

/** The entity and every base it extends, nearest first; stops on a cycle. */
function ancestorsOf(model: DomainModel, id: string): string[] {
  const chain = [id];
  for (let at = id; ; ) {
    const base = model.byId.get(at)?.extends;
    if (!base || !model.byId.has(base) || chain.includes(base)) return chain;
    chain.push(base);
    at = base;
  }
}

/** Own and inherited payload fields, root first, nearest declaration wins. */
export function fieldsOfModel(model: DomainModel, id: string): ModelField[] {
  const out: ModelField[] = [];
  for (const a of ancestorsOf(model, id).reverse()) {
    for (const p of model.byId.get(a)?.properties ?? []) {
      if (isRelation(p) || !p.name) continue;
      const field: ModelField = {
        name: p.name,
        type: p.type ?? '',
        kind: kindOf(p.type),
        required: !!p.required,
        description: p.description ?? '',
        declaredBy: a,
        heldBy: p.held_by,
      };
      const at = out.findIndex((x) => x.name === p.name);
      if (at >= 0) out[at] = field;
      else out.push(field);
    }
  }
  return out;
}

/** A stored value as text, for reading. */
export function shown(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(shown).join(', ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** What the input holds, back as the value the field's kind stores. */
export function parsed(field: ModelField, raw: string | boolean): unknown {
  if (typeof raw === 'boolean') return raw;
  const v = raw.trim();
  if (v === '') return null;
  switch (field.kind.kind) {
    case 'number':
      return Number.isNaN(Number(v)) ? v : Number(v);
    case 'list':
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    case 'unknown':
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    default:
      return v;
  }
}

/** A stored value as what an input holds. */
export function asInput(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
