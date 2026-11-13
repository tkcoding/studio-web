/**
 * What changed in a component's fields since the window opened: its values
 * now against the snapshot the catalogue kept then
 * (`GET /studio-components-catalog/v1/component-history`).
 *
 * "Better" and "worse" only where the field says which way is up. A graded
 * field does -- its lamp went from bad to good, or the other way -- and so
 * does the grade itself, where a higher share of criteria met is better. A
 * bare number does not: more lines of code, more dependencies, more
 * downloads are neither good nor bad on their own, and calling them either
 * would be the page deciding something the schema never said. Those are
 * shown as changed, with the direction, and judged by nobody.
 */

export interface SnapshotField {
  n?: number;
  s?: string;
  b?: string;
}

export interface ComponentSnapshot {
  component: string;
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  fields: Record<string, SnapshotField>;
}

export type ChangeTone = "better" | "worse" | "neutral";

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  now: string;
  tone: ChangeTone;
}

export interface FieldTrend {
  /** The snapshot's date: what "since" means. */
  since: string;
  changes: FieldChange[];
  better: number;
  worse: number;
}

type Current = Record<string, { n?: number; s?: string; b?: string; v?: string } | null | undefined>;

/** How much of a badge a snapshot keeps (`BADGE_MAX` in history.rs). A
 *  longer badge now is compared on the same prefix, or every long
 *  description would read as changed on every visit. */
const BADGE_MAX = 80;
const cut = (t: string) => [...t].slice(0, BADGE_MAX).join("");

/** Worse is higher. `none` is an answer nobody graded, not a grade. */
const LAMP_RANK: Record<string, number> = { good: 1, watch: 2, bad: 3 };
const LAMP_WORD: Record<string, string> = { good: "good", watch: "watch", bad: "bad" };

function shown(v: { n?: number; s?: string; b?: string; v?: string } | null | undefined): string {
  if (!v) return "—";
  if (v.b) return v.b;
  if (typeof v.n === "number") return String(v.n);
  if (v.s && LAMP_WORD[v.s]) return LAMP_WORD[v.s];
  return "—";
}

function changeOf(
  key: string,
  label: string,
  lamp: boolean,
  now: Current[string],
  before: SnapshotField | undefined,
): FieldChange | undefined {
  if (!now && !before) return undefined;
  const text = { key, label, before: shown(before), now: shown(now ?? undefined) };

  const rankNow = now?.s ? LAMP_RANK[now.s] : undefined;
  const rankBefore = before?.s ? LAMP_RANK[before.s] : undefined;
  if (lamp && rankNow && rankBefore && rankNow !== rankBefore) {
    return {
      ...text,
      before: `${text.before} (${LAMP_WORD[before!.s!]})`,
      now: `${text.now} (${LAMP_WORD[now!.s!]})`,
      tone: rankNow < rankBefore ? "better" : "worse",
    };
  }
  const nNow = typeof now?.n === "number" ? now.n : undefined;
  const nBefore = typeof before?.n === "number" ? before.n : undefined;
  if (nNow !== undefined && nBefore !== undefined) {
    return nNow === nBefore ? undefined : { ...text, tone: "neutral" };
  }
  // No number on one side: compare what a reader sees.
  return cut(text.before) === cut(text.now) ? undefined : { ...text, tone: "neutral" };
}

/** The grade: the share of criteria met, where up is better. */
function gradeChange(now: Current[string], before: SnapshotField | undefined): FieldChange | undefined {
  if (typeof now?.n !== "number" || typeof before?.n !== "number" || now.n === before.n) return undefined;
  return {
    key: "grade",
    label: "Grade",
    before: `${before.b ?? ""} ${before.n}%`.trim(),
    now: `${now.b ?? ""} ${now.n}%`.trim(),
    tone: now.n > before.n ? "better" : "worse",
  };
}

/**
 * Every field whose answer moved since `snapshot`, the grade first, then
 * worse before better before merely changed -- the order a reader wants to
 * be told in.
 */
export function fieldTrend(
  fields: { key: string; label: string; lamp: boolean }[],
  now: Current,
  snapshot: ComponentSnapshot | undefined,
): FieldTrend | undefined {
  if (!snapshot) return undefined;
  const changes: FieldChange[] = [];
  const grade = gradeChange(now.grade, snapshot.fields.grade);
  for (const f of fields) {
    if (f.key === "grade") continue;
    const c = changeOf(f.key, f.label, f.lamp, now[f.key], snapshot.fields[f.key]);
    if (c) changes.push(c);
  }
  const order: Record<ChangeTone, number> = { worse: 0, better: 1, neutral: 2 };
  changes.sort((a, b) => order[a.tone] - order[b.tone]);
  if (grade) changes.unshift(grade);
  return {
    since: snapshot.date,
    changes,
    better: changes.filter((c) => c.tone === "better").length,
    worse: changes.filter((c) => c.tone === "worse").length,
  };
}
