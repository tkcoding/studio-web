/**
 * Platform › Components and Organization › Components (the prototype's
 * `ComponentsCatalog`, ADR-0041/0042): one header, then the platform's
 * catalogue as a table, or the organization's registry beside its catalogue;
 * a component's page opens over either.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { openScreen } from '@constructor-studio/mfe-shared';
import type { CatalogNode } from '../../api/types';
import {
  categoriesOf,
  filterCatalogue,
  nameOf,
  rowFacts,
  schemaFor,
  type RowFacts,
  type SortMode,
} from '../../model/catalogue';
import { COMPONENT_KIND_LABELS, inKindFilter, kindChips, syncedSources, type KindChip } from '../../model/component-kinds';
import { inTierTab, shadowedNote, tierCounts } from '../../model/component-tiers';
import { readinessOf } from '../../model/readiness';
import { reviewCounts, reviewOf, type ReviewPart } from '../../model/review-summary';
import { useScope, type Text } from './common';
import { ComponentPage, TrendMark, WINDOWS } from './ComponentPage';
import { PageHeader, StatusChip, OutLink } from './parts';
import { Registry, type RegistrySummary } from './Registry';
import { SourcesDialog, useCatalogueSync } from './Sources';
import { useBaselines, useCatalogue } from './useCatalogue';
import styles from './ComponentsScreen.module.css';

export function Catalogue({ tier }: { tier: 'platform' | 'organization' }) {
  const { org, platformAdmin, t, bridge, container } = useScope();
  const orgId = org?.id ?? null;
  const platformLevel = tier === 'platform';
  const { data, reload, setProfile } = useCatalogue(orgId);
  const { gears, profiles, resolved, schemas, componentTypes, truncated, shadowed, err } = data;
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const baselines = useBaselines(orgId, days);
  const [registry, setRegistry] = useState<RegistrySummary | null>(null);
  const [decide, setDecide] = useState(false);
  const readNow = useRef<(() => void) | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sync = useCatalogueSync(orgId, reload);

  const levelNodes = useMemo(() => (gears ?? []).filter((g) => inTierTab(g, tier)), [gears, tier]);
  const tiers = useMemo(() => tierCounts(gears ?? []), [gears]);
  const filledFrom = useMemo(() => syncedSources(levelNodes, profiles).join(' + '), [levelNodes, profiles]);
  const selectedGear = useMemo(
    () => (selected ? (gears ?? []).find((g) => nameOf(g) === selected) ?? null : null),
    [selected, gears]
  );

  if (selectedGear) {
    return (
      <ComponentPage
        gear={selectedGear}
        profile={profiles[nameOf(selectedGear)]}
        values={resolved[nameOf(selectedGear)]?.values ?? {}}
        schema={schemaFor(schemas, selectedGear.type_id)}
        baselines={baselines}
        days={days}
        onDays={setDays}
        onBack={() => setSelected(null)}
        onSaved={(p) => setProfile(nameOf(selectedGear), p)}
      />
    );
  }

  const status = (
    <>
      {!platformLevel && registry ? (
        <span className={styles.count} data-components-count>
          {registry.total === null ? t('reading') : registry.total}
          {registry.decide > 0 && (
            <>
              {' · '}
              <StatusChip tone="warn" onClick={() => setDecide((d) => !d)} pressed={decide} data-components-decide>
                {t.count('needs_decision', registry.decide)}
              </StatusChip>
            </>
          )}
        </span>
      ) : (
        <span className={styles.count} data-components-count>
          {gears === null ? t('reading') : tiers[tier]} ·{' '}
          {filledFrom ? filledFrom.replace(/ \+ /g, ' · ') : t('not_synced')}
        </span>
      )}
      {sync.line && (
        <StatusChip
          tone={sync.busy ? 'running' : sync.ok ? 'ok' : 'danger'}
          title={sync.line}
          data-components-sync={sync.busy ? 'running' : sync.ok ? 'done' : 'failed'}
        >
          {sync.busy ? t('syncing_line', { line: sync.line.replace(/…$/, '') }) : sync.ok ? t('synced_line', { line: sync.line }) : t('sync_failed_line', { line: sync.line })}
        </StatusChip>
      )}
      {registry?.reading && (
        <StatusChip tone={registry.failed ? 'danger' : 'running'} data-registry-reading>
          {registry.failed ? t('read_failed', { line: registry.reading }) : registry.reading}
        </StatusChip>
      )}
    </>
  );

  const info = platformLevel ? (
    <p>{t('platform_info')}</p>
  ) : (
    <>
      <p>{t('organization_info')}</p>
      <p>{t('organization_info_members')}</p>
      {shadowedNote(shadowed) && <p data-shadowed>{shadowedNote(shadowed)}</p>}
      {filledFrom && <p>{t('filled_from', { sources: filledFrom })}</p>}
    </>
  );

  const actions = platformLevel ? (
    platformAdmin ? (
      <Button onClick={() => openScreen(bridge, '/platform/repositories')} title={t('repositories_sync_title')}>
        {t('repositories_sync')}
      </Button>
    ) : null
  ) : (
    <>
      <Button
        variant="outline"
        disabled={!!registry?.reading && !registry.failed}
        onClick={() => readNow.current?.()}
        data-registry-read
      >
        {t('read_projects_now')}
      </Button>
      <Button variant="outline" onClick={() => setSourcesOpen(true)} data-components-sources>
        {t('sources')}
      </Button>
      <Button disabled={sync.busy} onClick={() => void sync.run()} data-components-sync-btn>
        {sync.busy ? t('syncing') : t('sync')}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title={platformLevel ? t('platform_title') : t('organization_title')}
        status={status}
        info={info}
        infoLabel={t('about', { title: platformLevel ? t('platform_title') : t('organization_title') })}
        actions={actions}
        container={container}
      />
      {sourcesOpen && <SourcesDialog sync={sync} onClose={() => setSourcesOpen(false)} />}
      {truncated && <p className={styles.hint}>{t('truncated', { count: gears?.length ?? 0 })}</p>}
      {err && gears !== null && <p className={styles.error}>{err}</p>}
      {platformLevel ? (
        <CatalogueTable
          gears={gears}
          err={err}
          onRetry={reload}
          levelNodes={levelNodes}
          componentTypes={componentTypes}
          resolved={resolved}
          schemas={schemas}
          baselines={baselines.byName}
          days={days}
          onDays={setDays}
          onOpen={setSelected}
          t={t}
        />
      ) : (
        <Registry
          readRef={readNow}
          onSummary={setRegistry}
          candidates={decide}
          onCandidates={setDecide}
          onOpenComponent={setSelected}
          catalogue={levelNodes.filter((g) => componentTypes === null || componentTypes.has(g.type_id))}
        />
      )}
    </>
  );
}

/* ── the platform's catalogue as a table ─────────────────────────────────── */

const SORTS: SortMode[] = ['name-asc', 'name-desc', 'downloads-desc', 'downloads-asc'];

function CatalogueTable({
  gears,
  err,
  onRetry,
  levelNodes,
  componentTypes,
  resolved,
  schemas,
  baselines,
  days,
  onDays,
  onOpen,
  t,
}: {
  gears: CatalogNode[] | null;
  err: string | null;
  onRetry: () => void;
  levelNodes: CatalogNode[];
  componentTypes: Set<string> | null;
  resolved: ReturnType<typeof useCatalogue>['data']['resolved'];
  schemas: ReturnType<typeof useCatalogue>['data']['schemas'];
  baselines: ReturnType<typeof useBaselines>['byName'];
  days: number;
  onDays: (days: number) => void;
  onOpen: (name: string) => void;
  t: Text;
}) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [hideSdk, setHideSdk] = useState(false);
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<SortMode>('name-asc');
  const resolvedCategory = (name: string) => resolved[name]?.category;
  const base = useMemo(
    () => filterCatalogue(levelNodes, { q, category, hideSdk, sort, componentTypes, resolvedCategory }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [levelNodes, q, category, hideSdk, sort, componentTypes, resolved]
  );
  const chips = useMemo(() => kindChips(base), [base]);
  // A kind chip that no longer has rows is not a choice any more.
  const kindShown = chips.some((c) => c.value === kind) ? kind : '';
  const visible = useMemo(() => base.filter((g) => inKindFilter(g, kindShown)), [base, kindShown]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const categories = useMemo(() => categoriesOf(gears ?? [], resolvedCategory), [gears, resolved]);
  const facts = useMemo(() => {
    const out = new Map<string, RowFacts>();
    for (const g of visible) {
      const name = nameOf(g);
      out.set(
        g.instance_id,
        rowFacts(g, resolved[name]?.values ?? {}, schemaFor(schemas, g.type_id), baselines.get(name), resolved[name]?.sources)
      );
    }
    return out;
  }, [visible, resolved, schemas, baselines]);
  const filtered = !!(q.trim() || category || hideSdk || kind);
  const clear = () => {
    setQ('');
    setCategory('');
    setHideSdk(false);
    setKind('');
  };

  return (
    <section className={styles.stack} data-catalogue>
      <div className={styles.toolbar}>
        <Input
          type="search"
          className={styles.search}
          placeholder={t('search_components')}
          aria-label={t('search_components')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {categories.length > 0 && (
          <NativeSelect aria-label={t('every_category')} value={category} onChange={(e) => setCategory(e.target.value)}>
            <NativeSelectOption value="">{t('every_category')}</NativeSelectOption>
            {categories.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <NativeSelect aria-label={t('sort')} value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          {SORTS.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {t(`sort_${s.replace('-', '_')}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <StatusChip tone={hideSdk ? 'info' : 'neutral'} onClick={() => setHideSdk((h) => !h)} pressed={hideSdk}>
          {t('hide_sdks')}
        </StatusChip>
        <KindPicker chips={chips} value={kindShown} onChange={setKind} t={t} />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clear}>
            {t('clear_filters')}
          </Button>
        )}
        <NativeSelect aria-label={t('window')} value={String(days)} onChange={(e) => onDays(Number(e.target.value))}>
          {WINDOWS.map((w) => (
            <NativeSelectOption key={w} value={String(w)}>
              {t('since_window', { days: w })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {gears === null ? (
        err ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{err}</EmptyTitle>
            </EmptyHeader>
            <EmptyActions>
              <Button variant="outline" onClick={onRetry}>
                {t('retry')}
              </Button>
            </EmptyActions>
          </Empty>
        ) : (
          <Skeleton className={styles.skeleton} />
        )
      ) : visible.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{levelNodes.length === 0 ? t('no_components') : t('nothing_matches')}</EmptyTitle>
            {levelNodes.length === 0 && <EmptyDescription>{t('no_components_body')}</EmptyDescription>}
          </EmptyHeader>
          {filtered && (
            <EmptyActions>
              <Button variant="outline" onClick={clear}>
                {t('clear_filters')}
              </Button>
            </EmptyActions>
          )}
        </Empty>
      ) : (
        <Table data-catalogue-table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_component')}</TableHead>
              <TableHead>{t('col_type')}</TableHead>
              <TableHead>{t('col_release')}</TableHead>
              <TableHead>{t('col_readiness')}</TableHead>
              <TableHead className={styles.num}>{t('col_downloads')}</TableHead>
              <TableHead>{t('col_review')}</TableHead>
              <TableHead>{t('col_profile')}</TableHead>
              <TableHead>{t('col_source')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((g) => {
              const f = facts.get(g.instance_id);
              return (
                <TableRow
                  key={g.instance_id}
                  className={styles.openRow}
                  onClick={() => onOpen(nameOf(g))}
                  data-component-row={nameOf(g)}
                >
                  <TableCell className={styles.lead}>
                    <div className={styles.name}>{nameOf(g)}</div>
                    {g.value.description && <div className={styles.purpose}>{String(g.value.description)}</div>}
                    <SourceChips sources={f?.sources} t={t} />
                  </TableCell>
                  <TableCell>
                    {f && (
                      <>
                        <Badge variant="secondary" title={f.excluded ?? f.kindReason}>
                          {COMPONENT_KIND_LABELS[f.kind] ?? f.kind}
                        </Badge>
                        {f.category && f.category !== f.kind && <div className={styles.sub}>{f.category}</div>}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    {f?.version ? (
                      <span data-release={f.declared ? 'declared' : 'published'}>
                        <code
                          className={styles.version}
                          title={f.declared ? t('declared_in_repository') : t('versions_on_crates', { count: String(g.value.num_versions ?? '—') })}
                        >
                          {String(f.version)}
                        </code>
                        {!!f.declared && (
                          <span className={styles.muted} role="img" aria-label={t('not_on_crates')} title={t('not_on_crates')}>
                            {' ⊘'}
                          </span>
                        )}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{f && <ReadinessCell values={f.values} t={t} />}</TableCell>
                  <TableCell className={styles.num}>
                    {g.value.downloads != null ? Number(g.value.downloads).toLocaleString('en-US') : null}
                  </TableCell>
                  <TableCell>
                    {f && <ReviewCell parts={(f.values.grade as { parts?: ReviewPart[] } | null | undefined)?.parts} t={t} />}
                  </TableCell>
                  <TableCell>{f && <ProfileCell facts={f} t={t} />}</TableCell>
                  <TableCell>
                    {f?.repository ? (
                      <OutLink href={f.repository} title={f.repository}>
                        {f.repository.replace(/^https?:\/\/(www\.)?/, '')}
                      </OutLink>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** The component kinds in the list, as chips counted by the same predicate the table filters with. */
function KindPicker({
  chips,
  value,
  onChange,
  t,
}: {
  chips: KindChip[];
  value: string;
  onChange: (next: string) => void;
  t: Text;
}) {
  // "All" alone is no choice.
  if (chips.length < 2) return null;
  return (
    <span className={styles.chips} role="group" aria-label={t('type')}>
      <span className={styles.muted}>{t('type')}</span>
      {chips.map((c) => (
        <StatusChip
          key={c.value || 'all'}
          tone={value === c.value ? 'info' : 'neutral'}
          pressed={value === c.value}
          onClick={() => onChange(value === c.value ? '' : c.value)}
          title={c.value === '' ? t('every_component') : c.label}
          data-kind-chip={c.value || 'all'}
        >
          {c.value === '' || c.value === 'not-components' ? c.label : (COMPONENT_KIND_LABELS[c.value] ?? c.label)} {c.count}
        </StatusChip>
      ))}
    </span>
  );
}

const SOURCE_KEYS: Record<string, string> = {
  crates_io: 'source_crates',
  repository: 'source_repo',
  roadmap: 'source_roadmap',
  gearbox: 'source_gearbox',
  person: 'source_person',
};

/** Where a record's facts came from, in the order they are layered. */
export function SourceChips({ sources, t }: { sources: RowFacts['sources']; t: Text }) {
  if (!sources?.length) return null;
  const planOnly = sources.every((s) => s.kind === 'roadmap');
  return (
    <div className={styles.chips} aria-label={t('sources')}>
      {planOnly && <Badge variant="info">{t('planned_no_code')}</Badge>}
      {sources.map((s) => (
        <Badge key={`${s.kind}:${s.label}`} variant="secondary" title={s.label}>
          {SOURCE_KEYS[s.kind] ? t(SOURCE_KEYS[s.kind]) : s.kind}
          {s.kind === 'repository' || s.kind === 'roadmap' ? `: ${s.label}` : ''}
        </Badge>
      ))}
    </div>
  );
}

/** SPEC / SDK / IMPL as the board sets them, with what the repository shows (readiness.ts). */
function ReadinessCell({ values, t }: { values: RowFacts['values']; t: Text }) {
  const r = readinessOf(values as Parameters<typeof readinessOf>[0]);
  if (!r) return <span className={styles.absent}>{t('not_planned')}</span>;
  return (
    <div className={styles.ready}>
      {r.bars.map((b) => (
        <span key={b.axis} className={styles.readyBar} title={`${b.label}: ${b.pct === null ? 'N/A' : `${b.pct}%`}`}>
          <span className={styles.readyKey}>{b.axis}</span>
          <span className={styles.bar}>
            <span className={styles.barFill} style={{ width: `${b.pct ?? 0}%` }} />
          </span>
          <span className={styles.readyValue}>{b.pct === null ? '—' : `${b.pct}%`}</span>
        </span>
      ))}
      {r.evidence.length > 0 && <div className={styles.sub}>{r.evidence.map((e) => e.text).join(' · ')}</div>}
      {r.gaps.length > 0 && (
        <div className={styles.warnText} title={r.gaps.join('\n')}>
          {t('board_ahead')}
        </div>
      )}
    </div>
  );
}

/** The one check to look at first, and how many more (review-summary.ts). */
function ReviewCell({ parts, t }: { parts: ReviewPart[] | undefined; t: Text }) {
  const summary = reviewOf(parts);
  if (!summary) return <span className={styles.absent}>{t('not_graded')}</span>;
  const counts = reviewCounts(summary);
  if (!summary.top || !counts) return <span className={styles.okText}>{t('no_open_checks')}</span>;
  const items = [...summary.toReview, ...summary.noData];
  return (
    <details className={styles.review} onClick={(e) => e.stopPropagation()}>
      <summary title={summary.top.fix}>
        <span className={summary.top.known === false ? styles.muted : undefined}>{summary.top.label}</span>
        <span className={styles.sub}>{counts}</span>
      </summary>
      <ul>
        {items.map((p) => (
          <li key={`${p.area}:${p.label}`}>
            <b>{p.label}</b>{' '}
            <span className={styles.sub}>
              {p.known === false ? `${t('no_data')} · ` : ''}
              {p.fix}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProfileCell({ facts: { fields, pct, bad, watch, trend }, t }: { facts: RowFacts; t: Text }) {
  return (
    <>
      {fields.length === 0 ? (
        <span className={styles.absent}>{t('no_schema')}</span>
      ) : (
        <div className={styles.profile}>
          <span className={styles.bar}>
            <span className={styles.barFill} style={{ width: `${pct}%` }} />
          </span>
          <span>{pct}%</span>
          {bad > 0 && <Badge variant="danger">{bad}</Badge>}
          {watch > 0 && <Badge variant="warning">{watch}</Badge>}
        </div>
      )}
      {trend && trend.better + trend.worse > 0 && (
        <div className={styles.sub}>
          <TrendMark trend={trend} t={t} />
        </div>
      )}
    </>
  );
}
