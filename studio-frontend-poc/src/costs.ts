/* What the Costs screen computes before it draws (issue #781). Pure, so it is
 * tested without a backend. */

import type { CostGroup, CostRow, ModelPrice, SessionPrice } from "./api";

export type Period = "this-month" | "last-month" | "last-30-days";

export const PERIODS: { id: Period; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-30-days", label: "Last 30 days" },
];

export const GROUPS: { id: CostGroup; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "person", label: "Person" },
  { id: "model", label: "Model" },
  { id: "source", label: "Source" },
  { id: "payer", label: "Paid by" },
];

/** `[from, to)` of a period as RFC 3339, in UTC — the days the backend counts in. */
export function periodRange(period: Period, now: Date = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  switch (period) {
    case "this-month":
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 1))) };
    case "last-month":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 1))) };
    case "last-30-days": {
      const to = new Date(Date.UTC(y, m, now.getUTCDate() + 1));
      return { from: iso(new Date(to.getTime() - 30 * 86_400_000)), to: iso(to) };
    }
  }
}

/** Money in the report's currency: cents, or four places below one cent so a
 *  single call still shows. */
export function money(amount: number, currency: string): string {
  const digits = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** Tokens the way people read them: 1.2k, 3.4M. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Session time as hours and minutes. */
export function hours(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const PAYERS: Record<string, string> = {
  personal: "People's own keys",
  workspace: "Workspace connections",
  organization: "The organization",
};

/** What a row is called. `you` is the caller's subject id, to name their own row. */
export function rowLabel(row: CostRow, group: CostGroup, you?: string): string {
  if (row.label) return row.label;
  switch (group) {
    case "person":
      if (!row.key) return "IDE sessions (nobody in particular)";
      return row.key === you ? "You" : `Person ${row.key.slice(0, 8)}`;
    case "source":
      return row.key === "llm" ? "Model calls" : row.key === "session" ? "IDE sessions" : row.key;
    case "payer":
      return PAYERS[row.key] ?? (row.key || "Unknown");
    case "model":
      return row.key === "ide-session" ? "IDE sessions" : row.key;
    default:
      return row.key || "—";
  }
}

/** A blank model price, for the editor's add row. */
export function blankModel(): ModelPrice {
  return {
    provider: "anthropic",
    model: "",
    input_per_mtok: 0,
    output_per_mtok: 0,
    cache_read_per_mtok: 0,
    cache_write_per_mtok: 0,
  };
}

/** What would stop a price list from being stored, before it is sent: the
 *  rules the backend applies (`usage/prices.rs`, `validate`). */
export function priceProblem(
  models: ModelPrice[],
  session: SessionPrice | null = null,
  currency = "USD",
): string | null {
  if (!/^[A-Z]{3}$/.test(currency.trim() || "USD")) return `${currency} is not an ISO 4217 currency code.`;
  const seen = new Set<string>();
  for (const m of models) {
    if (!m.provider.trim() || !m.model.trim()) return "Every price names a provider and a model.";
    const key = `${m.provider.trim()}/${m.model.trim()}`;
    if (seen.has(key)) return `${key} is priced twice.`;
    seen.add(key);
    const values = [m.input_per_mtok, m.output_per_mtok, m.cache_read_per_mtok, m.cache_write_per_mtok];
    if (values.some((v) => !Number.isFinite(v) || v < 0)) return `${key}: a price is not a price.`;
  }
  if (session && [session.cpu_core_hour, session.memory_gib_hour].some((v) => !Number.isFinite(v) || v < 0))
    return "An IDE session price is not a price.";
  return null;
}
