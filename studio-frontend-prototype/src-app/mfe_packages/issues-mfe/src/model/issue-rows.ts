/*
 * The Issues table's rows: the server's queue (what stops a build, what to
 * look at, what was decided) and the documentation's thin places (the
 * server's `GET /project-domain-model/doc-quality`), one row each — the
 * prototype's `IssueRow` and `issueBody` (domain-model-screens.tsx at
 * 00828880) over the server's rows instead of the browser's.
 */

import type { DocQualityRow, SpecModelIssueRow } from '../api/types';
import { subjectKey, type SpecModelSide } from './spec-model';
import type { SavedEdit } from './saved-entities';

export type RowGroup = 'blocks' | 'look' | 'improve' | 'decided';

export const GROUP_ORDER: RowGroup[] = ['blocks', 'look', 'improve', 'decided'];

/** What an issue's text calls a group (the prototype's words). */
export const GROUP_LABEL: Record<RowGroup, string> = {
  blocks: 'stops a build',
  look: 'to look at',
  improve: 'improves the docs',
  decided: 'decided',
};

export interface IssueRow {
  key: string;
  /** What the row is, in English: the server's label. */
  label: string;
  /** The kind's translation key (`kind_<id>`). */
  kindId: string;
  group: RowGroup;
  title: string;
  side: SpecModelSide | null;
  tone: 'bad' | 'warn';
  queue?: SpecModelIssueRow;
  doc?: DocQualityRow;
}

/** The kind a server row is, as a translation id. */
export function queueKindId(r: Pick<SpecModelIssueRow, 'kind' | 'concern'>): string {
  if (r.kind === 'finding') return r.concern ? 'conflict' : 'problem';
  return r.kind;
}

/** Every row, the queue's first in the server's order, then the documentation's. */
export function issueRows(queue: SpecModelIssueRow[], better: DocQualityRow[]): IssueRow[] {
  return [
    ...queue.map((q) => ({
      key: q.key,
      label: q.label,
      kindId: queueKindId(q),
      group: q.group as RowGroup,
      title: q.title,
      side: q.sides[0] ?? null,
      tone: q.tone,
      queue: q,
    })),
    ...better.map((d) => ({
      key: d.key,
      label: d.label,
      kindId: d.kind,
      group: 'improve' as const,
      title: d.title,
      side: d.sides[0] ?? null,
      tone: 'warn' as const,
      doc: d,
    })),
  ];
}

/** The documentation rows without those whose entity was saved on this
 *  screen: the save is in the repository, and the model reads it on its next
 *  build (the saved edits are pruned once a build finished after them). */
export function withoutSaved(rows: DocQualityRow[], saved: SavedEdit[]): DocQualityRow[] {
  if (saved.length === 0) return rows;
  const keys = new Set(saved.map((s) => subjectKey(s.edit.name)));
  return rows.filter((r) => !r.entity || !keys.has(r.entity));
}

/** The sentence that states a relation, as a document would — redrawn as a
 *  person edits the verb of a proposed one: "Connection health belongs to
 *  **Connection**." The server proposes the same. */
export function relationSentence(name: string, verb: string, target: string): string {
  const subject = name.charAt(0).toUpperCase() + name.slice(1);
  return `${subject} ${verb.trim()} **${target}**.`;
}

/** An issue's text from a row: what is wrong, where, and what to do. */
export function issueBody(r: IssueRow): string {
  const hint = r.queue?.hint ?? r.doc?.hint ?? '';
  const sides = r.queue?.sides ?? r.doc?.sides ?? [];
  const lines = [`**${r.label}** — ${GROUP_LABEL[r.group]}.`, '', hint, ''];
  if (sides.length) {
    lines.push('Where:');
    for (const s of sides.slice(0, 5))
      lines.push(
        `- \`${s.path}${s.line_start ? `:${s.line_start}` : ''}\`${s.quote ? ` — “${s.quote.trim().slice(0, 200)}”` : ''}`
      );
    lines.push('');
  }
  const fix = r.queue?.edit;
  if (fix) lines.push(`Proposed fix in \`${fix.path}\`:`, '', '```diff', `- ${fix.replace}`, `+ ${fix.with}`, '```', '');
  lines.push("_Opened from the project's Issues in Constructor Studio._");
  return lines.join('\n');
}
