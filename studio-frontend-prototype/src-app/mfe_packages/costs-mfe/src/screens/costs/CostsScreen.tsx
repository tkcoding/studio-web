/**
 * Organization › Costs (issue #781), the prototype's costs-screen.tsx carried
 * over (ADR-0069 §5): what the organization's model calls and IDE sessions
 * cost over a period, grouped by project, person, model, source or who paid,
 * with a switch for what people spent on their own keys; the monthly budgets
 * and where this month stands against them (warnings only, nothing is
 * stopped); and the price list those costs are priced with.
 *
 * The records are quantities kept by the platform's usage collector; the money
 * is computed from the price list when the report is read, so changing a price
 * reprices the past too. The words the models compose (row names, standings,
 * validation problems) stay the models' English.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiRegistry, useApiQuery } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyActions,
  EmptyHeader,
  EmptyTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  errorMessage,
  isNotFound,
  refusalText,
  useHostChrome,
  useOrganization,
} from '@constructor-studio/mfe-shared';
import { CostsApiService } from '../../api/CostsApiService';
import type { BudgetList, BudgetStatus, CostGroup, CostReport, ModelPrice, PriceList, SessionPrice } from '../../api/types';
import {
  budgetProblem,
  budgetWarnings,
  budgetsOf,
  levelBadge,
  nextPlace,
  percent,
  placeLabel,
  rowsOf,
  standingText,
  type BudgetRow,
} from '../../model/budgets';
import { GROUPS, PERIODS, blankModel, hours, money, periodRange, priceProblem, rowLabel, tokens, type Period } from '../../model/costs';
import { useCostsTranslations } from '../../i18n';
import styles from './CostsScreen.module.css';

type Text = ReturnType<typeof useCostsTranslations>['t'];

/** The four per-token prices of a model, in the editor's column order. */
const TOKEN_PRICES = ['input_per_mtok', 'output_per_mtok', 'cache_read_per_mtok', 'cache_write_per_mtok'] as const;

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** The gear's own words for a refusal, else the error's message. */
const errText = (e: unknown) => refusalText(e) ?? errorMessage(e);

export const CostsScreen: React.FC = () => {
  const { org, loading: orgLoading } = useOrganization();
  const { containerRef, dataTheme } = useHostChrome();
  const { t, loading } = useCostsTranslations();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-org-costs>
      {loading || orgLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : !org ? (
        <p className={styles.muted}>{t('no_org')}</p>
      ) : (
        // Keyed by the organization: another organization is another read, from nothing.
        <OrgCosts key={org.id} org={org} t={t} container={containerRef} />
      )}
    </div>
  );
};

CostsScreen.displayName = 'CostsScreen';

/** Who the caller is, to name their own row "You" in the report by person. */
function useYou(): string | undefined {
  const me = useApiQuery(apiRegistry.getService(AccountsApiService).getMe);
  return me.data?.subject_id;
}

function OrgCosts({
  org,
  t,
  container,
}: {
  org: { id: string; name: string };
  t: Text;
  /** Where the Budgets dialog portals: inside this screen's themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const you = useYou();
  const [prices, setPrices] = useState<PriceList | null>(null);
  /** Bumped by every saved price list: the report and the standings are read again. */
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState<Period>('this-month');
  const [group, setGroup] = useState<CostGroup>('project');
  const [personal, setPersonal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The last report read, with what it was asked for: a different ask is still counting. */
  const [read, setRead] = useState<{ ask: string; report: CostReport | null; error: string | null } | null>(null);

  // The editor's working copy of the price list.
  const [models, setModels] = useState<ModelPrice[]>([]);
  const [session, setSession] = useState<SessionPrice | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The report, or the price list it is priced with: two tabs, not one page. */
  const [tab, setTab] = useState<'report' | 'prices'>('report');
  /** The budgets, a header action: open in a dialog. */
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  /** This month's budgets that warn, for the header's status. */
  const [budgetAlerts, setBudgetAlerts] = useState(0);

  const api = apiRegistry.getService(CostsApiService);

  useEffect(() => {
    let live = true;
    api
      .prices({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((p) => {
        if (!live) return;
        setPrices(p);
        setModels(p.models);
        setSession(p.session ?? null);
        setCurrency(p.currency || 'USD');
      })
      .catch((e: unknown) => live && setError(isNotFound(e) ? t('not_counted') : errText(e)));
    return () => {
      live = false;
    };
  }, [api, org.id, t]);

  const mayView = prices?.may_view_costs ?? false;
  const ask = `${period}|${group}|${personal}|${revision}`;
  useEffect(() => {
    if (!mayView) return;
    let live = true;
    api
      .costs({ organizationId: org.id, ...periodRange(period), groupBy: group, includePersonal: personal })
      .fetch({ staleTime: 0 })
      // The report's own failure: a later good read clears it, and a save leaves it alone.
      .then((report) => live && setRead({ ask, report, error: null }))
      .catch((e: unknown) => live && setRead((r) => ({ ask, report: r?.report ?? null, error: errText(e) })));
    return () => {
      live = false;
    };
  }, [api, org.id, mayView, period, group, personal, ask]);
  const report = read?.report ?? null;
  const counting = mayView && read?.ask !== ask;

  const problem = priceProblem(models, session, currency);
  const save = async () => {
    if (problem) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await api.updatePrices(org.id).fetch({ currency, models, session });
      setPrices(saved);
      setRevision((n) => n + 1);
      setNotice(t('prices_saved'));
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };
  const setModel = (i: number, patch: Partial<ModelPrice>) =>
    setModels((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const editable = prices?.may_manage ?? false;
  /** Nothing is priced, saved: every cost would read $0. */
  const unpricedList = !!prices && prices.models.length === 0 && !prices.session;
  const shownTab = mayView ? tab : 'prices';
  const groupLabel = (id: CostGroup) => t(`group_${id}`);

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <div className={styles.chips}>
          {!prices && !error && <Badge variant="info">{t('reading')}</Badge>}
          {report && mayView && !unpricedList && (
            <span className={styles.total} data-costs-total>
              {t('total_for_period', {
                total: money(report.total, report.currency),
                period: t(`period_${period}`).toLowerCase(),
              })}
            </span>
          )}
          {unpricedList && (
            <button type="button" className={styles.chip} onClick={() => setTab('prices')} data-costs-no-prices>
              <Badge variant="warning" dot>
                {t('no_prices_chip')}
              </Badge>
            </button>
          )}
          {budgetAlerts > 0 && (
            <button type="button" className={styles.chip} onClick={() => setBudgetsOpen(true)} data-costs-budget-alerts>
              <Badge variant="warning" dot>
                {t.count('budget_alerts', budgetAlerts)}
              </Badge>
            </button>
          )}
          {prices && !mayView && <Badge variant="secondary">{t('administrators_only')}</Badge>}
        </div>
        {mayView && (
          <Button className={styles.headerAction} onClick={() => setBudgetsOpen(true)} data-costs-budgets>
            {t('budgets')}
          </Button>
        )}
      </header>
      <div className={styles.about}>
        <p>{t('about_costs', { org: org.name })}</p>
        <p>{t('about_budgets')}</p>
        {prices && !mayView && <p>{t('about_view_only')}</p>}
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}

      {prices && mayView && (
        <OrgBudgets
          orgId={org.id}
          personal={personal}
          prices={prices}
          revision={revision}
          open={budgetsOpen}
          onClose={() => setBudgetsOpen(false)}
          onAlerts={setBudgetAlerts}
          container={container}
          t={t}
        />
      )}

      {prices && (
        <Tabs value={shownTab} onValueChange={(v) => setTab(v === 'prices' ? 'prices' : 'report')}>
          <TabsList variant="line" aria-label={t('tabs_label')}>
            {mayView && (
              <TabsTrigger value="report" data-costs-tab="report">
                {t('tab_report')}
              </TabsTrigger>
            )}
            <TabsTrigger value="prices" data-costs-tab="prices">
              {t('tab_prices')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {mayView && shownTab === 'report' && unpricedList && (
        <Empty data-costs-empty-prices>
          <EmptyHeader>
            <EmptyTitle>{t('no_prices_title')}</EmptyTitle>
          </EmptyHeader>
          <EmptyActions>
            <Button onClick={() => setTab('prices')} data-costs-set-prices>
              {t('set_prices')}
            </Button>
          </EmptyActions>
        </Empty>
      )}

      {mayView && shownTab === 'report' && !unpricedList && (
        <Card data-cost-report>
          <CardContent className={styles.cardBody}>
            {read?.error && (
              <p role="alert" className={styles.error}>
                {read.error}
              </p>
            )}
            <div className={styles.controls}>
              <label className={styles.control}>
                {t('period')}
                <NativeSelect
                  size="sm"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as Period)}
                  aria-label={t('period')}
                  data-cost-period
                >
                  {PERIODS.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {t(`period_${p.id}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className={styles.control}>
                {t('group_by')}
                <NativeSelect
                  size="sm"
                  value={group}
                  onChange={(e) => setGroup(e.target.value as CostGroup)}
                  aria-label={t('group_by_label')}
                  data-cost-group
                >
                  {GROUPS.map((g) => (
                    <NativeSelectOption key={g.id} value={g.id}>
                      {groupLabel(g.id)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className={styles.control} title={t('personal_hint')}>
                <Switch size="sm" checked={personal} onCheckedChange={(on) => setPersonal(on)} data-cost-personal />
                {t('personal')}
              </label>
              {counting && <span className={styles.muted}>{t('counting')}</span>}
            </div>
            {report && report.rows.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('nothing_used')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
            {report && report.rows.length > 0 && (
              <Table data-cost-table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{groupLabel(report.group_by ?? group)}</TableHead>
                    <TableHead className={styles.num}>{t('col_input')}</TableHead>
                    <TableHead className={styles.num}>{t('col_output')}</TableHead>
                    <TableHead className={styles.num}>{t('col_cache_read')}</TableHead>
                    <TableHead className={styles.num}>{t('col_cache_write')}</TableHead>
                    <TableHead className={styles.num}>{t('col_sessions')}</TableHead>
                    <TableHead className={styles.num}>{t('col_cost')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.key || '-'} data-cost-row={r.key}>
                      <TableCell>{rowLabel(r, report.group_by ?? group, you)}</TableCell>
                      <TableCell className={styles.num}>{tokens(r.input_tokens)}</TableCell>
                      <TableCell className={styles.num}>{tokens(r.output_tokens)}</TableCell>
                      <TableCell className={styles.num}>{tokens(r.cache_read_tokens)}</TableCell>
                      <TableCell className={styles.num}>{tokens(r.cache_write_tokens)}</TableCell>
                      <TableCell className={styles.num}>{hours(r.session_seconds)}</TableCell>
                      <TableCell className={styles.num}>
                        {money(r.cost, report.currency)}
                        {r.unpriced && (
                          <span className={styles.unpriced} title={t('row_unpriced')}>
                            {' '}
                            *
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className={styles.strong}>{t('total')}</TableCell>
                    <TableCell colSpan={5} />
                    <TableCell className={`${styles.num} ${styles.strong}`} data-cost-total>
                      {money(report.total, report.currency)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
            {report && report.unpriced.length > 0 && (
              <p className={styles.unpriced} data-cost-unpriced>
                {t('report_unpriced', { models: report.unpriced.join(', ') })}{' '}
                <button type="button" className={styles.link} onClick={() => setTab('prices')}>
                  {t('add_price')}
                </button>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {prices && shownTab === 'prices' && (
        <Card data-price-list>
          <CardContent className={styles.cardBody}>
            <p className={styles.muted}>{t('prices_hint')}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_provider')}</TableHead>
                  <TableHead>{t('col_model')}</TableHead>
                  <TableHead className={styles.num}>{t('col_input_mtok')}</TableHead>
                  <TableHead className={styles.num}>{t('col_output_mtok')}</TableHead>
                  <TableHead className={styles.num}>{t('col_cache_read_mtok')}</TableHead>
                  <TableHead className={styles.num}>{t('col_cache_write_mtok')}</TableHead>
                  {editable && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m, i) => (
                  <TableRow key={i} data-price-row={i}>
                    <TableCell>
                      <Input
                        value={m.provider}
                        disabled={!editable}
                        onChange={(e) => setModel(i, { provider: e.target.value })}
                        aria-label={t('col_provider')}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={m.model}
                        disabled={!editable}
                        onChange={(e) => setModel(i, { model: e.target.value })}
                        aria-label={t('col_model')}
                        placeholder="claude-sonnet-5-5*"
                      />
                    </TableCell>
                    {TOKEN_PRICES.map((k) => (
                      <TableCell key={k} className={styles.num}>
                        <Input
                          className={styles.number}
                          type="number"
                          min={0}
                          step="0.01"
                          value={Number.isNaN(m[k]) ? '' : m[k]}
                          disabled={!editable}
                          onChange={(e) => setModel(i, { [k]: num(e.target.value) })}
                          aria-label={k}
                        />
                      </TableCell>
                    ))}
                    {editable && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setModels((ms) => ms.filter((_, j) => j !== i))}
                        >
                          {t('remove')}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {models.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 7 : 6} className={styles.muted} data-price-empty>
                      {t('no_model_priced')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className={styles.actions}>
              <label className={styles.control}>
                {t('session_cpu')}
                <Input
                  className={styles.number}
                  type="number"
                  min={0}
                  step="0.001"
                  value={session && !Number.isNaN(session.cpu_core_hour) ? session.cpu_core_hour : ''}
                  disabled={!editable}
                  placeholder={t('unpriced')}
                  onChange={(e) =>
                    setSession({ cpu_core_hour: num(e.target.value), memory_gib_hour: session?.memory_gib_hour ?? 0 })
                  }
                  aria-label={t('session_cpu')}
                />
              </label>
              <label className={styles.control}>
                {t('session_memory')}
                <Input
                  className={styles.number}
                  type="number"
                  min={0}
                  step="0.001"
                  value={session && !Number.isNaN(session.memory_gib_hour) ? session.memory_gib_hour : ''}
                  disabled={!editable}
                  placeholder={t('unpriced')}
                  onChange={(e) =>
                    setSession({ cpu_core_hour: session?.cpu_core_hour ?? 0, memory_gib_hour: num(e.target.value) })
                  }
                  aria-label={t('session_memory')}
                />
              </label>
              <label className={styles.control}>
                {t('currency')}
                <Input
                  className={styles.currency}
                  value={currency}
                  disabled={!editable}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  aria-label={t('currency')}
                />
              </label>
            </div>
            {editable ? (
              <div className={styles.actions}>
                <Button variant="outline" onClick={() => setModels((ms) => [...ms, blankModel()])} data-price-add>
                  {t('add_model')}
                </Button>
                <Button loading={saving} disabled={!!problem} onClick={() => void save()} data-price-save>
                  {saving ? t('saving') : t('save_prices')}
                </Button>
                {problem && (
                  <span className={styles.error} data-price-problem>
                    {problem}
                  </span>
                )}
              </div>
            ) : (
              <p className={styles.muted}>{t('prices_manage_only')}</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** The organization's monthly budgets: this month's standing, worst first,
 *  and the editor for whoever holds cost.manage. Spend on people's own keys
 *  counts as the report's switch says. */
function OrgBudgets({
  orgId,
  personal,
  prices,
  revision,
  open,
  onClose,
  onAlerts,
  container,
  t,
}: {
  orgId: string;
  personal: boolean;
  prices: PriceList;
  /** A changed price reprices this month too, so the standing follows it. */
  revision: number;
  /** Shown in a dialog; closed, it still reads the standing for the header. */
  open: boolean;
  onClose: () => void;
  onAlerts: (n: number) => void;
  container: React.RefObject<HTMLDivElement | null>;
  t: Text;
}) {
  const [list, setList] = useState<BudgetList | null>(null);
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [warnAt, setWarnAt] = useState(80);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const api = apiRegistry.getService(CostsApiService);

  const adopt = useCallback((l: BudgetList) => {
    setList(l);
    setRows(rowsOf(l.budgets));
    setWarnAt(l.warn_at_percent);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .budgets({ organizationId: orgId })
      .fetch({ staleTime: 0 })
      .then((l) => live && adopt(l))
      .catch((e: unknown) => live && setError(isNotFound(e) ? t('budgets_not_counted') : errText(e)));
    return () => {
      live = false;
    };
  }, [api, orgId, adopt, t]);

  const hasBudgets = !!list && list.budgets.length > 0;
  useEffect(() => {
    if (!hasBudgets) return;
    let live = true;
    api
      .budgetStatus({ organizationId: orgId, includePersonal: personal })
      .fetch({ staleTime: 0 })
      .then((st) => {
        if (!live) return;
        setStatus(st);
        onAlerts(budgetWarnings(st).length);
      })
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, orgId, personal, hasBudgets, list, revision, onAlerts]);

  // No budget, no standing: what was read before the last one went is not shown.
  const standing = hasBudgets ? status : null;
  const warnings = budgetWarnings(standing);
  const currency = standing?.currency ?? list?.currency ?? prices.currency;
  const problem = budgetProblem(rows, warnAt);
  const editable = list?.may_manage ?? false;
  const places = list?.places ?? [];
  const free = nextPlace(places, rows);
  const setRow = (i: number, patch: Partial<BudgetRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (problem) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const l = await api.updateBudgets(orgId).fetch({ warn_at_percent: warnAt, budgets: budgetsOf(rows) });
      adopt(l);
      if (l.budgets.length === 0) onAlerts(0);
      setNotice(t('budgets_saved'));
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const shown = open && (!!list || !!error);
  return (
    <Dialog open={shown} onOpenChange={(next) => !next && onClose()}>
      {shown && (
        <DialogContent container={container} size="lg" closeLabel={t('close')} className={styles.dialog}>
          <section className={styles.dialogBody} data-budgets>
            <DialogHeader>
              <DialogTitle>{t('budgets_title')}</DialogTitle>
              <DialogDescription>
                {t('budgets_hint', { currency, percent: list?.warn_at_percent ?? warnAt })}
                {!personal && ` ${t('budgets_no_personal')}`}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            {notice && <p className={styles.notice}>{notice}</p>}
            {warnings.length > 0 && standing && (
              <div className={styles.warnings} role="status" data-budget-warnings>
                <strong>{t.count('attention', warnings.length)}</strong>
                <ul>
                  {warnings.map((w) => (
                    <li key={w.tenant_id ?? 'org'} data-budget-warning={w.level}>
                      {w.label}: {standingText(w, currency)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {standing && standing.standings.length > 0 && (
              <Table data-budget-standings>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_budget_for')}</TableHead>
                    <TableHead className={styles.num}>{t('col_spent')}</TableHead>
                    <TableHead className={styles.num}>{t('col_budget')}</TableHead>
                    <TableHead className={styles.num}>{t('col_used')}</TableHead>
                    <TableHead className={styles.num}>{t('col_month_end')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standing.standings.map((st) => (
                    <TableRow key={st.tenant_id ?? 'org'} data-budget-row={st.tenant_id ?? 'org'}>
                      <TableCell>{st.label}</TableCell>
                      <TableCell className={styles.num}>{money(st.spent, currency)}</TableCell>
                      <TableCell className={styles.num}>{money(st.monthly, currency)}</TableCell>
                      <TableCell className={styles.num}>{percent(st.spent, st.monthly)}%</TableCell>
                      <TableCell
                        className={styles.num}
                        title={st.forecast == null ? t('forecast_later') : undefined}
                      >
                        {st.forecast == null ? '—' : money(st.forecast, currency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={st.level === 'over' ? 'danger' : st.level === 'warning' ? 'warning' : 'secondary'}
                          data-level={st.level}
                        >
                          {levelBadge(st)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {standing && standing.unpriced.length > 0 && (
              <p className={styles.unpriced}>{t('budgets_unpriced', { models: standing.unpriced.join(', ') })}</p>
            )}
            {list && list.budgets.length === 0 && !editable && <p className={styles.muted}>{t('no_budget')}</p>}

            {editable && (
              <>
                <Table data-budget-editor>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <NativeSelect
                            value={r.tenant_id}
                            onChange={(e) => setRow(i, { tenant_id: e.target.value })}
                            aria-label={t('col_budget_for')}
                          >
                            {places.map((p) => (
                              <NativeSelectOption key={p.id} value={p.kind === 'organization' ? '' : p.id}>
                                {placeLabel(p)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </TableCell>
                        <TableCell>
                          <span className={styles.control}>
                            <Input
                              className={styles.number}
                              type="number"
                              min={0}
                              step="1"
                              value={Number.isNaN(r.monthly) ? '' : r.monthly}
                              onChange={(e) => setRow(i, { monthly: num(e.target.value) })}
                              aria-label={t('monthly_budget')}
                            />
                            {t('per_month', { currency })}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                          >
                            {t('remove')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    disabled={free === null}
                    onClick={() => free !== null && setRows((rs) => [...rs, { tenant_id: free, monthly: 0 }])}
                    data-budget-add
                  >
                    {t('add_budget')}
                  </Button>
                  <label className={styles.control}>
                    {t('warn_at')}
                    <Input
                      className={styles.percent}
                      type="number"
                      min={1}
                      max={99}
                      step="1"
                      value={Number.isNaN(warnAt) ? '' : warnAt}
                      onChange={(e) => setWarnAt(num(e.target.value))}
                      aria-label={t('warn_at_label')}
                    />
                    %
                  </label>
                  <Button loading={saving} disabled={!!problem} onClick={() => void save()} data-budget-save>
                    {saving ? t('saving') : t('save_budgets')}
                  </Button>
                  {problem && (
                    <span className={styles.error} data-budget-problem>
                      {problem}
                    </span>
                  )}
                </div>
              </>
            )}
            {list && !editable && <p className={styles.muted}>{t('budgets_manage_only')}</p>}
          </section>
        </DialogContent>
      )}
    </Dialog>
  );
}
