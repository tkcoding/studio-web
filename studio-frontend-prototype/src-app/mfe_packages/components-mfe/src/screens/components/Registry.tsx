/**
 * The organization's component registry (ADR-0041), the prototype's
 * `ComponentRegistry`: every component its projects declare — a `gear.toml`
 * or `gear.gdl` directory, a `#[toolkit::gear]` attribute, a FrontX package,
 * a kit manifest — laid beside what its catalogue holds, one row each. A row
 * opens under itself: why it looks like a gear, who owns it, where it is
 * declared, what was contributed or extracted, and the decisions it allows
 * (an organization administrator's; anyone else is told so by the 403).
 * "Needs a decision" lists the candidates, strongest first.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Empty,
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
import type { CatalogNode, RegistryEntry, RegistryProjectWalk } from '../../api/types';
import { ROW_STATES, componentRows, nameOf, rowMatches, type ComponentRow } from '../../model/catalogue';
import {
  STATE_LABEL,
  STATE_TONE,
  candidateWhere,
  candidatesOf,
  consumersLabel,
  evidenceLines,
  isDuplicated,
  isOrphaned,
  projectsOf,
  publishStatus,
  registryProjects,
  stateCounts,
  walkLine,
} from '../../model/registry';
import { api, errText, statusOf, useScope, waitForSync } from './common';
import { EntryDetail, RegistryDecisions, DeclareCandidate, type Person } from './RegistryEntry';
import { StatusChip, toneOf } from './parts';
import styles from './ComponentsScreen.module.css';

/** What the registry tells the screen's header. */
export interface RegistrySummary {
  /** Components on the list; null while it is read. */
  total: number | null;
  /** Candidates waiting for a decision. */
  decide: number;
  orphaned: number;
  /** A read now in flight, or how the last one ended. */
  reading: string;
  failed: boolean;
}

interface Loaded {
  entries: RegistryEntry[];
  excluded: string[];
  walks: RegistryProjectWalk[];
}

export function Registry({
  readRef,
  onSummary,
  candidates,
  onCandidates,
  onOpenComponent,
  catalogue,
}: {
  /** Where the header's Read the projects now finds this registry's read. */
  readRef: React.MutableRefObject<(() => void) | null>;
  onSummary: (s: RegistrySummary) => void;
  /** The candidates view, held by the header's chip. */
  candidates: boolean;
  onCandidates: (on: boolean) => void;
  /** Open a published component's page. */
  onOpenComponent: (name: string) => void;
  /** What the organization's catalogue holds, laid beside what its projects declare. */
  catalogue: CatalogNode[];
}) {
  const { org, platformAdmin, t } = useScope();
  const orgId = org?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const [sync, setSync] = useState('');
  const [busy, setBusy] = useState(false);
  const people = usePeople();
  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.name])), [people]);

  useEffect(() => {
    let live = true;
    const service = api();
    Promise.all([
      service.registry({ org: orgId }).fetch({ staleTime: 0 }),
      service
        .registryExcludedProjects({ org: orgId })
        .fetch({ staleTime: 0 })
        .catch(() => ({ project_ids: [] as string[] })),
      service
        .registryProjects({ org: orgId })
        .fetch({ staleTime: 0 })
        .catch(() => ({ items: [] as RegistryProjectWalk[], total: 0 })),
    ])
      .then(([list, ex, walked]) => {
        if (!live) return;
        setError(null);
        setLoaded({ entries: list.items, excluded: ex.project_ids, walks: walked.items });
      })
      .catch((cause: unknown) => {
        if (!live) return;
        // A backend from before the registry answers 404: say so plainly.
        if (statusOf(cause) === 404) setMissing(true);
        else setError(errText(cause));
      });
    return () => {
      live = false;
    };
  }, [orgId, tick]);
  const load = () => setTick((n) => n + 1);

  /** Read every project again now, rather than waiting for the schedule. */
  const readNow = async () => {
    setBusy(true);
    setSync('queued…');
    try {
      const { run_id } = await api().sync(orgId).fetch(undefined);
      const last = await waitForSync(run_id, orgId, (l) => setSync(l.done ? (l.ok ? '' : l.text) : l.text.split(' — ')[0] + '…'));
      if (last.ok) load();
    } catch (cause) {
      setSync(errText(cause));
    } finally {
      setBusy(false);
    }
  };

  // The header's button reads the projects through this.
  useEffect(() => {
    readRef.current = () => void readNow();
    return () => {
      readRef.current = null;
    };
  });

  const toggleProject = async (id: string) => {
    if (!loaded) return;
    const next = loaded.excluded.includes(id) ? loaded.excluded.filter((x) => x !== id) : [...loaded.excluded, id];
    setLoaded({ ...loaded, excluded: next });
    try {
      await api().saveExcludedProjects(orgId).fetch({ project_ids: next });
    } catch (cause) {
      setError(errText(cause));
    }
  };

  const entries = loaded?.entries ?? null;
  const rows = useMemo(() => componentRows(entries ?? [], catalogue), [entries, catalogue]);
  const counts = useMemo(() => stateCounts(entries ?? []), [entries]);
  const orphaned = (entries ?? []).filter(isOrphaned).length;
  const duplicated = (entries ?? []).filter(isDuplicated).length;

  useEffect(() => {
    onSummary({
      total: entries === null ? null : rows.length,
      decide: counts.candidate ?? 0,
      orphaned,
      reading: busy ? sync || 'reading…' : sync,
      failed: !busy && !!sync,
    });
  }, [entries, rows.length, counts.candidate, orphaned, busy, sync, onSummary]);

  if (missing) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('no_registry')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section className={styles.stack} data-component-registry>
      {error && <p className={styles.error}>{error}</p>}
      {loaded === null ? (
        error ? null : <Skeleton className={styles.skeleton} />
      ) : (
        <>
          <p className={styles.sub}>
            <b>{t.count('n_components', rows.length)}</b>
            {rows.length > loaded.entries.length && ` · ${t('published_undeclared', { count: rows.length - loaded.entries.length })}`}
            {duplicated > 0 && ` · ${t('declared_many', { count: duplicated })}`}
            {orphaned > 0 && ` · ${t('orphaned_many', { count: orphaned })}`}
          </p>
          <Unreadable loaded={loaded} />
          {candidates ? (
            <>
              <div className={styles.toolbar}>
                <StatusChip tone="info" pressed onClick={() => onCandidates(false)} data-registry-candidates-tab>
                  ✓ {t('needs_decision_chip', { count: counts.candidate ?? 0 })}
                </StatusChip>
              </div>
              <CandidatesView entries={loaded.entries} people={people} names={names} onDecided={load} />
            </>
          ) : (
            <RegistryTable
              rows={rows}
              entries={loaded.entries}
              withCatalogue={catalogue.length > 0}
              people={people}
              names={names}
              onDecided={load}
              onOpenComponent={onOpenComponent}
              platformAdmin={platformAdmin}
              decideChip={
                (counts.candidate ?? 0) > 0 ? (
                  <StatusChip
                    tone="warn"
                    onClick={() => onCandidates(true)}
                    title={
                      orphaned > 0
                        ? t('decide_title_orphaned', { candidates: counts.candidate ?? 0, orphaned })
                        : t('decide_title')
                    }
                    data-registry-candidates-tab
                  >
                    {t('needs_decision_chip', { count: counts.candidate ?? 0 })}
                  </StatusChip>
                ) : null
              }
            />
          )}
          <ProjectsRead loaded={loaded} entries={loaded.entries} onToggle={(id) => void toggleProject(id)} />
        </>
      )}
    </section>
  );
}

/** The caller's colleagues and the caller: who a decision can name as owner, and who decided. */
function usePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let live = true;
    const service = api();
    void Promise.all([
      service.colleagues().catch(() => []),
      service.myProfile.fetch({ staleTime: 0 }).catch(() => null),
    ]).then(([colleagues, me]) => {
      if (!live) return;
      const out = new Map<string, string>();
      if (me) out.set(me.id, me.display_name || me.email || me.id);
      for (const c of colleagues) if (!out.has(c.user_id)) out.set(c.user_id, c.display_name || c.user_id);
      setPeople([...out].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      live = false;
    };
  }, []);
  return people;
}

/** The projects of the last walk, with the ones excluded: which the registry reads. */
function projectsRead(loaded: Loaded, entries: RegistryEntry[]): { id: string; name: string }[] {
  const out = new Map<string, string>();
  for (const w of loaded.walks) out.set(w.project_id, w.project_name || w.project_id);
  const seen = new Map(registryProjects(entries).map((p) => [p.id, p.name]));
  for (const id of loaded.excluded) if (!out.has(id)) out.set(id, seen.get(id) ?? id);
  return [...out].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function Unreadable({ loaded }: { loaded: Loaded }) {
  const { t } = useScope();
  const unreadable = loaded.walks.filter((w) => !loaded.excluded.includes(w.project_id) && walkLine(w).failed);
  if (unreadable.length === 0) return null;
  return (
    <div className={styles.errorBox} data-registry-unreadable>
      <b>{t.count('projects_unreadable', unreadable.length)}</b> — {unreadable.map((w) => w.project_name || w.project_id).join(', ')}.{' '}
      {walkLine(unreadable[0]).hint ?? t('see_projects_below')}
    </div>
  );
}

function ProjectsRead({ loaded, entries, onToggle }: { loaded: Loaded; entries: RegistryEntry[]; onToggle: (id: string) => void }) {
  const { t } = useScope();
  const projects = projectsRead(loaded, entries);
  const read = projects.filter((p) => !loaded.excluded.includes(p.id)).length;
  return (
    <details className={styles.details} data-registry-projects>
      <summary>{t('projects_read', { read, total: projects.length })}</summary>
      <p className={styles.sub}>{t('projects_read_hint')}</p>
      {projects.length === 0 ? (
        <p className={styles.sub}>{t('no_walk_yet')}</p>
      ) : (
        <ul className={styles.plainList}>
          {projects.map((p) => {
            const line = walkLine(loaded.walks.find((w) => w.project_id === p.id));
            const off = loaded.excluded.includes(p.id);
            return (
              <li key={p.id}>
                <label className={styles.row}>
                  <Checkbox checked={!off} onCheckedChange={() => onToggle(p.id)} aria-label={p.name} />
                  {p.name}
                  <span className={line.failed && !off ? styles.errorText : styles.sub}>{off ? t('excluded') : line.text}</span>
                </label>
                {line.hint && !off && <div className={styles.sub}>{line.hint}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

/* ── the list ───────────────────────────────────────────────────────────── */

function RegistryTable({
  rows,
  entries,
  withCatalogue,
  people,
  names,
  onDecided,
  onOpenComponent,
  platformAdmin,
  decideChip,
}: {
  rows: ComponentRow[];
  entries: RegistryEntry[];
  withCatalogue: boolean;
  people: Person[];
  names: Record<string, string>;
  onDecided: () => void;
  onOpenComponent: (name: string) => void;
  platformAdmin: boolean;
  decideChip: React.ReactNode;
}) {
  const { t } = useScope();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [project, setProject] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind).filter(Boolean))].sort(), [rows]);
  const seen = useMemo(() => registryProjects(entries), [entries]);
  const states = ROW_STATES.filter((st) => rows.some((r) => r.state === st));
  const shown = rows.filter(
    (r) =>
      rowMatches(r, q) &&
      (!state || r.state === state) &&
      (!kind || r.kind === kind) &&
      (!project || (r.entry?.occurrences ?? []).some((o) => o.project_id === project))
  );
  const filtered = !!(q.trim() || state || kind || project);
  const columns = 4 + (withCatalogue ? 2 : 0);

  return (
    <>
      <div className={styles.toolbar}>
        <Input
          type="search"
          className={styles.search}
          placeholder={t('search_registry')}
          aria-label={t('search_registry')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {states.length > 1 && (
          <span className={styles.chips} role="group" aria-label={t('every_state')}>
            {states.map((st) => (
              <StatusChip
                key={st}
                tone={state === st ? 'info' : 'neutral'}
                pressed={state === st}
                onClick={() => setState(state === st ? '' : st)}
                data-state-chip={st}
              >
                {STATE_LABEL[st] ?? st} {rows.filter((r) => r.state === st).length}
              </StatusChip>
            ))}
          </span>
        )}
        {kinds.length > 1 && (
          <NativeSelect aria-label={t('every_type')} value={kind} onChange={(e) => setKind(e.target.value)}>
            <NativeSelectOption value="">{t('every_type')}</NativeSelectOption>
            {kinds.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {k}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {seen.length > 1 && (
          <NativeSelect aria-label={t('every_project')} value={project} onChange={(e) => setProject(e.target.value)}>
            <NativeSelectOption value="">{t('every_project')}</NativeSelectOption>
            {seen.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {decideChip}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setState('');
              setKind('');
              setProject('');
            }}
          >
            {t('clear_filters')}
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{entries.length === 0 && rows.length === 0 ? t('nothing_read') : t('no_component_matches')}</EmptyTitle>
            {entries.length === 0 && rows.length === 0 && <EmptyDescription>{t('nothing_read_body')}</EmptyDescription>}
          </EmptyHeader>
        </Empty>
      ) : (
        <Table data-registry-table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_component')}</TableHead>
              <TableHead>{t('col_state')}</TableHead>
              <TableHead>{t('col_projects')}</TableHead>
              <TableHead>{t('col_declared_at')}</TableHead>
              {withCatalogue && <TableHead>{t('col_release')}</TableHead>}
              {withCatalogue && <TableHead className={styles.num}>{t('col_downloads')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <React.Fragment key={r.key}>
                <TableRow
                  className={styles.openRow}
                  aria-expanded={open === r.key}
                  onClick={() => setOpen(open === r.key ? null : r.key)}
                  data-registry-row={r.name}
                >
                  <TableCell className={styles.lead}>
                    <span className={styles.name}>{r.name}</span> <span className={styles.sub}>{r.kind}</span>
                    {r.entry && isDuplicated(r.entry) && (
                      <Badge variant="warning" title={t('declared_many_title')}>
                        ×{new Set(r.entry.occurrences.map((o) => o.repo)).size} {t('repos')}
                      </Badge>
                    )}
                    {r.entry && isOrphaned(r.entry) && (
                      <Badge variant="secondary" title={t('orphaned_title')}>
                        {t('orphaned')}
                      </Badge>
                    )}
                    {r.description && <div className={styles.purpose}>{r.description}</div>}
                  </TableCell>
                  <TableCell>
                    <StateCell row={r} />
                  </TableCell>
                  <TableCell>
                    {r.entry ? (
                      <>
                        {projectsOf(r.entry).join(', ') || '—'}
                        {consumersLabel(r.entry) && (
                          <div className={styles.sub} data-registry-used-by>
                            {consumersLabel(r.entry)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DeclaredAt row={r} />
                  </TableCell>
                  {withCatalogue && (
                    <TableCell>
                      {r.node && (r.node.value.max_stable_version ?? r.node.value.newest_version) ? (
                        <code className={styles.version}>{String(r.node.value.max_stable_version ?? r.node.value.newest_version)}</code>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </TableCell>
                  )}
                  {withCatalogue && (
                    <TableCell className={styles.num}>
                      {r.node?.value.downloads != null ? Number(r.node.value.downloads).toLocaleString('en-US') : <span className={styles.muted}>—</span>}
                    </TableCell>
                  )}
                </TableRow>
                {open === r.key && (
                  <TableRow data-registry-expanded={r.name}>
                    <TableCell colSpan={columns} className={styles.expanded}>
                      {r.entry ? (
                        <EntryDetail
                          entry={r.entry}
                          entries={entries}
                          people={people}
                          names={names}
                          onDecided={onDecided}
                          onOpenComponent={r.node ? () => onOpenComponent(nameOf(r.node!)) : undefined}
                          platformAdmin={platformAdmin}
                        />
                      ) : (
                        <div className={styles.sub}>
                          {t('published_no_project')}{' '}
                          {r.node && (
                            <Button variant="link" size="sm" onClick={() => onOpenComponent(nameOf(r.node!))}>
                              {t('open_page')} →
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function StateCell({ row: r }: { row: ComponentRow }) {
  const published = r.entry ? publishStatus(r.entry) : null;
  return (
    <span className={styles.chips}>
      <StatusChip tone={STATE_TONE[r.state] !== undefined ? toneOf(STATE_TONE[r.state]) : r.state === 'published' ? 'ok' : 'neutral'}>
        {STATE_LABEL[r.state] ?? r.state}
      </StatusChip>
      {published && (
        <StatusChip tone={published.kind === 'published' ? 'ok' : 'info'} data-registry-publish-status>
          {published.label}
        </StatusChip>
      )}
    </span>
  );
}

function DeclaredAt({ row: r }: { row: ComponentRow }) {
  const { t } = useScope();
  const first = r.entry?.occurrences[0];
  if (!first) {
    return r.node?.value.repository ? (
      <span className={styles.sub}>{String(r.node.value.repository).replace(/^https?:\/\//, '')}</span>
    ) : (
      <span className={styles.muted}>—</span>
    );
  }
  return (
    <span className={styles.sub}>
      <code>{first.path}</code> ({first.declared_in})
      {r.entry!.occurrences.length > 1 && ` ${t('and_more', { count: r.entry!.occurrences.length - 1 })}`}
    </span>
  );
}

/** Code that looks like a gear, strongest first, with why and what to do about it. */
function CandidatesView({
  entries,
  people,
  names,
  onDecided,
}: {
  entries: RegistryEntry[];
  people: Person[];
  names: Record<string, string>;
  onDecided: () => void;
}) {
  const { t } = useScope();
  const list = useMemo(() => candidatesOf(entries), [entries]);
  const [open, setOpen] = useState<string | null>(null);
  if (list.length === 0) {
    return (
      <p className={styles.sub} data-registry-candidates>
        {t('no_candidates')}
      </p>
    );
  }
  return (
    <div className={styles.stack} data-registry-candidates>
      <p className={styles.sub}>{t('candidates_hint')}</p>
      <ul className={styles.candidates}>
        {list.map((e) => (
          <li key={e.name} className={styles.candidate} data-registry-candidate={e.name}>
            <div className={styles.row}>
              <b>{e.name}</b>
              <Badge variant="info" title={t('score_title')}>
                {t('score', { score: e.score ?? 0 })}
              </Badge>
              <span className={styles.sub}>{candidateWhere(e)}</span>
            </div>
            {e.description && <div className={styles.sub}>{e.description}</div>}
            <ul className={styles.evidence}>
              {evidenceLines(e).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {open === e.name ? (
              <div>
                <DeclareCandidate entry={e} onDeclared={onDecided} />
                <RegistryDecisions entry={e} entries={entries} people={people} names={names} onDecided={onDecided} platformAdmin={false} />
              </div>
            ) : (
              <Button variant="link" size="sm" onClick={() => setOpen(e.name)}>
                {t('declare_register_reject')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
