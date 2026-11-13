/**
 * A tab the Studio domain model adds and no screen answers — the prototype's
 * `TypeObjectsTab` (`level-tabs-ui.tsx`): the objects of the type its `shows`
 * relation reaches, in this place (the workspace's or project's scope; the
 * whole organization on the organization), with the type's fields as
 * columns. A column header sorts; a row opens the object's card — its fields
 * and the relations the model declares for it, each read when asked for.
 * Read-only: the objects are written by whoever keeps them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import {
  DomainModelApiService,
  LIST_PAGE,
  domainChanged,
  listQuery,
  modelTabs,
  nextQuerySort,
  objectQuery,
  readableFields,
  relationsOfModel,
  responseStatus,
  shownValue,
  tableColumns,
  typeAbsence,
  useStudioEventRefresh,
  type DomainModel,
  type DomainQueryRow,
  type DomainRowSet,
  type ModelRelation,
  type QuerySortState,
  type TabLevel,
  type TypeAbsence,
} from '@constructor-studio/mfe-shared';
import { ErrorLine, Header, errText, useAdmin } from '../admin/common';
import { FieldRow } from './ObjectAttributes';
import styles from '../admin/Admin.module.css';
import own from './Model.module.css';

/** A failed read, told apart: refused, the type not in use here (ADR-0070 §4), or failed. */
interface Problem {
  forbidden: boolean;
  absent: TypeAbsence | null;
  text: string;
}

const problemOf = (e: unknown): Problem => ({
  forbidden: responseStatus(e) === 403,
  absent: typeAbsence(e),
  text: errText(e),
});

/** What names an object in a list: its name or title, else its id. */
export function objectLabel(row: DomainQueryRow): string {
  const v = row.value ?? {};
  for (const key of ['name', 'title', 'key']) {
    const s = v[key];
    if (typeof s === 'string' && s.trim()) return s;
  }
  return row.id;
}

export function TypeObjects({
  orgId,
  model,
  level,
  tabName,
  scope,
}: {
  orgId: string;
  model: DomainModel;
  level: TabLevel;
  tabName: string;
  /** The workspace or project whose objects these are; null for the whole organization. */
  scope: string | null;
}) {
  const { t } = useAdmin();
  const tab = modelTabs(model, level).find((m) => m.name === tabName) ?? null;
  const entity = tab ? model.byId.get(tab.target) ?? null : null;
  const type = entity?.id ?? null;
  const columns = type ? tableColumns(model, type) : [];
  const [sort, setSort] = useState<QuerySortState | null>(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<DomainRowSet | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [open, setOpen] = useState<DomainQueryRow | null>(null);
  // Read again when someone writes objects of the type.
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useStudioEventRefresh(domainChanged(type ? [type] : []), reload);

  useEffect(() => {
    if (!type) return undefined;
    let live = true;
    apiRegistry
      .getService(DomainModelApiService)
      .query(orgId)
      .fetch(listQuery({ type, scope, sort, offset }))
      .then(
        (res) => {
          if (!live) return;
          setProblem(null);
          setPage({ items: res.items ?? [], total: res.total ?? res.items?.length ?? 0, complete: res.complete !== false });
        },
        (e: unknown) => {
          if (!live) return;
          setProblem(problemOf(e));
          setPage({ items: [], total: 0, complete: true });
        }
      );
    return () => {
      live = false;
    };
  }, [orgId, type, scope, sort, offset, tick]);

  if (!tab) {
    return <p className={styles.muted} data-model-tab-gone>{t('model_tab_gone')}</p>;
  }
  if (!entity || !type) {
    return (
      <>
        <Header title={tab.label} />
        <p className={styles.muted} data-model-tab-unknown>
          {t('model_tab_unknown_type', { type: tab.target })}
        </p>
      </>
    );
  }
  if (open) {
    return <ObjectCard orgId={orgId} model={model} type={type} row={open} onBack={() => setOpen(null)} />;
  }

  const names = columns.length > 0 ? columns.map((c) => c.name) : ['id'];
  const total = page?.total ?? 0;
  const where = scope ? t(`model_in_${level}`) : t('model_in_organization');
  return (
    <>
      <Header
        title={tab.label}
        info={t('model_tab_about', { type: entity.name ?? type, where })}
        status={
          <Badge variant="outline">
            {page === null ? t('reading') : t('model_objects_count', { count: String(total) })}
          </Badge>
        }
      />
      {problem?.absent ? (
        // Not a failure: the type is not in use here. Said, and nothing offered.
        <p className={styles.muted} data-model-type-absent={problem.absent.reason}>
          {t(problem.absent.reason === 'dormant' ? 'model_type_dormant' : 'model_type_not_installed', {
            type: entity.name ?? type,
            kit: problem.absent.kit ?? '?',
          })}
        </p>
      ) : (
        problem && <ErrorLine>{problem.forbidden ? t('model_forbidden') : problem.text}</ErrorLine>
      )}
      {page && !page.complete && <p className={styles.muted}>{t('model_incomplete')}</p>}
      {page && page.items.length === 0 && !problem && (
        <p className={styles.muted} data-model-empty>
          {t('model_empty')}
        </p>
      )}
      {page && page.items.length > 0 && (
        <Card>
          <CardContent className={own.tableWrap}>
            <Table>
              <TableHeader>
                <TableRow>
                  {names.map((name) => {
                    const by = sort?.field === name ? sort.direction : null;
                    return (
                      <TableHead
                        key={name}
                        aria-sort={by === 'asc' ? 'ascending' : by === 'desc' ? 'descending' : 'none'}
                      >
                        <button
                          type="button"
                          className={own.sort}
                          title={t('model_sort_hint')}
                          onClick={() => {
                            setOffset(0);
                            setSort((s) => nextQuerySort(s, name));
                          }}
                        >
                          {name.replace(/_/g, ' ')}
                          {by === 'asc' ? ' ↑' : by === 'desc' ? ' ↓' : ''}
                        </button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((row) => (
                  <TableRow
                    key={row.id}
                    className={own.row}
                    tabIndex={0}
                    data-model-row={row.id}
                    onClick={() => setOpen(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpen(row);
                      }
                    }}
                  >
                    {names.map((name) => (
                      <TableCell key={name}>
                        {shownValue(name === 'id' ? row.id : row.value?.[name], t('model_yes'), t('model_no'))}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {total > LIST_PAGE && (
        <div className={styles.inline}>
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIST_PAGE))}>
            {t('model_previous')}
          </Button>
          <span className={styles.sub}>
            {t('model_page', {
              from: String(offset + 1),
              to: String(Math.min(offset + LIST_PAGE, total)),
              total: String(total),
            })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + LIST_PAGE >= total}
            onClick={() => setOffset((o) => o + LIST_PAGE)}
          >
            {t('model_next')}
          </Button>
        </div>
      )}
    </>
  );
}

/** One object: its fields as the model declares them, and its relations, each read when opened. */
export function ObjectCard({
  orgId,
  model,
  type,
  row,
  onBack,
}: {
  orgId: string;
  model: DomainModel;
  type: string;
  row: DomainQueryRow;
  onBack: () => void;
}) {
  const { t } = useAdmin();
  const fields = useMemo(() => readableFields(model, type), [model, type]);
  // A level's tabs are relations too, but they are about the screen, not the object.
  const relations = useMemo(() => relationsOfModel(model, type).filter((r) => r.kind !== 'shows'), [model, type]);
  const value = row.value ?? {};
  const filled = fields.filter((f) => value[f.name] !== undefined && value[f.name] !== null && value[f.name] !== '');
  const extra = Object.keys(value).filter((k) => !fields.some((f) => f.name === k) && k !== 'id');
  return (
    <>
      <Header
        title={objectLabel(row)}
        info={t('model_card_about', { type: model.byId.get(type)?.name ?? type })}
        status={<Badge variant="outline">{row.id}</Badge>}
        action={
          <Button size="sm" variant="outline" onClick={onBack} data-model-back>
            {t('model_back')}
          </Button>
        }
      />
      <Card>
        <CardContent className={own.card}>
          <strong>{t('model_card_fields')}</strong>
          {filled.length === 0 && extra.length === 0 ? (
            <p className={styles.muted}>{t('model_nothing_recorded')}</p>
          ) : (
            <dl className={own.grid}>
              {filled.map((f) => (
                <FieldRow key={f.name} field={f} value={value[f.name]} />
              ))}
              {/* Stored values the model no longer declares are still the object's. */}
              {extra.map((k) => (
                <FieldRow
                  key={k}
                  field={{ name: k, type: '', kind: { kind: 'unknown' }, required: false, description: '', declaredBy: '' }}
                  value={value[k]}
                  from={t('model_not_in_model')}
                />
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
      {relations.length > 0 && (
        <Card>
          <CardContent className={own.card}>
            <strong>{t('model_card_relations')}</strong>
            <ul className={own.relations}>
              {relations.map((r) => (
                <RelationRow key={r.name} orgId={orgId} model={model} type={type} id={row.id} relation={r} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function RelationRow({
  orgId,
  model,
  type,
  id,
  relation,
}: {
  orgId: string;
  model: DomainModel;
  type: string;
  id: string;
  relation: ModelRelation;
}) {
  const { t } = useAdmin();
  const [set, setSet] = useState<DomainRowSet | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await apiRegistry
        .getService(DomainModelApiService)
        .query(orgId)
        .fetch(objectQuery({ type, id, relation: relation.name }));
      setSet(res.items[0]?.relations?.[relation.name] ?? { items: [], total: 0, complete: true });
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-model-relation={relation.name}>
      <div className={styles.inline}>
        <span>{relation.label}</span>
        <span className={styles.sub}>→ {model.byId.get(relation.target)?.name ?? relation.target}</span>
        {set === null && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void read()}>
            {busy ? t('reading') : t('model_show_related')}
          </Button>
        )}
        {set !== null && <Badge variant="outline">{t('model_objects_count', { count: String(set.total) })}</Badge>}
      </div>
      {problem && <ErrorLine>{problem.forbidden ? t('model_forbidden') : problem.text}</ErrorLine>}
      {set !== null && set.items.length === 0 && <p className={styles.muted}>{t('model_none_related')}</p>}
      {set !== null && set.items.length > 0 && (
        <ul className={own.related}>
          {set.items.map((item) => (
            <li key={item.id}>
              <Badge variant="secondary" title={item.id}>
                {objectLabel(item)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
