/* The product's configuration of its gears, as a form: for each gear in the
 * product, the fields its gear.gdl declares (required, default), prefilled
 * with what product.config sets. A required field with no default that the
 * product leaves unset is what makes the engine refuse the product, so those
 * are marked. Fields generation writes (an endpoint's address) are shown, not
 * edited. A field the schema does not name can still be set below.
 */
import { useEffect, useMemo, useState } from "react";

import { api, type GearConfig, type GearConfigSchema } from "./api";
import { configRows, configText, configValue, unsetRequired, type ConfigRow } from "./gear-config";
import { gearLabel } from "./product";

/** What the form needs of the product's state. */
export type GearConfigProduct = {
  picks: string[];
  config: GearConfig;
  /** Set one field of one gear; `undefined` removes it. */
  setField: (gear: string, field: string, value: unknown) => void;
};

const inputStyle = { fontSize: 12, width: 180 } as const;

export function GearConfigForm({ token, product }: { token: string; product: GearConfigProduct }) {
  const { picks, config } = product;
  const [schemas, setSchemas] = useState<GearConfigSchema[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const asked = useMemo(() => [...new Set(picks)].sort().join("\n"), [picks]);

  useEffect(() => {
    const gears = asked ? asked.split("\n") : [];
    if (gears.length === 0) {
      setSchemas([]);
      return;
    }
    let live = true;
    api
      .gearConfigSchemas(token, gears)
      .then((r) => {
        if (!live) return;
        setSchemas(r.items);
        setSchemaError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setSchemas([]);
        setSchemaError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [token, asked]);

  const gears = useMemo(() => configRows(picks, schemas, config), [picks, schemas, config]);
  const missing = unsetRequired(gears);
  if (picks.length === 0) return null;

  return (
    <div style={{ fontSize: 12, marginTop: 8 }} data-gear-config>
      <div style={{ opacity: 0.7, marginBottom: 4 }}>Configuration</div>
      {schemaError && (
        <div className="hint" style={{ fontSize: 12 }}>
          The gears' config schemas could not be read ({schemaError}); only what the product sets is shown.
        </div>
      )}
      {missing.length > 0 && (
        <div style={{ color: "var(--destructive)", margin: "2px 0 6px" }} data-config-missing>
          {missing.length === 1 ? "1 required field is" : `${missing.length} required fields are`} unset — the
          engine refuses the product until {missing.length === 1 ? "it is" : "they are"} set.
        </div>
      )}
      {gears.map((g) => (
        <GearFields key={g.gear} gear={g.gear} picked={g.picked} described={g.described} rows={g.rows} product={product} />
      ))}
      <OtherField picks={picks} product={product} />
    </div>
  );
}

function GearFields({
  gear,
  picked,
  described,
  rows,
  product,
}: {
  gear: string;
  picked: boolean;
  described: boolean;
  rows: ConfigRow[];
  product: GearConfigProduct;
}) {
  return (
    <fieldset
      data-gear={gear}
      style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", margin: "4px 0", padding: "4px 8px" }}
    >
      <legend style={{ padding: "0 4px" }}>
        <code>{gearLabel(gear)}</code>
        {!picked && <span style={{ opacity: 0.6 }}> · not in the product</span>}
      </legend>
      {rows.length === 0 && (
        <div style={{ opacity: 0.6 }}>
          {described ? "Nothing to configure." : "No config schema is known for this gear; set fields below if it takes any."}
        </div>
      )}
      {rows.map((r) => (
        <FieldRow key={r.field} gear={gear} row={r} product={product} />
      ))}
    </fieldset>
  );
}

function FieldRow({ gear, row, product }: { gear: string; row: ConfigRow; product: GearConfigProduct }) {
  const label = `${gear} ${row.field}`;
  const text = configText(row.value);
  return (
    <div
      data-config-field={row.field}
      data-missing={row.missing || undefined}
      style={{ display: "flex", gap: 6, alignItems: "center", margin: "2px 0" }}
    >
      <code style={{ minWidth: 140, color: row.missing ? "var(--destructive)" : undefined }}>{row.field}</code>
      {row.derived ? (
        <span style={{ opacity: 0.6 }}>written by generation from the topology</span>
      ) : (
        <>
          <input
            // Keyed on the value, so a change from elsewhere (completion
            // aligning a vendor) replaces what the input shows.
            key={text}
            aria-label={label}
            aria-invalid={row.missing || undefined}
            defaultValue={text}
            placeholder={row.default !== undefined ? configText(row.default) : row.required ? "required" : ""}
            onBlur={(e) => {
              const next = e.target.value;
              if (next === text) return;
              product.setField(gear, row.field, next.trim() === "" ? undefined : configValue(next));
            }}
            style={{ ...inputStyle, borderColor: row.missing ? "var(--destructive)" : undefined }}
          />
          {row.set && (
            <button
              type="button"
              className="ghost"
              title={row.default !== undefined ? "Remove this setting (the default applies)" : "Remove this setting"}
              aria-label={`Remove ${label}`}
              onClick={() => product.setField(gear, row.field, undefined)}
            >
              ×
            </button>
          )}
        </>
      )}
      <span style={{ opacity: 0.6 }}>
        {[
          row.required && !row.derived ? "required" : null,
          row.default !== undefined ? `default ${configText(row.default)}` : null,
          row.declared ? null : "not in the schema",
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

/** A field the schema does not name: the escape hatch for a gear whose
 *  gear.gdl is behind its code, or one the corpus does not describe. */
function OtherField({ picks, product }: { picks: string[]; product: GearConfigProduct }) {
  const [gear, setGear] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  return (
    <form
      style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!gear || !field.trim()) return;
        product.setField(gear, field.trim(), configValue(value));
        setField("");
        setValue("");
      }}
    >
      <span style={{ opacity: 0.7 }}>Other field:</span>
      <select value={gear} onChange={(e) => setGear(e.target.value)} aria-label="Gear to configure" style={{ fontSize: 12 }}>
        <option value="">gear…</option>
        {picks.map((p) => (
          <option key={p} value={p}>
            {gearLabel(p)}
          </option>
        ))}
      </select>
      <input placeholder="field" value={field} onChange={(e) => setField(e.target.value)} style={{ fontSize: 12, width: 120 }} />
      <input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} style={{ fontSize: 12, width: 160 }} />
      <button type="submit" className="ghost" disabled={!gear || !field.trim()}>
        Set
      </button>
    </form>
  );
}
