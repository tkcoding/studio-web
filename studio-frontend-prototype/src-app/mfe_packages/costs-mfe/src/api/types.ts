/**
 * The shapes the Costs screen reads from `studio-usage` (issue #781), as the
 * prototype's client had them (studio-frontend-prototype/src/api.ts at
 * 00828880).
 */

/** A model's price per million tokens of each kind (studio-usage, issue #781). */
export interface ModelPrice {
  provider: string;
  /** As the provider names it; a trailing `*` matches every model that starts with the rest. */
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
}

/** What an IDE session's pod costs per hour of what it requested. */
export interface SessionPrice {
  cpu_core_hour: number;
  memory_gib_hour: number;
}

export interface PriceList {
  currency: string;
  models: ModelPrice[];
  session?: SessionPrice | null;
  may_manage: boolean;
  may_view_costs: boolean;
}

export type CostGroup = 'person' | 'project' | 'model' | 'source' | 'payer';

export interface CostRow {
  /** A person's id, a tenant's id, `provider/model` or `ide-session`, `llm` / `session`, a payer. */
  key: string;
  label?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  session_seconds: number;
  cost: number;
  unpriced: boolean;
}

export interface CostReport {
  currency: string;
  from: string;
  to: string;
  group_by: CostGroup;
  include_personal: boolean;
  total: number;
  rows: CostRow[];
  unpriced: string[];
}

/** A monthly budget: the organization's (no `tenant_id`), a workspace's or a
 *  project's, in the price list's currency. It warns and stops nothing. */
export interface Budget {
  tenant_id?: string | null;
  monthly: number;
}

/** What a budget can be set on. */
export interface BudgetPlace {
  id: string;
  label: string;
  kind: 'organization' | 'workspace' | 'project';
}

export interface BudgetList {
  currency: string;
  /** Percent of a budget at which it warns. */
  warn_at_percent: number;
  budgets: Budget[];
  places: BudgetPlace[];
  may_manage: boolean;
}

export type BudgetLevel = 'ok' | 'warning' | 'over';

/** A budget against this month's spend. */
export interface BudgetStanding {
  tenant_id?: string | null;
  label: string;
  monthly: number;
  spent: number;
  /** The month's spend at the pace so far; absent in the first three days. */
  forecast?: number | null;
  level: BudgetLevel;
  /** Only the forecast reaches the level. */
  by_forecast: boolean;
}

export interface BudgetStatus {
  currency: string;
  warn_at_percent: number;
  from: string;
  to: string;
  measured_at: string;
  include_personal: boolean;
  /** Worst first. */
  standings: BudgetStanding[];
  /** What had no price this month, so is not in the spend. */
  unpriced: string[];
}
