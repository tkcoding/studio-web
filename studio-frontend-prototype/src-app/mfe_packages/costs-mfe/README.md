# costs-mfe — the Costs kit

Organization › Costs (issue #781), carried over from the prototype (ADR-0069).
The built-in kit `org-costs` (ADR-0068 §7) and, until a platform administrator
removes it, a base kit (ADR-0069 §4).

- `src/model/costs.ts`, `src/model/budgets.ts` — the prototype's pure models,
  unchanged, with their test suites.
- `src/api/CostsApiService.ts` — `studio-usage`: the price list, the cost
  report, the budgets and this month's standing against them.
- `src/screens/costs/CostsScreen.tsx` — the screen: the report, the price
  list editor and the Budgets dialog.
