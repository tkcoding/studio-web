/**
 * The view editor (the prototype's `ViewEditor` in
 * `studio-frontend-poc/src/views.tsx`): type, columns, conditions, related
 * objects, order and how it is shown. The types, fields and relations are the
 * organization's model as it is now, so a field added in Studio domain model
 * can be a column at once. Preview runs the view's real query.
 *
 * A refused save keeps the dialog and everything typed in it, with the
 * gear's words for the refusal.
 */

import { useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { AdminApiService } from '../../../api/AdminApiService';
import type { DomainModel } from '../../../model/domain-runtime';
import {
  VIEW_OPS,
  blankView,
  cellText,
  fieldsOf,
  labelField,
  needsValue,
  problems,
  relationLabel,
  relationsOf,
  toQuery,
  viewableTypes,
  type LooseResult,
  type ViewCondition,
  type ViewKind,
  type ViewOp,
  type ViewSpec,
} from '../../../model/views-model';
import { ErrorLine, useAdmin } from '../common';
import { useReadFailure } from './ViewTable';
import styles from '../Admin.module.css';
import own from './Views.module.css';

/** How many objects a preview shows. */
export const PREVIEW_LIMIT = 10;

const toggle = (list: string[], item: string) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

export function ViewEditor({
  orgId,
  model,
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  orgId: string;
  model: DomainModel;
  initial: ViewSpec;
  busy: boolean;
  error: string | null;
  onSave: (spec: ViewSpec) => void;
  onCancel: () => void;
}) {
  const { t, container } = useAdmin();
  const [spec, setSpec] = useState<ViewSpec>(initial);
  const fields = fieldsOf(model, spec.type);
  const fieldNames = useMemo(() => Object.keys(fields).sort(), [fields]);
  const rels = relationsOf(model, spec.type);
  const types = useMemo(() => viewableTypes(model), [model]);
  const issues = problems(model, spec);
  // A preview needs a query the gear accepts; a name it does not.
  const previewable = issues.every((p) => p.key === 'vw_problem_name');
  const title = initial.name ? t('vw_edit_named', { name: initial.name }) : t('vw_new');

  const setCondition = (i: number, patch: Partial<ViewCondition>) =>
    setSpec((s) => ({ ...s, conditions: s.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent container={container} closeLabel={t('close')} data-view-editor>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className={own.body}>
          <label className={styles.field}>
            {t('vw_name')}
            <Input
              value={spec.name}
              onChange={(e) => setSpec({ ...spec, name: e.target.value })}
              placeholder={t('vw_name_placeholder')}
              data-view-name
            />
          </label>

          <label className={styles.field}>
            {t('vw_type')}
            <NativeSelect
              value={spec.type}
              onChange={(e) => {
                // Fields and relations belong to a type; another type starts over.
                setSpec({ ...blankView(model, e.target.value, spec.id), name: spec.name });
              }}
              data-view-type
            >
              {types.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {type}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <fieldset className={own.group} data-view-columns>
            <legend className={own.legend}>{t('vw_columns')}</legend>
            <div className={own.grid}>
              {fieldNames.map((f) => (
                <label key={f} className={own.pick}>
                  <input
                    type="checkbox"
                    checked={spec.columns.includes(f)}
                    onChange={() => setSpec({ ...spec, columns: toggle(spec.columns, f) })}
                  />
                  {f}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={own.group} data-view-conditions>
            <legend className={own.legend}>{t('vw_conditions')}</legend>
            {spec.conditions.map((c, i) => {
              const kind = fields[c.field];
              return (
                <div key={i} className={own.row} data-view-condition={i}>
                  <NativeSelect
                    value={c.field}
                    aria-label={t('vw_condition_field')}
                    onChange={(e) => setCondition(i, { field: e.target.value, value: '' })}
                  >
                    {fieldNames.map((f) => (
                      <NativeSelectOption key={f} value={f}>
                        {f}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    value={c.op}
                    aria-label={t('vw_condition_op')}
                    onChange={(e) => setCondition(i, { op: e.target.value as ViewOp })}
                  >
                    {VIEW_OPS.map((op) => (
                      <NativeSelectOption key={op} value={op}>
                        {t(`vw_op${op}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {needsValue(c.op) &&
                    (kind?.kind === 'enum' || kind?.kind === 'boolean' ? (
                      <NativeSelect
                        value={c.value}
                        aria-label={t('vw_condition_value')}
                        onChange={(e) => setCondition(i, { value: e.target.value })}
                      >
                        <NativeSelectOption value="">—</NativeSelectOption>
                        {(kind.kind === 'enum' ? kind.values : ['true', 'false']).map((v) => (
                          <NativeSelectOption key={v} value={v}>
                            {v}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Input
                        value={c.value}
                        aria-label={t('vw_condition_value')}
                        onChange={(e) => setCondition(i, { value: e.target.value })}
                        placeholder={kind?.kind === 'number' ? t('vw_a_number') : t('vw_a_value')}
                      />
                    ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('vw_remove_condition')}
                    onClick={() => setSpec({ ...spec, conditions: spec.conditions.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </Button>
                </div>
              );
            })}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSpec({
                    ...spec,
                    conditions: [...spec.conditions, { field: labelField(model, spec.type), op: '_contains', value: '' }],
                  })
                }
                data-view-add-condition
              >
                {t('vw_add_condition')}
              </Button>
            </div>
          </fieldset>

          {Object.keys(rels).length > 0 && (
            <fieldset className={own.group} data-view-relations>
              <legend className={own.legend}>{t('vw_relations')}</legend>
              <div className={`${own.grid} ${own.wide}`}>
                {Object.entries(rels)
                  // Its own relations first, then those pointing at it.
                  .sort(([a], [b]) => Number(a.startsWith('~')) - Number(b.startsWith('~')) || a.localeCompare(b))
                  .map(([name, target]) => (
                    <label key={name} className={own.pick}>
                      <input
                        type="checkbox"
                        checked={spec.relations.includes(name)}
                        onChange={() => setSpec({ ...spec, relations: toggle(spec.relations, name) })}
                      />
                      {relationLabel(name, target)}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}

          <div className={own.row}>
            <label className={own.row}>
              {t('vw_order_by')}
              <NativeSelect
                value={spec.sort?.field ?? ''}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    sort: e.target.value ? { field: e.target.value, direction: spec.sort?.direction ?? 'asc' } : null,
                  })
                }
                data-view-sort
              >
                <NativeSelectOption value="">id</NativeSelectOption>
                {fieldNames.map((f) => (
                  <NativeSelectOption key={f} value={f}>
                    {f}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {spec.sort && (
              <NativeSelect
                value={spec.sort.direction}
                aria-label={t('vw_direction')}
                onChange={(e) =>
                  setSpec({ ...spec, sort: { field: spec.sort!.field, direction: e.target.value as 'asc' | 'desc' } })
                }
              >
                <NativeSelectOption value="asc">{t('vw_ascending')}</NativeSelectOption>
                <NativeSelectOption value="desc">{t('vw_descending')}</NativeSelectOption>
              </NativeSelect>
            )}
          </div>

          <label className={own.row}>
            {t('vw_show_as')}
            <NativeSelect
              value={spec.kind}
              onChange={(e) => setSpec({ ...spec, kind: e.target.value as ViewKind })}
              data-view-kind
            >
              <NativeSelectOption value="table">{t('vw_kind_table')}</NativeSelectOption>
              <NativeSelectOption value="graph">{t('vw_kind_graph')}</NativeSelectOption>
            </NativeSelect>
          </label>

          {issues.length > 0 && (
            <ul className={own.problems} data-view-problems>
              {issues.map((p, i) => (
                <li key={`${p.key}:${i}`}>{t(p.key, p.params)}</li>
              ))}
            </ul>
          )}

          <Preview orgId={orgId} model={model} spec={spec} enabled={previewable} />
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button disabled={busy || issues.length > 0} onClick={() => onSave(spec)} data-view-save>
            {busy ? t('saving') : t('vw_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PreviewState =
  | { at: 'idle' }
  | { at: 'reading' }
  | { at: 'read'; res: LooseResult }
  | { at: 'failed'; message: string };

/** The view's first objects, as its own query answers them now. */
function Preview({ orgId, model, spec, enabled }: { orgId: string; model: DomainModel; spec: ViewSpec; enabled: boolean }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const failure = useReadFailure();
  const query = useMemo(() => JSON.stringify(toQuery(model, spec)), [model, spec]);
  // A preview answers the query it ran; another query makes it old.
  const [ran, setRan] = useState<{ query: string; state: PreviewState }>({ query, state: { at: 'idle' } });
  const state: PreviewState = ran.query === query ? ran.state : { at: 'idle' };

  const run = () => {
    const asked = query;
    const answer = (next: PreviewState) => setRan((r) => (r.query === asked ? { query: asked, state: next } : r));
    setRan({ query: asked, state: { at: 'reading' } });
    api
      .queryDomain(orgId)
      .fetch({ ...toQuery(model, spec), limit: PREVIEW_LIMIT })
      .then(
        (res) => answer({ at: 'read', res }),
        (e: unknown) => answer({ at: 'failed', message: failure(e) })
      );
  };

  const rels = relationsOf(model, spec.type);
  return (
    <section className={own.group} data-view-preview={state.at}>
      <div className={own.head}>
        <span className={own.legend}>{t('vw_preview')}</span>
        <Button size="sm" variant="outline" disabled={!enabled || state.at === 'reading'} onClick={run} data-view-run-preview>
          {state.at === 'reading' ? t('reading') : t('vw_run_preview')}
        </Button>
      </div>
      {state.at === 'idle' && <p className={styles.sub}>{t('vw_preview_hint')}</p>}
      {state.at === 'failed' && <ErrorLine>{state.message}</ErrorLine>}
      {state.at === 'read' &&
        (state.res.items.length === 0 ? (
          <p className={styles.muted}>{t('vw_preview_empty', { type: spec.type })}</p>
        ) : (
          <>
            <p className={styles.sub}>
              {t('vw_preview_count', {
                shown: state.res.items.length.toLocaleString(language),
                total: state.res.total.toLocaleString(language),
              })}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  {spec.columns.map((f) => (
                    <TableHead key={f}>{f}</TableHead>
                  ))}
                  {spec.relations.map((r) => (
                    <TableHead key={r}>{relationLabel(r, rels[r])}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.res.items.map((row) => (
                  <TableRow key={row.id}>
                    {spec.columns.map((f) => (
                      <TableCell key={f}>{cellText(f === 'id' ? (row.value.id ?? row.id) : row.value[f])}</TableCell>
                    ))}
                    {spec.relations.map((r) => {
                      const target = rels[r];
                      const at = target ? labelField(model, target) : 'id';
                      const items = row.relations[r]?.items ?? [];
                      return (
                        <TableCell key={r}>
                          {items.length ? items.map((i) => cellText(i.value[at] ?? i.id)).join(', ') : '—'}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ))}
    </section>
  );
}
