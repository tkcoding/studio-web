/**
 * One saved view, rendered (the prototype's `ViewTable` and `ViewGraph` in
 * `studio-frontend-poc/src/views.tsx`): its query paged, sorted and searched
 * by the backend, or drawn as a graph of its objects and the related objects
 * it includes. The reader's search, sort and page are the shell's list state,
 * kept in the address under `view.` (`useListState`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gears-frontx/ui-kit';
import { domainChanged, responseStatus, useListState, useStudioEventRefresh } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import type { DomainModel } from '../../../model/domain-runtime';
import {
  PageCursors,
  cellText,
  fieldsOf,
  graphQuery,
  labelField,
  pageQuery,
  relationLabel,
  relationsOf,
  toGraph,
  type LooseRow,
  type ViewSpec,
} from '../../../model/views-model';
import { DomainModelGraph, type GraphSource } from '../domain-model/DomainModelGraph';
import { ErrorLine, errText, useAdmin } from '../common';
import styles from '../Admin.module.css';
import own from './Views.module.css';

/** Rows a page of a view shows. */
export const VIEW_PAGE_SIZE = 25;

/** The address prefix of a view's list state. */
export const VIEW_LIST_PREFIX = 'view.';

/** How long typing settles before the search is asked. */
const SEARCH_DELAY_MS = 250;

/** A failed read in the reader's words: a refusal says so instead of the gear's code. */
export function useReadFailure(): (e: unknown) => string {
  const { t } = useAdmin();
  return (e) => (responseStatus(e) === 403 ? t('vw_forbidden') : errText(e));
}

interface Page {
  rows: LooseRow[];
  total: number;
  notes: string[];
}

export function ViewTable({ orgId, model, spec }: { orgId: string; model: DomainModel; spec: ViewSpec }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const failure = useReadFailure();
  const [list, listCtl] = useListState(VIEW_LIST_PREFIX);
  const [term, setTerm] = useState(list.q);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The query (and revision) the page on screen answers; another one is being read. */
  const [answered, setAnswered] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const fields = fieldsOf(model, spec.type);
  const rels = relationsOf(model, spec.type);

  // Another view in the same table: its list starts fresh.
  const shownId = useRef(spec.id);
  useEffect(() => {
    if (shownId.current === spec.id) return;
    shownId.current = spec.id;
    listCtl.reset();
  }, [spec.id, listCtl]);

  // The box follows the address when something else changed it (Back, Clear,
  // another view); what was typed is asked once typing settles.
  const sent = useRef(list.q);
  useEffect(() => {
    if (list.q === sent.current) return;
    sent.current = list.q;
    setTerm(list.q);
  }, [list.q]);
  useEffect(() => {
    if (term === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = term;
      listCtl.setQ(term);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term, listCtl]);

  // The view's type and every type it includes: a change to any of them
  // re-reads the page, as does a change to the model its columns come from.
  const watched = useMemo(() => domainChanged([spec.type, ...Object.values(rels)], { model: true }), [spec.type, rels]);
  useStudioEventRefresh(watched, () => setRevision((n) => n + 1));

  // Cursors are kept per query (its type, filters and sort), so one set serves every view shown here.
  const [cursors] = useState(() => new PageCursors());
  const q = useMemo(
    () => pageQuery(model, spec, { q: list.q, sort: list.sort, offset: list.page * VIEW_PAGE_SIZE, limit: VIEW_PAGE_SIZE }),
    [model, spec, list.q, list.sort, list.page]
  );
  const asked = `${JSON.stringify(q)}#${revision}`;
  const loading = answered !== asked;
  useEffect(() => {
    let live = true;
    api
      .queryDomain(orgId)
      .fetch(cursors.place(q))
      .then(
        (res) => {
          if (!live) return;
          cursors.note(q, res.items.length, res.next_cursor);
          const notes = [...(res.warnings ?? [])];
          if (!res.complete) notes.push(t('vw_incomplete'));
          setPage({ rows: res.items, total: res.total, notes });
          setError(null);
          setAnswered(asked);
        },
        (e: unknown) => {
          if (!live) return;
          setError(failure(e));
          setAnswered(asked);
        }
      );
    return () => {
      live = false;
    };
    // `failure` and `t` are the language's, not the query's; `asked` is `q` and the revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, orgId, cursors, q, revision]);

  const label = labelField(model, spec.type);
  const relationCell = (row: LooseRow, name: string) => {
    const set = row.relations[name];
    if (!set || set.total === 0) return '—';
    const target = rels[name];
    const at = target ? labelField(model, target) : 'id';
    const shown = set.items.map((i) => cellText(i.value[at] ?? i.id)).join(', ');
    return set.total > set.items.length ? `${shown} +${set.total - set.items.length}` : shown;
  };
  const narrowed = list.q.trim() !== '';
  const pages = page ? Math.max(1, Math.ceil(page.total / VIEW_PAGE_SIZE)) : 1;
  const from = list.page * VIEW_PAGE_SIZE;

  return (
    <div className={styles.rows} data-view-table={spec.id}>
      <div className={styles.toolbar}>
        <Input
          type="search"
          className={styles.search}
          value={term}
          placeholder={t('vw_search', { type: spec.type })}
          aria-label={t('vw_search', { type: spec.type })}
          onChange={(e) => setTerm(e.target.value)}
        />
        {loading && page && <span className={styles.sub}>{t('reading')}</span>}
      </div>
      {page && page.notes.length > 0 && (
        // One line, the detail on request: the warnings are true and long, and
        // three paragraphs above a table bury the table.
        <details className={own.notes}>
          <summary>{t.count('vw_notes', page.notes.length)}</summary>
          <ul>
            {page.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {error ? (
        <div className={styles.inline}>
          <ErrorLine>{error}</ErrorLine>
          <Button size="sm" variant="outline" onClick={() => setRevision((n) => n + 1)}>
            {t('retry')}
          </Button>
        </div>
      ) : !page ? (
        <p className={styles.muted}>{t('vw_loading_rows')}</p>
      ) : page.rows.length === 0 ? (
        <div className={styles.inline}>
          <p className={styles.muted}>{narrowed ? t('vw_no_match') : t('vw_empty', { type: spec.type })}</p>
          {narrowed && (
            <Button size="sm" variant="outline" onClick={() => listCtl.clearFilters()}>
              {t('vw_clear_search')}
            </Button>
          )}
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {spec.columns.map((f) => {
                  const on = list.sort?.key === f ? list.sort.dir : null;
                  return (
                    <TableHead
                      key={f}
                      className={fields[f]?.kind === 'number' ? own.num : undefined}
                      aria-sort={on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : undefined}
                    >
                      <button type="button" className={own.sort} onClick={() => listCtl.toggleSort(f)}>
                        {f}
                        {on === 'asc' ? ' ↑' : on === 'desc' ? ' ↓' : ''}
                      </button>
                    </TableHead>
                  );
                })}
                {spec.relations.map((name) => (
                  <TableHead key={`rel:${name}`}>{relationLabel(name, rels[name])}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row) => (
                <TableRow key={row.id} data-view-row={row.id} title={cellText(row.value[label] ?? row.id)}>
                  {spec.columns.map((f) => (
                    <TableCell key={f} className={fields[f]?.kind === 'number' ? own.num : undefined}>
                      {cellText(f === 'id' ? (row.value.id ?? row.id) : row.value[f])}
                    </TableCell>
                  ))}
                  {spec.relations.map((name) => (
                    <TableCell key={`rel:${name}`}>{relationCell(row, name)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className={own.pager}>
            <span>
              {t('vw_range', {
                from: (from + 1).toLocaleString(language),
                to: (from + page.rows.length).toLocaleString(language),
                total: page.total.toLocaleString(language),
              })}
            </span>
            {pages > 1 && (
              <>
                <Button size="sm" variant="ghost" disabled={list.page === 0} onClick={() => listCtl.setPage(list.page - 1)}>
                  {t('vw_previous')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={list.page >= pages - 1}
                  onClick={() => listCtl.setPage(list.page + 1)}
                >
                  {t('vw_next')}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One view as a graph: its objects and the related objects it includes, with
 *  the relations between them. The same canvas the model graph uses. */
export function ViewGraph({ orgId, model, spec }: { orgId: string; model: DomainModel; spec: ViewSpec }) {
  const api = apiRegistry.getService(AdminApiService);
  const source = useMemo<GraphSource>(
    () => ({
      key: JSON.stringify(spec),
      load: async () => toGraph(model, spec, await api.queryDomain(orgId).fetch(graphQuery(model, spec))),
    }),
    [api, orgId, model, spec]
  );
  return <DomainModelGraph key={source.key} orgId={orgId} source={source} />;
}
