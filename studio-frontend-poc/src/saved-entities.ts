// Entities saved from the Domain model tab, shown before a build reads them.
//
// A save writes the entity's section of docs/domain-model.md; the model only
// learns of it when a build reads that document again. Until then a person
// who just saved would see the old entity, and the queue would still ask for
// what was just done. So the tab lays what was saved over the facts it read,
// marked provisional, and drops it once a build that finished after the save
// has had its chance to read the document.
//
// Pure: spec-model-tab.tsx keeps the saved edits and draws what this computes.

import type { SpecModelEntityEdit, SpecModelWrite } from "./api";
import { subjectKey, type SpecModelBuild, type SpecModelFact } from "./spec-model";

/** Where the backend writes an entity's section. */
export const DOMAIN_MODEL_DOC = "docs/domain-model.md";

export const PROVISIONAL_NOTE = "saved, read on next build";

/** One entity saved this visit, where it went, and when. */
export interface SavedEdit {
  edit: SpecModelEntityEdit;
  write: SpecModelWrite;
  /** Milliseconds since the epoch. */
  at: number;
}

/** The facts a saved section will give once read, as the build would fold
 *  them: what it is, each field, each relation. */
export function savedFacts(edit: SpecModelEntityEdit): SpecModelFact[] {
  const base = {
    subject: edit.name,
    status: "active" as const,
    status_because: PROVISIONAL_NOTE,
    source: { path: DOMAIN_MODEL_DOC },
    provisional: true,
  };
  const out: SpecModelFact[] = [];
  const definition = edit.definition?.trim();
  if (definition) out.push({ ...base, kind: "entity", aspect: "", value: "", text: definition });
  for (const f of edit.fields) {
    if (!f.name.trim()) continue;
    out.push({ ...base, kind: "attribute", aspect: f.name.trim(), value: f.meaning.trim(), text: `${edit.name} holds ${f.name.trim()}` });
  }
  for (const r of edit.relations) {
    if (!r.verb.trim() || !r.target.trim()) continue;
    out.push({ ...base, kind: "relation", aspect: r.verb.trim(), value: r.target.trim(), text: `${edit.name} ${r.verb.trim()} ${r.target.trim()}` });
  }
  return out;
}

/** The facts with each saved entity laid over them. A save rewrites the
 *  entity's whole section, so what the model read from that section before
 *  goes; what other documents say stays. The saved facts come first, so the
 *  saved definition is the one a card shows. The last save of an entity wins. */
export function overlaySaved(facts: SpecModelFact[], saved: SavedEdit[]): SpecModelFact[] {
  if (saved.length === 0) return facts;
  const last = new Map<string, SavedEdit>();
  for (const s of saved) last.set(subjectKey(s.edit.name), s);
  const rewritten = (f: SpecModelFact) => f.source.path === DOMAIN_MODEL_DOC && last.has(subjectKey(f.subject));
  return [...[...last.values()].flatMap((s) => savedFacts(s.edit)), ...facts.filter((f) => !rewritten(f))];
}

/** The saved edits a build has not yet had its chance to read: a build that
 *  finished after the save replaces them with what it read. */
export function pruneSaved(saved: SavedEdit[], build: Pick<SpecModelBuild, "running" | "finished_at">): SavedEdit[] {
  if (build.running || !build.finished_at) return saved;
  const finished = Date.parse(build.finished_at);
  if (Number.isNaN(finished)) return saved;
  const kept = saved.filter((s) => s.at >= finished);
  return kept.length === saved.length ? saved : kept;
}

/** Record a save, replacing an earlier save of the same entity. */
export function withSaved(saved: SavedEdit[], next: SavedEdit): SavedEdit[] {
  const key = subjectKey(next.edit.name);
  return [...saved.filter((s) => subjectKey(s.edit.name) !== key), next];
}

/** Where each saved entity's write went, by its name's key. */
export function savedWrites(saved: SavedEdit[]): Map<string, SpecModelWrite> {
  return new Map(saved.map((s) => [subjectKey(s.edit.name), s.write]));
}
