#!/usr/bin/env node
// Generate the portal's types for the domain-model query from the model
// (into the shared MFE library, so every kit reads the same ones; ADR-0069 §5).
//
//   node scripts/gen-domain-client.mjs            # write the file
//   node scripts/gen-domain-client.mjs --check    # fail if the file is stale
//
// Input: the seed ontology the studio-domain-model gear boots every tenant
// with, `studio-backend/src/domain_model/ontology.studio.json`. Output:
// `studio-frontend-prototype/src-app/mfe_packages/shared/src/domain/model.gen.ts`, one interface per
// entity with every field it has (its own and its bases'), and per entity the
// relations `include` can follow and the entity each one reaches.
//
// Why generated, and why checked: `POST /studio-domain-model/v1/query` refuses
// a field or a relation the model does not have. Generated types move that
// refusal from a 400 in the browser to a compile error in the prototype, and
// `--check` (CI, beside check-docs) keeps the two from drifting. A tenant that
// has edited its own model is still answered by the query's 400s; this file is
// the shared model.
//
// The resolution below mirrors `domain_model/ontology.rs` — `ancestors`,
// `effective_properties`, `declared_relations` — and `query.rs`'s rule for
// which relation a name means on a type. Change them together.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = resolve(ROOT, "studio-backend/src/domain_model/ontology.studio.json");
const OUTPUT = resolve(ROOT, "studio-frontend-prototype/src-app/mfe_packages/shared/src/domain/model.gen.ts");

const doc = JSON.parse(readFileSync(INPUT, "utf8"));
const entities = doc.entities ?? [];

// Types that moved out of the core into a built-in kit (ADR-0070 phase 5) are
// still every base-kit organization's: their whole definitions come from the
// kits' `kit.json`, with the tabs the kits put on the levels.
const KITS = resolve(ROOT, "studio-backend/src/kit_registry/builtin");
for (const file of readdirSync(KITS).filter((f) => f.endsWith(".kit.json")).sort()) {
  const model = JSON.parse(readFileSync(resolve(KITS, file), "utf8")).model ?? {};
  for (const t of model.types ?? []) {
    if (t.entity && !entities.some((e) => e.id === t.entity.id)) entities.push(t.entity);
  }
  for (const { on, property } of model.properties ?? []) {
    const level = entities.find((e) => e.id === on);
    if (!level || (level.properties ?? []).some((q) => q.name === property.name)) continue;
    level.properties = [...(level.properties ?? []), property];
  }
  for (const tab of model.tabs ?? []) {
    const level = entities.find((e) => e.id === tab.level);
    const target = entities.find((e) => e.id === tab.target);
    if (!level || !target || (level.properties ?? []).some((q) => q.name === tab.name)) continue;
    level.properties = [
      ...(level.properties ?? []),
      {
        name: tab.name,
        type: target.id,
        relation: target.id,
        extends: "edge",
        relationType: "shows",
        relationLabel: tab.label,
        description: `A tab of the ${tab.level}: what it shows.`,
      },
    ];
  }
}
const byId = new Map(entities.map((e) => [e.id, e]));

const normalize = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const leaf = (id) => String(id).replace(/[-. ]/g, "_");
const isRelation = (p) => p.extends === "edge" || p.extends === "link";

/** `ontology.rs` `resolve_entity_id`: an id, or a node-type leaf. */
function resolveEntity(ref) {
  if (!ref) return null;
  if (byId.has(ref)) return ref;
  const want = leaf(String(ref).replace(/^gts\..*\.([^.]+)\.v1~$/, "$1"));
  return entities.find((e) => leaf(e.id) === want)?.id ?? null;
}

/** `ontology.rs` `target_entity_id`: a relation's target, by name or id. */
function targetEntity(type) {
  const t = normalize(type);
  if (!t) return null;
  return entities.find((e) => normalize(e.name) === t || normalize(e.id) === t)?.id ?? null;
}

/** The entity and every base it extends, nearest first; stops on a cycle. */
function ancestors(id) {
  const chain = [id];
  for (let at = id; ; ) {
    const base = resolveEntity(byId.get(at)?.extends);
    if (!base || chain.includes(base)) return chain;
    chain.push(base);
    at = base;
  }
}

/** Own and inherited payload fields, root first, nearest declaration wins. */
function effectiveProperties(id) {
  const out = [];
  for (const a of ancestors(id).reverse()) {
    for (const p of byId.get(a)?.properties ?? []) {
      if (isRelation(p) || !p.name) continue;
      const prop = { ...p, declared_by: a };
      const at = out.findIndex((x) => x.name === p.name);
      if (at >= 0) out[at] = prop;
      else out.push(prop);
    }
  }
  return out;
}

/**
 * The relations `include` accepts on `id`, by bare name: every relation an
 * ancestor declares whose target is in the model. A name that means two
 * different relations on this type is left out, as the query refuses it
 * unqualified.
 */
function relationsOf(id) {
  const chain = new Set(ancestors(id));
  const found = new Map();
  const ambiguous = new Set();
  for (const e of entities) {
    if (!chain.has(e.id)) continue;
    for (const p of e.properties ?? []) {
      if (!isRelation(p) || !p.name) continue;
      const target = targetEntity(p.type);
      if (!target) continue;
      const seen = found.get(p.name);
      if (seen && (seen.target !== target || seen.verb !== p.relationType)) ambiguous.add(p.name);
      else if (!seen) found.set(p.name, { target, verb: p.relationType ?? "", label: p.relationLabel ?? "" });
    }
  }
  return [...found].filter(([name]) => !ambiguous.has(name)).sort(([a], [b]) => a.localeCompare(b));
}

const pascal = (id) =>
  id.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

/**
 * A field's declared type expression as TypeScript. Only what is unambiguous
 * is typed (the same set `validate.rs` checks); the model's one-off domain
 * names are `unknown`, with the declared expression kept in the doc comment.
 */
function tsType(expr) {
  let t = String(expr ?? "").trim().replace(/\?$/, "").trim();
  if (t.endsWith("[]")) return `${wrap(tsType(t.slice(0, -2)))}[]`;
  if (t.includes("|")) {
    const parts = t.split("|").map((s) => s.trim());
    if (parts.every((s) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) && /^[a-z]/.test(s))) {
      return parts.map((s) => JSON.stringify(s)).join(" | ");
    }
    return "unknown";
  }
  if (/^(string|text|url|uri|hash|sha|textcontent|email)$/i.test(t)) return "string";
  if (/^timestamp|date-?time|date$/i.test(t)) return "string";
  if (/^(integer|int|number|decimal|float)$/i.test(t) || /^\d+\.\.\d+$/.test(t)) return "number";
  if (/^bool(ean)?$/i.test(t)) return "boolean";
  if (/(Id|Ref)$/.test(t)) return "string";
  if (/^(JSON|JsonValue|JSONSchema)$/.test(t) || /^Map</.test(t)) return "unknown";
  return "unknown";
}
const wrap = (t) => (t.includes("|") ? `(${t})` : t);

const prop = (name) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name));
const comment = (lines, indent = "") => {
  const body = lines.filter(Boolean).map((l) => String(l).replace(/\*\//g, "* /"));
  if (!body.length) return "";
  if (body.length === 1) return `${indent}/** ${body[0]} */\n`;
  return `${indent}/**\n${body.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
};

let out = "";
out += "// GENERATED by scripts/gen-domain-client.mjs from\n";
out += "// studio-backend/src/domain_model/ontology.studio.json. Do not edit; run the script.\n";
out += "//\n";
out += "// Every field is optional: a query returns what `fields` asked for, and\n";
out += "// stored objects are checked in `warn` mode, so a required field can be absent.\n";
out += "// `required` is in the doc comment.\n\n";

const ids = entities.map((e) => e.id);
for (const id of ids) {
  const e = byId.get(id);
  out += comment([e.name && e.name !== id ? `${e.name}.` : "", e.description, e.extends ? `Extends \`${e.extends}\`.` : ""]);
  out += `export interface ${pascal(id)} {\n`;
  for (const p of effectiveProperties(id)) {
    out += comment(
      [
        p.description,
        `\`${p.type ?? ""}\`${p.required ? ", required" : ""}${p.declared_by !== id ? `, from \`${p.declared_by}\`` : ""}.`,
      ],
      "  ",
    );
    out += `  ${prop(p.name)}?: ${tsType(p.type)};\n`;
  }
  out += "}\n\n";
}

out += "/** Every entity of the model, by the id `type` takes. */\n";
out += "export interface DomainEntities {\n";
for (const id of ids) out += `  ${prop(id)}: ${pascal(id)};\n`;
out += "}\n\n";
out += "export type DomainEntity = keyof DomainEntities;\n\n";

out += "/** Per entity, the relations `include` follows, and the entity each one reaches. */\n";
out += "export interface DomainRelations {\n";
for (const id of ids) {
  const rels = relationsOf(id);
  if (!rels.length) {
    out += `  ${prop(id)}: {};\n`;
    continue;
  }
  out += `  ${prop(id)}: {\n`;
  for (const [name, r] of rels) {
    out += comment([`${r.label || r.verb} → \`${r.target}\` (\`${r.verb}\` edge).`], "    ");
    out += `    ${prop(name)}: ${JSON.stringify(r.target)};\n`;
  }
  out += "  };\n";
}
out += "}\n\n";

/** A field's kind at runtime, for a screen that builds a query: what to offer
 *  as a value and which operators make sense. */
function fieldKind(expr) {
  const ts = tsType(expr);
  if (ts.endsWith("[]")) return { kind: "list" };
  if (ts.includes('"')) return { kind: "enum", values: ts.split(" | ").map((v) => JSON.parse(v)) };
  if (ts === "string" || ts === "number" || ts === "boolean") return { kind: ts };
  return { kind: "unknown" };
}

out += "/** A field's kind, for building a query at runtime. */\n";
out += "export type DomainFieldKind =\n";
out += '  | { kind: "string" | "number" | "boolean" | "list" | "unknown" }\n';
out += '  | { kind: "enum"; values: readonly string[] };\n\n';
out += "/** Per entity, every field and its kind: what `DomainEntities` says, readable at runtime. */\n";
out += "export const DOMAIN_FIELDS: { readonly [E in DomainEntity]: { readonly [field: string]: DomainFieldKind } } = {\n";
for (const id of ids) {
  const fields = effectiveProperties(id).map((p) => `${prop(p.name)}: ${JSON.stringify(fieldKind(p.type))}`);
  out += `  ${prop(id)}: { ${fields.join(", ")} },\n`;
}
out += "};\n\n";
out += "/** Per entity, the relations `include` follows and the entity each reaches, at runtime. */\n";
out += "export const DOMAIN_RELATION_TARGETS: { readonly [E in DomainEntity]: { readonly [relation: string]: DomainEntity } } = {\n";
for (const id of ids) {
  const rels = relationsOf(id).map(([name, r]) => `${prop(name)}: ${JSON.stringify(r.target)}`);
  out += `  ${prop(id)}: { ${rels.join(", ")} },\n`;
}
out += "};\n\n";

out += "/** Per entity, the bucket it belongs to: what the graphs colour it by. */\n";
out += "export const DOMAIN_BUCKETS: { readonly [E in DomainEntity]: string } = {\n";
for (const id of ids) out += `  ${prop(id)}: ${JSON.stringify(byId.get(id).bucket ?? "")},\n`;
out += "};\n\n";

out += "/** The entity ids, in the model's order. */\n";
out += `export const DOMAIN_ENTITIES = ${JSON.stringify(ids, null, 2).replace(/\n/g, "\n")} as const satisfies readonly DomainEntity[];\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current.replace(/\r\n/g, "\n") !== out) {
    console.error(
      "studio-frontend-prototype/src-app/mfe_packages/shared/src/domain/model.gen.ts is stale against the domain model.\n" +
        "Run: node scripts/gen-domain-client.mjs",
    );
    process.exit(1);
  }
  console.log(`domain-model.gen.ts is current: ${ids.length} entities.`);
} else {
  writeFileSync(OUTPUT, out);
  console.log(`wrote ${OUTPUT}: ${ids.length} entities.`);
}
