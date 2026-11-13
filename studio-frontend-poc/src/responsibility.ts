/**
 * Who answers for a component, as one map: the roles a component needs, who
 * holds each, and where that answer came from.
 *
 * Every role is already a field of the gear schema's Responsibility group, or
 * the roadmap board's assignees; they were just six unrelated rows among a
 * hundred. A map says what a list of rows does not: which roles nobody holds.
 * A role nobody recorded is shown as exactly that -- with where it would come
 * from -- rather than left out, since an empty role is the finding.
 */

export interface ResponsibilityRole {
  key: string;
  role: string;
  /** People or teams, as the source names them: `@team`, a login, a name. */
  holders: string[];
  /** A link to where the answer lives (the CODEOWNERS line, the board item). */
  link?: string;
  /** Where the answer comes from, or would. */
  source: string;
  /** "good" / "watch" / "bad" when the source grades it (CODEOWNERS, sign-off). */
  lamp?: string;
}

export interface ResponsibilityMap {
  roles: ResponsibilityRole[];
  held: number;
}

type Val = { v?: string; b?: string; s?: string; l?: string } | null | undefined;

/** The roles, in the order a reader asks about them: who owns it, who writes it, who plans it, who runs it. */
const ROLES: { key: string; role: string; source: string }[] = [
  { key: "owner", role: "Path owner", source: "CODEOWNERS" },
  { key: "maintainer", role: "Maintainer approval", source: "MAINTAINERS.md" },
  { key: "experts", role: "Code experts", source: "commit history" },
  { key: "roadmap_owner", role: "Roadmap assignees", source: "roadmap board" },
  { key: "pm", role: "Product manager", source: "recorded in the profile" },
  { key: "archreviewer", role: "Architecture reviewer", source: "recorded in the profile" },
  { key: "support", role: "3rd-line support", source: "recorded in the profile" },
];

/** `@a, @b` · `a b` · `a; b` → the names, blanks and "none" dropped. */
function names(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,;]|\s{2,}|\s+and\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(none|n\/a|—|-)$/i.test(s));
}

export function responsibilityOf(values: Record<string, Val>): ResponsibilityMap {
  const roles = ROLES.map(({ key, role, source }) => {
    const v = values[key];
    const holders = names(v?.b ?? v?.v);
    return { key, role, source, holders, link: v?.l, lamp: v?.s };
  });
  return { roles, held: roles.filter((r) => r.holders.length > 0).length };
}
