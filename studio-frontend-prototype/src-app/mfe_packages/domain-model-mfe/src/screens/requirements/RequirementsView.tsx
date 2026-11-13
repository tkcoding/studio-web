/**
 * Project domain model › Requirements (the prototype's `RequirementsView` in
 * domain-model-screens.tsx): every requirement the documents define, by type,
 * and the one picked followed from the passage that states it, through the
 * documents and work that name it, to the code and tests that name it.
 */

import { useMemo, useState } from 'react';
import { Button } from '@gears-frontx/ui-kit';
import { blockItems, traceChain } from '../../model/domain-model-views';
import {
  classify,
  REQUIREMENT_TYPE_LABEL,
  REQUIREMENT_TYPE_NOUN,
  REQUIREMENT_TYPE_WHAT,
  requirementProblems,
  tallyTypes,
  type RequirementType,
} from '../../model/requirement-types';
import {
  BASIS_LABEL,
  BASIS_ORDER,
  workLabel,
  workState,
  type RequirementTraces,
  type SpecRequirement,
  type SpecRequirements,
  type WorkItem,
  type WorkLinks,
} from '../../model/spec-model';
import { useRequirementsTranslations } from '../../i18n';
import { DataTable } from '../common/DataTable';
import { SideLink, type OpenFile } from '../common/facts';
import { ErrorLine, InfoPopover, Loading, StatusChip } from '../common/ui';
import common from '../common/common.module.css';
import styles from './requirements.module.css';

type Text = ReturnType<typeof useRequirementsTranslations>['t'];

export function RequirementsView({
  read,
  traces,
  work,
  selected,
  onSelect,
  onOpenFile,
}: {
  read: SpecRequirements | { error: string } | null;
  traces: RequirementTraces | { error: string } | null;
  work: WorkLinks | { error: string } | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenFile: OpenFile;
}) {
  const { t } = useRequirementsTranslations();
  // Requirements by type by default; the parts of the design that carry them
  // are a list of their own, not rows of "no basis stated".
  const [type, setType] = useState<RequirementType | 'all' | 'design'>('all');
  const classes = useMemo(
    () => new Map(read && 'items' in read ? read.items.map((r) => [r.id, classify(r)]) : []),
    [read]
  );
  const tally = useMemo(() => (read && 'items' in read ? tallyTypes(read.items) : null), [read]);
  const problems = useMemo(() => (read && 'items' in read ? requirementProblems(read.items) : []), [read]);
  const traceById = useMemo(
    () => new Map(traces && 'items' in traces ? traces.items.map((tr) => [tr.id, tr]) : []),
    [traces]
  );
  const workById = useMemo(() => new Map(work && 'items' in work ? work.items.map((w) => [w.id, w.work]) : []), [work]);
  if (!read) return <Loading>{t('loading')}</Loading>;
  if ('error' in read) return <ErrorLine>{read.error}</ErrorLine>;
  const pool = read.items.filter((r) => {
    const c = classes.get(r.id) ?? null;
    if (type === 'design') return c === null;
    if (!c) return false;
    return type === 'all' || c.type === type;
  });
  const byBasis = (b: string) => pool.filter((r) => r.basis === b).length;
  const shownType = type !== 'all' && type !== 'design' ? tally?.types.find((x) => x.type === type) : undefined;
  const sel = read.items.find((r) => r.id === selected) ?? null;
  const tracesKnown = !!traces && 'items' in traces;
  const codeOf = (id: string) => traceById.get(id)?.code.length ?? 0;
  const testsOf = (id: string) => traceById.get(id)?.tests.length ?? 0;
  const severity = (s: string) => (s === 'missing' ? t('missing') : s === 'few' ? t('too_few') : t('no_basis'));

  return (
    <>
      <p className={common.hint}>
        <b>{t('howto')}</b> <InfoPopover label={t('how_to_read')}>{t('howto_more')}</InfoPopover>
      </p>
      {problems.length > 0 && (
        <details className={common.card} aria-label={t('problems_label')} data-requirement-problems>
          <summary>
            <b>
              {t.count('problems', problems.length, {
                missing: problems.filter((p) => p.severity === 'missing').length,
                few: problems.filter((p) => p.severity === 'few').length,
                ungrounded: problems.filter((p) => p.severity === 'ungrounded').length,
              })}
            </b>
          </summary>
          {problems.map((p) => (
            <div key={`${p.severity}:${p.type}`} className={styles.problem}>
              <StatusChip tone={p.severity === 'missing' ? 'danger' : 'warn'}>{severity(p.severity)}</StatusChip>
              <div>
                <b>{p.title}.</b> <span className={common.hint}>{p.why}</span>
                <div className={common.small}>
                  {t('write_them_in')}{' '}
                  {p.where.path && onOpenFile ? (
                    <button type="button" className={common.link} onClick={() => onOpenFile(p.where.path!)}>
                      {p.where.path}
                    </button>
                  ) : (
                    <span>{t('the_prd')}</span>
                  )}
                  , {p.where.section}, {t('each_under_id')}
                </div>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setType(p.type)}>
                {t('show_type', { what: REQUIREMENT_TYPE_NOUN[p.type] })}
              </Button>
            </div>
          ))}
        </details>
      )}
      {tally && (
        <div className={styles.types} role="group" aria-label={t('by_type')}>
          <button
            type="button"
            className={`${styles.type} ${type === 'all' ? styles.on : ''}`}
            aria-pressed={type === 'all'}
            onClick={() => setType('all')}
          >
            <b>{tally.types.reduce((n, x) => n + x.n, 0)}</b>
            <span>{t('all_requirements')}</span>
          </button>
          {tally.types.map((x) => (
            <button
              key={x.type}
              type="button"
              className={`${styles.type} ${type === x.type ? styles.on : ''} ${x.n === 0 ? styles.gap : ''}`}
              aria-pressed={type === x.type}
              title={`${REQUIREMENT_TYPE_LABEL[x.type]}: ${REQUIREMENT_TYPE_WHAT[x.type]}`}
              onClick={() => setType(type === x.type ? 'all' : x.type)}
            >
              <b>{x.n}</b>
              <span>{REQUIREMENT_TYPE_LABEL[x.type]}</span>
              {x.n > 0 ? (
                <i className={styles.bar} title={t('grounded', { grounded: x.grounded, n: x.n })}>
                  <i style={{ width: `${(x.grounded / x.n) * 100}%` }} />
                </i>
              ) : (
                <small>{t('none_written')}</small>
              )}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.type} ${type === 'design' ? styles.on : ''}`}
            aria-pressed={type === 'design'}
            onClick={() => setType(type === 'design' ? 'all' : 'design')}
          >
            <b>{tally.design}</b>
            <span>{t('design_elements')}</span>
            <small>{t('what_carries_them')}</small>
          </button>
        </div>
      )}
      {shownType && shownType.n === 0 && (
        <p className={common.hint} data-requirement-gap>
          <b>{t('none_of_type', { what: REQUIREMENT_TYPE_NOUN[shownType.type] })}</b>{' '}
          {t('they_say', { what: REQUIREMENT_TYPE_WHAT[shownType.type] })}
        </p>
      )}
      <div className={styles.split}>
        <div className={common.card}>
          <DataTable<SpecRequirement>
            list="dm-reqs"
            urlPrefix="req."
            rows={pool}
            rowKey={(r) => r.id}
            rowLabel={(r) => r.title ?? r.id}
            pageSize={20}
            onOpen={(r) => onSelect(r.id)}
            search={{ placeholder: t('search') }}
            searchText={(r) => [r.id, r.title, r.text]}
            filters={[
              {
                id: 'basis',
                allLabel: t('any_basis'),
                kind: 'chips',
                options: BASIS_ORDER.filter((b) => byBasis(b) > 0).map((b) => ({ value: b, label: BASIS_LABEL[b] })),
                match: (r, v) => r.basis === v,
              },
              ...(type !== 'design'
                ? [
                    {
                      id: 'level',
                      allLabel: t('any_level'),
                      kind: 'select' as const,
                      options: (['business', 'user', 'system'] as const).map((l) => ({ value: l, label: t(`level_${l}`) })),
                      match: (r: SpecRequirement, v: string) => classes.get(r.id)?.level === v,
                    },
                    {
                      id: 'nature',
                      allLabel: t('any_nature'),
                      kind: 'select' as const,
                      options: [
                        { value: 'functional', label: t('functional') },
                        { value: 'nonfunctional', label: t('nonfunctional') },
                      ],
                      match: (r: SpecRequirement, v: string) => classes.get(r.id)?.nature === v,
                    },
                  ]
                : []),
            ]}
            empty={{ title: t('nothing_matches') }}
            columns={[
              {
                id: 'title',
                header: t('col_requirement'),
                compare: (a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id),
                cell: (r) => (
                  <span className={r.id === selected ? styles.selected : undefined}>
                    <b>{r.title ?? r.id}</b>
                    <div>
                      <code className={common.hint}>{r.id}</code>
                    </div>
                  </span>
                ),
              },
              {
                id: 'type',
                header: t('col_type'),
                cell: (r) => {
                  const c = classes.get(r.id);
                  return c ? (
                    <span className={common.sev} title={r.kind ?? undefined}>
                      {REQUIREMENT_TYPE_LABEL[c.type]}
                    </span>
                  ) : (
                    r.kind && <span className={common.sev}>{r.kind}</span>
                  );
                },
              },
              { id: 'basis', header: t('col_basis'), cell: (r) => <span className={common.sev}>{BASIS_LABEL[r.basis]}</span> },
              {
                id: 'priority',
                header: t('col_priority'),
                compare: (a, b) => (a.priority ?? 'z').localeCompare(b.priority ?? 'z'),
                cell: (r) => r.priority ?? <span className={common.muted}>—</span>,
              },
              {
                id: 'reach',
                header: t('col_named_in'),
                cell: (r) => (
                  <span className={styles.marks}>
                    <Mark t={t} n={codeOf(r.id)} what="code" known={tracesKnown} />
                    <Mark t={t} n={(workById.get(r.id) ?? []).length || r.work} what="work" known />
                    <Mark t={t} n={testsOf(r.id)} what="tests" known={tracesKnown} />
                  </span>
                ),
              },
            ]}
          />
        </div>
        <aside className={common.card} aria-label={t('chain_label')} data-requirement-chain>
          {sel ? (
            <Chain r={sel} traces={traces} work={workById.get(sel.id) ?? []} onSelect={onSelect} onOpenFile={onOpenFile} />
          ) : (
            <>
              <b>{t('trace_title')}</b>
              <p className={common.hint}>{t('trace_body')}</p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function Mark({ t, n, what, known }: { t: Text; n: number; what: 'code' | 'work' | 'tests'; known: boolean }) {
  const label = t(`mark_${what}`);
  return (
    <span
      className={`${styles.mark} ${n ? styles.markOn : ''}`}
      title={!known ? t('mark_unread', { what: label }) : n ? `${n} ${label}` : t('mark_none', { what: label })}
    >
      {n ? '✓' : '–'} {label}
    </span>
  );
}

function Block({ text, onSelect }: { text: string; onSelect: (id: string) => void }) {
  const { t } = useRequirementsTranslations();
  const items = blockItems(text);
  const tokens = (item: ReturnType<typeof blockItems>[number]) =>
    item.map((tok, i) => {
      switch (tok.t) {
        case 'done':
          return (
            <StatusChip key={i} tone="ok">
              {t('done')}
            </StatusChip>
          );
        case 'todo':
          return (
            <StatusChip key={i} tone="warn">
              {t('to_do')}
            </StatusChip>
          );
        case 'priority':
          return (
            <span key={i} className={common.sev}>
              {tok.v}
            </span>
          );
        case 'id':
          return (
            <button key={i} type="button" className={styles.idchip} onClick={() => onSelect(tok.v)}>
              {tok.v}
            </button>
          );
        case 'code':
          return <code key={i}>{tok.v}</code>;
        default:
          return <span key={i}>{tok.v}</span>;
      }
    });
  if (items.length <= 1) return <div className={styles.block}>{items[0] ? tokens(items[0]) : null}</div>;
  return (
    <ul className={styles.block}>
      {items.map((item, i) => (
        <li key={i}>{tokens(item)}</li>
      ))}
    </ul>
  );
}

function Chain({
  r,
  traces,
  work,
  onSelect,
  onOpenFile,
}: {
  r: SpecRequirement;
  traces: RequirementTraces | { error: string } | null;
  work: WorkItem[];
  onSelect: (id: string) => void;
  onOpenFile: OpenFile;
}) {
  const { t } = useRequirementsTranslations();
  const trace = traces && 'items' in traces ? (traces.items.find((x) => x.id === r.id) ?? null) : null;
  const steps = traceChain(r, trace, work);
  return (
    <>
      <div>
        <code className={common.hint}>{r.id}</code>
        <h3 className={styles.chainTitle}>{r.title ?? r.id}</h3>
        <span className={common.sev}>{BASIS_LABEL[r.basis]}</span>
        {r.because && <span className={common.hint}> “{r.because}”</span>}
      </div>
      <Block text={r.text} onSelect={onSelect} />
      {traces && 'error' in traces && <p className={common.hint}>{t('code_unread', { error: traces.error })}</p>}
      <b>{t('passage_to_code')}</b>
      <ol className={styles.steps}>
        {steps.map((s) => (
          <li key={s.label} className={s.on ? styles.stepOn : styles.stepOff} data-step-on={s.on}>
            <b>{s.label}</b>
            {s.sides.slice(0, 6).map((side, i) => (
              <SideLink key={i} side={side} onOpenFile={onOpenFile} />
            ))}
            {s.ids.length > 0 && (
              <div className={common.row}>
                {s.ids.map((id) => (
                  <button key={id} type="button" className={styles.idchip} onClick={() => onSelect(id)}>
                    {id}
                  </button>
                ))}
              </div>
            )}
            {s.work.map((w, i) => (
              <div key={i} className={common.small}>
                {w.url ? (
                  <a href={w.url} target="_blank" rel="noreferrer">
                    {workLabel(w)}
                  </a>
                ) : (
                  workLabel(w)
                )}{' '}
                {w.title} <span className={common.sev}>{workState(w)}</span>
              </div>
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}
