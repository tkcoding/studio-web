/* Budgets on the Costs screen (issue #781): what may be spent in a month, and
 * where this month's spend stands. A budget warns and stops nothing. Pure, so
 * it is tested without a backend — and so the organization's Overview can
 * say the same thing from the same `api.budgetStatus` answer. */

import type { Budget, BudgetPlace, BudgetStanding, BudgetStatus } from "./api";
import { money } from "./costs";

/** How much of the budget is spent, as a whole percent. */
export function percent(amount: number, monthly: number): number {
  return monthly > 0 ? Math.round((amount / monthly) * 100) : 0;
}

/** The standings that need someone: past the warning share, now or by the
 *  month's end. Worst first, as the backend sends them. */
export function budgetWarnings(status: BudgetStatus | null | undefined): BudgetStanding[] {
  return (status?.standings ?? []).filter((s) => s.level !== "ok");
}

/** What a standing says, in one line. */
export function standingText(s: BudgetStanding, currency: string): string {
  const of = `${money(s.spent, currency)} of ${money(s.monthly, currency)}`;
  const ahead = s.forecast != null ? `${money(s.forecast, currency)} by the month's end` : "";
  if (s.level === "over" && !s.by_forecast) return `Over budget: ${of} spent.`;
  if (s.level === "over") return `On course to pass the budget: ${of} spent, ${ahead}.`;
  if (s.level === "warning" && !s.by_forecast) return `${percent(s.spent, s.monthly)}% of the budget spent: ${of}.`;
  if (s.level === "warning")
    return `On course for ${percent(s.forecast ?? 0, s.monthly)}% of the budget: ${of} spent, ${ahead}.`;
  return ahead ? `${of} spent, ${ahead}.` : `${of} spent.`;
}

/** A short badge for the table. */
export function levelBadge(s: BudgetStanding): string {
  if (s.level === "ok") return "On track";
  const word = s.level === "over" ? "Over" : "Near";
  return s.by_forecast ? `${word} by forecast` : word;
}

/** The editor's row: an empty `tenant_id` is the whole organization. */
export interface BudgetRow {
  tenant_id: string;
  monthly: number;
}

export function rowsOf(budgets: Budget[]): BudgetRow[] {
  return budgets.map((b) => ({ tenant_id: b.tenant_id ?? "", monthly: b.monthly }));
}

export function budgetsOf(rows: BudgetRow[]): Budget[] {
  return rows.map((r) => ({ tenant_id: r.tenant_id || null, monthly: r.monthly }));
}

/** What a place is called in the editor: workspaces and projects say which. */
export function placeLabel(place: BudgetPlace): string {
  if (place.kind === "organization") return `The organization (${place.label})`;
  return place.kind === "workspace" ? `Workspace ${place.label}` : `Project ${place.label}`;
}

/** The first place without a budget, for the editor's add row: the
 *  organization first, then in the order the backend lists them. */
export function nextPlace(places: BudgetPlace[], rows: BudgetRow[]): string | null {
  const taken = new Set(rows.map((r) => r.tenant_id));
  const free = places.find((p) => !taken.has(p.kind === "organization" ? "" : p.id));
  if (!free) return null;
  return free.kind === "organization" ? "" : free.id;
}

/** What would stop the budgets from being stored, before they are sent: the
 *  rules the backend applies (`usage/budgets.rs`, `validate`). */
export function budgetProblem(rows: BudgetRow[], warnAt: number): string | null {
  if (!Number.isInteger(warnAt) || warnAt < 1 || warnAt > 99) return "Warn at a share from 1 to 99 percent.";
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.tenant_id)) return "Each place has one budget.";
    seen.add(r.tenant_id);
    if (!Number.isFinite(r.monthly) || r.monthly <= 0) return "A budget is an amount above zero.";
  }
  return null;
}
