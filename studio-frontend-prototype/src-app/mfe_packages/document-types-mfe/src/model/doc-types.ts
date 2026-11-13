/**
 * The Document types editor's form, as pure functions: lifted out of the
 * prototype's `TypesView` (00828880:studio-frontend-prototype/src/documents.tsx)
 * without changing what it does, so it is tested without a screen.
 *
 * A type is edited as a form (comma-separated front-matter keys, a minimum of
 * words per section with 0 for none) and saved as the gear's shape.
 */

import type { DocRules, DocSection, DocType, UpsertDocTypeBody } from '../api/types';

/** One row of the section checklist. `aliases` is not edited here, only
 *  carried, so overriding a built-in type keeps the older headings it still
 *  recognizes. */
export interface SectionRow {
  title: string;
  required: boolean;
  minWords: number;
  aliases?: string[];
}

/** The editor's working copy of a type. */
export interface TypeForm {
  key: string;
  name: string;
  description: string;
  body: string;
  sections: SectionRow[];
  /** Comma-separated, as typed. */
  frontMatter: string;
  minTitle: number;
  forbid: boolean;
  warn: boolean;
}

/** A section's key, from its title. */
export const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'section';

/** A type as the form edits it. */
export function formOf(t: DocType): TypeForm {
  return {
    key: t.key,
    name: t.name,
    description: t.description,
    body: t.body,
    sections: t.sections.map((s) => ({
      title: s.title,
      required: s.required,
      minWords: s.min_words ?? 0,
      aliases: s.aliases ?? undefined,
    })),
    frontMatter: t.rules.front_matter.join(', '),
    minTitle: t.rules.min_title_words,
    forbid: t.rules.forbid_placeholders,
    warn: t.rules.warn_unknown_sections,
  };
}

/** What "New type" starts from. */
export function blankForm(): TypeForm {
  return {
    key: '',
    name: '',
    description: '',
    body: '# <title>\n\n## Section\n',
    sections: [{ title: 'Section', required: true, minWords: 0 }],
    frontMatter: 'status',
    minTitle: 1,
    forbid: true,
    warn: false,
  };
}

/** The front-matter keys the form names. */
export const frontKeys = (frontMatter: string) =>
  frontMatter
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Why the form cannot be saved, or null. */
export function formProblem(form: TypeForm): 'key_and_name' | null {
  return !form.key.trim() || !form.name.trim() ? 'key_and_name' : null;
}

/** The form as the gear takes it: untitled sections dropped, a minimum of 0 as none. */
export function bodyOf(form: TypeForm): UpsertDocTypeBody {
  const sections: DocSection[] = form.sections
    .filter((s) => s.title.trim())
    .map((s) => ({
      key: slug(s.title),
      title: s.title.trim(),
      required: s.required,
      min_words: s.minWords > 0 ? s.minWords : null,
      aliases: s.aliases?.length ? s.aliases : null,
    }));
  const rules: DocRules = {
    warn_unknown_sections: form.warn,
    front_matter: frontKeys(form.frontMatter),
    forbid_placeholders: form.forbid,
    min_title_words: form.minTitle,
  };
  return {
    key: form.key.trim(),
    name: form.name.trim(),
    description: form.description,
    body: form.body,
    sections,
    rules,
  };
}

/** When a document of this type conforms in a project, as the form now says. */
export interface Conformance {
  required: number;
  defined: number;
  minWords: boolean;
  frontMatter: string[];
  minTitle: number;
  forbid: boolean;
  warn: boolean;
}

export function conformance(form: TypeForm): Conformance {
  const defined = form.sections.filter((s) => s.title.trim());
  return {
    required: defined.filter((s) => s.required).length,
    defined: defined.length,
    minWords: defined.some((s) => s.minWords > 0),
    frontMatter: frontKeys(form.frontMatter),
    minTitle: form.minTitle,
    forbid: form.forbid,
    warn: form.warn,
  };
}
