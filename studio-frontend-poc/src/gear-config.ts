/* The product's configuration of its gears, read against each gear's config
 * schema (from its gear.gdl, as the Gearbox engine knows it). Pure: the form
 * in gear-config-form.tsx renders what these compute.
 */
import type { GearConfig, GearConfigSchema } from "./api";

/** What a person typed, as the JSON value it means: `true`/`false`, a
 *  number, or else the text itself. */
export function configValue(text: string): unknown {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return text;
}

/** A value as it goes back into an input: a string as it is, anything else
 *  as JSON; nothing as the empty string. */
export function configText(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** One field of one gear, as the form shows it. */
export interface ConfigRow {
  field: string;
  required: boolean;
  /** The gear's default; undefined when it has none. */
  default?: unknown;
  /** Written by generation; shown, never edited. */
  derived: boolean;
  /** Declared in the gear's schema; false for a field only the config sets. */
  declared: boolean;
  /** Whether the product sets it. */
  set: boolean;
  value?: unknown;
  /** Required, no default, not derived, not set: the engine refuses this. */
  missing: boolean;
}

export interface GearConfigRows {
  gear: string;
  /** False when the corpus does not describe the gear, or no schema was read. */
  described: boolean;
  /** False for a gear the config sets but the product no longer picks. */
  picked: boolean;
  rows: ConfigRow[];
}

/** Every picked gear with its schema's fields in declared order, then the
 *  fields its config sets that the schema does not name. Gears the config
 *  sets but nobody picks follow the picks, so a stale setting stays visible
 *  and removable. */
export function configRows(
  picks: readonly string[],
  schemas: readonly GearConfigSchema[],
  config: GearConfig,
): GearConfigRows[] {
  const byGear = new Map(schemas.map((s) => [s.gear, s]));
  const gears = [...new Set(picks)];
  const stale = Object.keys(config).filter((g) => !gears.includes(g));
  return [...gears, ...stale].map((gear) => {
    const schema = byGear.get(gear);
    const values = config[gear] ?? {};
    const isSet = (field: string) => Object.prototype.hasOwnProperty.call(values, field);
    const declared: ConfigRow[] = (schema?.fields ?? []).map((f) => {
      const hasDefault = f.default !== undefined && f.default !== null;
      const set = isSet(f.name);
      return {
        field: f.name,
        required: f.required,
        default: hasDefault ? f.default : undefined,
        derived: f.derived,
        declared: true,
        set,
        value: set ? values[f.name] : undefined,
        missing: f.required && !hasDefault && !f.derived && !set,
      };
    });
    const names = new Set(declared.map((r) => r.field));
    const extra: ConfigRow[] = Object.keys(values)
      .filter((field) => !names.has(field))
      .map((field) => ({
        field,
        required: false,
        derived: false,
        declared: false,
        set: true,
        value: values[field],
        missing: false,
      }));
    return {
      gear,
      described: Boolean(schema?.id),
      picked: gears.includes(gear),
      rows: [...declared, ...extra],
    };
  });
}

/** The fields the engine will refuse the product over, gear by gear. */
export function unsetRequired(gears: readonly GearConfigRows[]): { gear: string; field: string }[] {
  return gears
    .filter((g) => g.picked)
    .flatMap((g) => g.rows.filter((r) => r.missing).map((r) => ({ gear: g.gear, field: r.field })));
}
