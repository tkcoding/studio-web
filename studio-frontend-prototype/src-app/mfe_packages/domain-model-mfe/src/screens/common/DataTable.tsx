/**
 * The prototype's one list component (data-table.tsx), for the whole lists
 * this tab draws: search, filter chips or a select with their counts,
 * sorting headers, a pager, a ▸ that expands a row, row click (open) and
 * hover (peek), and the row's actions. Search, filters and sort run through
 * the prototype's `applyClient`, and the list's search, filters, sort and page
 * are kept in the address under `urlPrefix` (`useListState`, both shared from
 * mfe-shared's `lists/listState.ts`): a reload, a shared link or Back puts the
 * list back as it was.
 *
 * Not carried: the tiles view, the page size as a preference, and
 * server-paged lists (`load`) — the tab never used them.
 */

import React, { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { applyClient, useListState } from '@constructor-studio/mfe-shared';
import { useCommonTranslations } from '../../i18n';
import { EmptyState } from './ui';
import styles from './common.module.css';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sorts with this comparator (ascending). */
  compare?: (a: T, b: T) => number;
  /** A number: right-aligned, tabular, as narrow as it can be. */
  num?: boolean;
}

export interface Filter<T> {
  id: string;
  /** The "all" choice's label: "Every state". */
  allLabel: string;
  options: { value: string; label: string }[];
  /** Chips when there are a few options, a select when there are many. */
  kind?: 'chips' | 'select';
  match: (row: T, value: string) => boolean;
}

export interface RowAction {
  label: string;
  onSelect: () => unknown;
  disabled?: boolean;
}

export interface DataTableProps<T> {
  /** The prototype's list name: the address prefix when `urlPrefix` is absent. */
  list?: string;
  /** Where this list's state sits in the address (`ent.` → `?ent.q=`); one per list on a screen. */
  urlPrefix?: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** The row's name, for its actions' labels. */
  rowLabel: (row: T) => string;
  onOpen?: (row: T) => void;
  /** The row the pointer is on, `null` once it leaves. */
  onPeek?: (row: T | null) => void;
  actions?: (row: T) => RowAction[];
  /** Details a ▸ toggle expands under the row. */
  expand?: (row: T) => ReactNode;
  /** The row itself is the toggle too. */
  expandOnClick?: boolean;
  search?: { placeholder: string };
  searchText?: (row: T) => readonly (string | null | undefined)[];
  filters?: Filter<T>[];
  title?: ReactNode;
  primary?: ReactNode;
  extra?: ReactNode;
  empty: { title: string; body?: ReactNode; action?: ReactNode };
  pageSize?: number;
}

export function DataTable<T>({
  list,
  urlPrefix,
  rows,
  columns,
  rowKey,
  rowLabel,
  onOpen,
  onPeek,
  actions,
  expand,
  expandOnClick,
  search,
  searchText,
  filters = [],
  title,
  primary,
  extra,
  empty,
  pageSize = 20,
}: DataTableProps<T>) {
  const { t } = useCommonTranslations();
  const [state, listCtl] = useListState(urlPrefix ?? `${list ?? 'list'}.`);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const comparators = useMemo(
    () => Object.fromEntries(columns.filter((c) => c.compare).map((c) => [c.id, c.compare!])),
    [columns]
  );
  const { matched, counts } = useMemo(
    () => applyClient(rows, state, { searchText, filters, comparators }),
    [rows, state, searchText, filters, comparators]
  );
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(state.page, pages - 1);
  const shown = matched.slice(page * pageSize, (page + 1) * pageSize);
  const narrowed = state.q.trim() !== '' || Object.keys(state.filters).length > 0;

  const setFilter = listCtl.setFilter;
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const width = columns.length + (expand ? 1 : 0) + (actions ? 1 : 0);

  return (
    <div className={styles.dt}>
      {(search || filters.length > 0 || title || primary || extra) && (
        <div className={styles.dtBar}>
          {title && <b>{title}</b>}
          {search && (
            <Input
              type="search"
              className={styles.dtSearch}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              value={state.q}
              onChange={(e) => listCtl.setQ(e.target.value)}
            />
          )}
          {filters.map((f) =>
            f.kind === 'select' ? (
              <NativeSelect
                key={f.id}
                aria-label={f.allLabel}
                value={state.filters[f.id] ?? ''}
                onChange={(e) => setFilter(f.id, e.target.value || null)}
              >
                <NativeSelectOption value="">{f.allLabel}</NativeSelectOption>
                {f.options.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label} ({counts[f.id]?.[o.value] ?? 0})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <span key={f.id} className={styles.dtChips} role="group" aria-label={f.allLabel}>
                <Button
                  type="button"
                  size="sm"
                  variant={state.filters[f.id] ? 'ghost' : 'secondary'}
                  aria-pressed={!state.filters[f.id]}
                  onClick={() => setFilter(f.id, null)}
                >
                  {f.allLabel}
                </Button>
                {f.options.map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    size="sm"
                    variant={state.filters[f.id] === o.value ? 'secondary' : 'ghost'}
                    aria-pressed={state.filters[f.id] === o.value}
                    onClick={() => setFilter(f.id, state.filters[f.id] === o.value ? null : o.value)}
                  >
                    {o.label} <span className={styles.count}>{counts[f.id]?.[o.value] ?? 0}</span>
                  </Button>
                ))}
              </span>
            )
          )}
          {extra}
          {primary && <span style={{ marginLeft: 'auto' }}>{primary}</span>}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={empty.title} body={empty.body} action={empty.action} />
      ) : matched.length === 0 ? (
        <EmptyState
          title={t('nothing_matches')}
          action={
            narrowed ? (
              <Button type="button" size="sm" variant="outline" onClick={listCtl.clearFilters}>
                {t('clear_filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table onMouseLeave={onPeek ? () => onPeek(null) : undefined}>
            <TableHeader>
              <TableRow>
                {expand && <TableHead aria-hidden />}
                {columns.map((c) => (
                  <TableHead key={c.id} className={c.num ? styles.dtNum : undefined}>
                    {c.compare ? (
                      <button
                        type="button"
                        className={styles.dtSort}
                        onClick={() => listCtl.toggleSort(c.id)}
                        aria-sort={
                          state.sort?.key === c.id ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                        }
                      >
                        {c.header}
                        {state.sort?.key === c.id ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                ))}
                {actions && <TableHead aria-hidden />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => {
                const key = rowKey(row);
                const isOpen = open.has(key);
                const click = onOpen ? () => onOpen(row) : expand && expandOnClick ? () => toggle(key) : undefined;
                return (
                  <Fragment key={key}>
                    <TableRow
                      className={click ? styles.dtRowOpen : undefined}
                      onClick={click}
                      onMouseEnter={onPeek ? () => onPeek(row) : undefined}
                      tabIndex={click ? 0 : undefined}
                      onKeyDown={
                        click
                          ? (e: React.KeyboardEvent) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                click();
                              }
                            }
                          : undefined
                      }
                      data-row-key={key}
                    >
                      {expand && (
                        <TableCell>
                          <button
                            type="button"
                            className={styles.dtExpand}
                            aria-expanded={isOpen}
                            aria-label={t(isOpen ? 'collapse' : 'expand', { name: rowLabel(row) })}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(key);
                            }}
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </TableCell>
                      )}
                      {columns.map((c) => (
                        <TableCell key={c.id} className={c.num ? styles.dtNum : undefined}>
                          {c.cell(row)}
                        </TableCell>
                      ))}
                      {actions && (
                        <TableCell className={styles.dtNum}>
                          {actions(row).map((a) => (
                            <Button
                              key={a.label}
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={a.disabled}
                              aria-label={`${a.label}: ${rowLabel(row)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void a.onSelect();
                              }}
                            >
                              {a.label}
                            </Button>
                          ))}
                        </TableCell>
                      )}
                    </TableRow>
                    {expand && isOpen && (
                      <TableRow>
                        <TableCell colSpan={width} className={styles.dtDetail}>
                          {expand(row)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className={styles.dtPager}>
              <span>{t('page_of', { from: page * pageSize + 1, to: page * pageSize + shown.length, total: matched.length })}</span>
              <Button type="button" size="sm" variant="ghost" disabled={page === 0} onClick={() => listCtl.setPage(page - 1)}>
                {t('previous')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={page >= pages - 1}
                onClick={() => listCtl.setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
