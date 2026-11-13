/**
 * What Organization › Costs reads and writes (ported from the prototype's
 * client, ADR-0069 §5): the price list, the cost report, the monthly budgets
 * and where this month stands against them — all `studio-usage` (issue #781).
 * Every route names the organization in its query string.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { Budget, BudgetList, BudgetStatus, CostGroup, CostReport, ModelPrice, PriceList, SessionPrice } from './types';

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export interface CostsQuery {
  organizationId: string;
  from: string;
  to: string;
  groupBy: CostGroup;
  includePersonal: boolean;
}

export interface PricesBody {
  currency?: string;
  models: ModelPrice[];
  session?: SessionPrice | null;
}

export interface BudgetsBody {
  warn_at_percent?: number;
  budgets: Budget[];
}

export class CostsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  /** The organization's price list, and what the caller may do with it and its costs. */
  readonly prices = this.protocol(RestEndpointProtocol).queryWith<PriceList, { organizationId: string }>(
    ({ organizationId }) => `/studio-usage/v1/prices?${q({ organization_id: organizationId })}`
  );

  /** What the organization's model calls and IDE sessions cost over `[from, to)` (`cost.view`). */
  readonly costs = this.protocol(RestEndpointProtocol).queryWith<CostReport, CostsQuery>(
    ({ organizationId, from, to, groupBy, includePersonal }) =>
      `/studio-usage/v1/costs?${q({
        organization_id: organizationId,
        from,
        to,
        group_by: groupBy,
        include_personal: String(includePersonal),
      })}`
  );

  /** The organization's monthly budgets and what one can be set on (`cost.view`). */
  readonly budgets = this.protocol(RestEndpointProtocol).queryWith<BudgetList, { organizationId: string }>(
    ({ organizationId }) => `/studio-usage/v1/budgets?${q({ organization_id: organizationId })}`
  );

  /** Where this month's spend stands against each budget, worst first (`cost.view`).
   *  People's own keys count only with `includePersonal`. */
  readonly budgetStatus = this.protocol(RestEndpointProtocol).queryWith<
    BudgetStatus,
    { organizationId: string; includePersonal: boolean }
  >(
    ({ organizationId, includePersonal }) =>
      `/studio-usage/v1/budget-status?${q({ organization_id: organizationId, include_personal: String(includePersonal) })}`
  );

  /** Replace the price list (`cost.manage`). */
  updatePrices(organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<PriceList, PricesBody>(
      'PUT',
      `/studio-usage/v1/prices?${q({ organization_id: organizationId })}`
    );
  }

  /** Replace the budgets (`cost.manage`). */
  updateBudgets(organizationId: string) {
    return this.protocol(RestEndpointProtocol).mutation<BudgetList, BudgetsBody>(
      'PUT',
      `/studio-usage/v1/budgets?${q({ organization_id: organizationId })}`
    );
  }
}
