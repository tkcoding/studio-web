/**
 * The need and the hypotheses (need-view.ts): who has which problem, what
 * they want, what the materials propose — and which benefits someone expects,
 * each a hypothesis with a way to check it and where it stands. Then the
 * behaviour a specification must cover and the accepted rules checked against
 * each other. Read off the same facts and passages as the model; every line
 * opens its source (the prototype's discovery-screens.tsx, drawn with the UI kit).
 */

import { Fragment, useState, type ReactNode } from 'react';
import { Button, Checkbox, Input, NativeSelect, NativeSelectOption, Textarea } from '@gears-frontx/ui-kit';
import type { SpecModelWrite } from '../../api/types';
import { blockedByRules, obligations, type Obligation } from '../../model/behaviour';
import { conflicts, describe as sayRule, readRule } from '../../model/rule-checks';
import {
  CHECK_NOTE_MAX,
  checkSize,
  hypothesesDocument,
  proposedBrief,
  proposedMethods,
  TIMING_LABEL,
  type Check,
  type MethodDef,
  type Timing,
} from '../../model/hypothesis-check';
import {
  EVIDENCE_LABEL,
  hypothesesOf,
  materialFromFile,
  MATERIAL_MAX_BYTES,
  needGaps,
  needsByRole,
  needDocument,
  unlinkedRequirements,
  type EvidenceState,
  type Hypothesis,
} from '../../model/need-view';
import type { SpecModelFact, SpecRequirement } from '../../model/spec-model';
import { useDiscoveryTranslations } from '../../i18n';
import { FactRow, type OpenFile } from '../common/facts';
import { DataTable } from '../common/DataTable';
import { EmptyState, errText, InfoPopover, KpiTile, StatusChip, type Tone } from '../common/ui';
import common from '../common/common.module.css';
import styles from './discovery.module.css';

/** How an evidence state reads as a StatusChip. */
const EVIDENCE_TONE: Record<EvidenceState, Tone> = {
  unchecked: 'neutral',
  supports: 'ok',
  contradicts: 'danger',
  insufficient: 'warn',
};

const EVIDENCE_STATES = Object.keys(EVIDENCE_LABEL) as EvidenceState[];
const TIMINGS = Object.keys(TIMING_LABEL) as Timing[];

type NeedKind = 'problem' | 'outcome' | 'idea' | 'scenario';
const NEED_KINDS: NeedKind[] = ['problem', 'outcome', 'idea', 'scenario'];

/** Words a translation fills, each drawn bold: params become markers, the markers become <b>. */
function Bold({ text, parts }: { text: (params: Record<string, string>) => string; parts: Record<string, string> }) {
  const names = Object.keys(parts);
  const marked = text(Object.fromEntries(names.map((n, i) => [n, `⟦${i}⟧`])));
  return (
    <>
      {marked.split(/⟦(\d+)⟧/).map((piece, i) =>
        i % 2 === 1 ? <b key={i}>{parts[names[Number(piece)]]}</b> : <Fragment key={i}>{piece}</Fragment>
      )}
    </>
  );
}

/** "✓ Proposed as a pull request", or on the branch it was written to. */
function Proposed({ done }: { done: SpecModelWrite }) {
  const { t } = useDiscoveryTranslations();
  return (
    <span className={styles.saved} data-proposed>
      ✓ {t('proposed')}{' '}
      {done.pr_url ? (
        <a href={done.pr_url} target="_blank" rel="noreferrer" className={common.link}>
          {t('as_pull_request')}
        </a>
      ) : (
        t('on_branch', { branch: done.branch })
      )}
    </span>
  );
}

function HowTo({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useDiscoveryTranslations();
  return (
    <p className={styles.howto}>
      <b>{title}</b> <InfoPopover label={t('how_to_read')}>{children}</InfoPopover>
    </p>
  );
}

export function NeedsScreen({
  facts,
  onOpenFile,
  accepted,
  onAddMaterial,
  onPropose,
  requirements,
  readStopped,
}: {
  facts: SpecModelFact[];
  onOpenFile: OpenFile;
  /** Why the last reading stopped — no model key anyone reaches, most often. */
  readStopped?: string | null;
  /** Whether a member accepted a reading. */
  accepted: (f: SpecModelFact) => boolean;
  /** Keep a pasted material in the project and read it at once. */
  onAddMaterial?: (title: string, content: string) => Promise<void>;
  /** Propose the accepted need as docs/discovery.md. */
  onPropose?: (content: string) => Promise<SpecModelWrite>;
  /** The functional and user requirements, to say which trace to no need. */
  requirements?: SpecRequirement[];
}) {
  const { t } = useDiscoveryTranslations();
  const roles = needsByRole(facts);
  const unlinked = unlinkedRequirements(requirements ?? [], facts);
  const gaps = [
    ...needGaps(facts),
    ...(unlinked.length
      ? [
          {
            kind: 'idea-without-problem' as const,
            title: t.count('unlinked_requirements', unlinked.length, {
              ids: `${unlinked
                .slice(0, 3)
                .map((r) => r.id)
                .join(', ')}${unlinked.length > 3 ? '…' : ''}`,
            }),
            fact: undefined,
          },
        ]
      : []),
  ];
  const any = roles.some((r) => r.problems.length + r.outcomes.length + r.ideas.length + r.scenarios.length > 0);
  const noRole = t('no_role');
  const needRows: NeedRow[] = roles.flatMap((r) =>
    (
      [
        ['problem', r.problems],
        ['outcome', r.outcomes],
        ['idea', r.ideas],
        ['scenario', r.scenarios],
      ] as const
    ).flatMap(([kind, list]) =>
      list.map((fact, i) => ({ key: `${r.role}|${kind}|${i}|${fact.subject}`, kind, role: r.role || noRole, fact }))
    )
  );
  const [adding, setAdding] = useState<{ title: string; content: string } | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: SpecModelWrite; added?: string }>({
    busy: false,
  });
  const [refused, setRefused] = useState<string[]>([]);
  const run = async (act: () => Promise<SpecModelWrite | void>, added?: string) => {
    setState({ busy: true });
    try {
      const done = await act();
      setState({ busy: false, done: done || undefined, added });
    } catch (e) {
      setState({ busy: false, error: errText(e) });
    }
  };
  /** Each text file a material of its own, read once all are added. */
  const addFiles = async (files: File[]) => {
    if (!files.length || !onAddMaterial) return;
    const took: string[] = [];
    const no: string[] = [];
    await run(async () => {
      for (const file of files) {
        const m = materialFromFile(file.name, file.size, file.size <= MATERIAL_MAX_BYTES ? await file.text() : '');
        if ('refused' in m) no.push(m.refused);
        else {
          await onAddMaterial(m.title, m.content);
          took.push(m.title);
        }
      }
    });
    setRefused(no);
    setState((s) => ({ ...s, added: took.length ? took.map((x) => `“${x}”`).join(', ') : undefined }));
  };
  const acceptedNeed = facts.filter((f) => accepted(f));
  const intake = (
    <section className={`${common.card} ${styles.intake}`} aria-label={t('intake_label')}>
      {adding && onAddMaterial ? (
        <>
          <Input
            type="text"
            placeholder={t('material_title_placeholder')}
            value={adding.title}
            onChange={(e) => setAdding({ ...adding, title: e.target.value })}
            aria-label={t('material_title')}
          />
          <Textarea
            rows={8}
            placeholder={t('material_content_placeholder')}
            aria-label={t('material_content')}
            value={adding.content}
            onChange={(e) => setAdding({ ...adding, content: e.target.value })}
          />
          <div className={common.row}>
            <Button
              type="button"
              disabled={state.busy || !adding.title.trim() || !adding.content.trim()}
              onClick={() =>
                void run(async () => {
                  await onAddMaterial(adding.title.trim(), adding.content);
                  setAdding(null);
                }, adding.title.trim())
              }
            >
              {state.busy ? t('adding') : t('add_and_read')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <div className={common.row}>
          {onAddMaterial && (
            <>
              <Button type="button" variant="outline" onClick={() => setAdding({ title: '', content: '' })}>
                {t('paste_material')}
              </Button>
              <label className={styles.file} title={t('add_files_title')}>
                {t('add_files')}
                <input
                  type="file"
                  multiple
                  className={styles.srOnly}
                  accept=".md,.markdown,.txt,.text,.csv,.tsv,.json,.html,.htm,.eml,.vtt,.srt,.log,.yaml,.yml"
                  disabled={state.busy}
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    void addFiles(files);
                  }}
                />
              </label>
            </>
          )}
          {onPropose && (
            <Button
              type="button"
              disabled={state.busy || acceptedNeed.length === 0}
              title={acceptedNeed.length ? t('accept_need_title') : t('accept_need_none_title')}
              onClick={() => void run(() => onPropose(needDocument(acceptedNeed)))}
            >
              {t.count('accept_need', acceptedNeed.filter((f) => f.kind !== 'role').length)}
            </Button>
          )}
          <span className={common.hint}>{t('materials_read_note')}</span>
        </div>
      )}
      {state.added && (
        <span className={styles.saved}>
          ✓ {t('added', { what: state.added.startsWith('“') ? state.added : `“${state.added}”` })}
        </span>
      )}
      {readStopped && (
        <span className={common.error} data-read-stopped>
          {t('read_stopped', { why: readStopped })}
        </span>
      )}
      {refused.map((r) => (
        <span key={r} className={common.error}>
          {t('not_added', { why: r })}
        </span>
      ))}
      {state.done && <Proposed done={state.done} />}
      {state.error && (
        <span className={common.error} role="alert">
          {state.error}
        </span>
      )}
    </section>
  );
  if (!any)
    return (
      <div className={styles.screen}>
        {intake}
        <EmptyState title={t('needs_empty_title')} body={t('needs_empty_body')} />
      </div>
    );
  return (
    <div className={styles.screen}>
      <HowTo title={t('needs_howto')}>{t('needs_howto_body')}</HowTo>
      {intake}
      {gaps.length > 0 && (
        <details className={`${common.card} ${styles.problems}`} aria-label={t('gaps_label')}>
          <summary className={styles.summary}>{t.count('gaps', gaps.length)}</summary>
          {gaps.map((g, i) => (
            <div key={i} className={styles.problem}>
              <StatusChip tone="warn">
                {g.kind === 'problem-without-idea'
                  ? t('gap_no_solution')
                  : g.kind === 'idea-without-problem'
                    ? t('gap_no_problem')
                    : t('gap_no_need')}
              </StatusChip>
              <div>
                <b>{g.title}.</b>
                {g.fact && (
                  <div className={`${common.hint} ${common.code}`}>
                    {g.fact.source.path}
                    {g.fact.source.line_start ? `:${g.fact.source.line_start}` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </details>
      )}
      <div className={common.card}>
        <DataTable<NeedRow>
          list="dm-needs"
          urlPrefix="need."
          rows={needRows}
          rowKey={(r) => r.key}
          rowLabel={(r) => r.fact.subject}
          pageSize={20}
          search={{ placeholder: t('search_need') }}
          searchText={(r) => [r.fact.subject, r.fact.value, r.fact.text, r.role]}
          filters={[
            {
              id: 'kind',
              allLabel: t('everything'),
              kind: 'chips',
              options: NEED_KINDS.filter((k) => needRows.some((r) => r.kind === k)).map((k) => ({
                value: k,
                label: t(`kind_${k}`),
              })),
              match: (r, v) => r.kind === v,
            },
            {
              id: 'role',
              allLabel: t('every_role'),
              kind: 'select',
              options: [...new Set(needRows.map((r) => r.role))].sort().map((x) => ({ value: x, label: x })),
              match: (r, v) => r.role === v,
            },
          ]}
          empty={{ title: t('nothing_matches') }}
          columns={[
            { id: 'kind', header: t('col_kind'), cell: (r) => <StatusChip tone="warn">{t(`kind_${r.kind}`)}</StatusChip> },
            {
              id: 'what',
              header: t('col_what'),
              compare: (a, b) => a.fact.subject.localeCompare(b.fact.subject),
              cell: (r) => (
                <span>
                  <b>{r.fact.subject}</b>
                  {r.fact.value && <span className={common.muted}> — {r.fact.value}</span>}
                </span>
              ),
            },
            { id: 'role', header: t('col_who'), compare: (a, b) => a.role.localeCompare(b.role), cell: (r) => r.role },
            {
              id: 'where',
              header: t('col_read_from'),
              cell: (r) => (
                <code className={common.code}>
                  {r.fact.source.path.split('/').pop()}
                  {r.fact.source.line_start ? `:${r.fact.source.line_start}` : ''}
                </code>
              ),
            },
            {
              id: 'accepted',
              header: t('col_accepted'),
              cell: (r) => (accepted(r.fact) ? '✓' : <span className={common.muted}>—</span>),
            },
          ]}
          expand={(r) => <FactRow fact={r.fact} onOpenFile={onOpenFile} />}
        />
      </div>
    </div>
  );
}

export function HypothesesScreen({
  facts,
  stateOf,
  onEvidence,
  catalogue,
  kitNote,
  checkOf,
  onSaveCheck,
  onPropose,
  onOpenFile,
}: {
  facts: SpecModelFact[];
  /** Where a hypothesis stands, as members recorded it. */
  stateOf: (f: SpecModelFact) => EvidenceState;
  onEvidence?: (f: SpecModelFact, state: EvidenceState) => Promise<void>;
  /** The check methods: built in, then the project's kits'. */
  catalogue: MethodDef[];
  /** Which kits' methods were read, or why some were not. */
  kitNote?: string | null;
  /** The check a member planned or recorded for a hypothesis. */
  checkOf: (h: Hypothesis) => Check | undefined;
  onSaveCheck?: (h: Hypothesis, check: Check) => Promise<void>;
  /** Propose the hypotheses as docs/hypotheses.md. */
  onPropose?: (content: string) => Promise<SpecModelWrite>;
  onOpenFile: OpenFile;
}) {
  const { t } = useDiscoveryTranslations();
  const list = hypothesesOf(facts);
  const [draft, setDraft] = useState<Record<number, Check>>({});
  const [saving, setSaving] = useState<{ i?: number; error?: string; done?: SpecModelWrite; busy?: boolean }>({});
  const label = (id: string) => catalogue.find((m) => m.id === id)?.label ?? id;
  /** What the row shows: the draft being edited, else the record, else a
   *  first proposal nobody saved. */
  const checkAt = (i: number, h: Hypothesis): Check =>
    draft[i] ??
    checkOf(h) ?? {
      methods: proposedMethods(h, catalogue)
        .map((p) => p.id)
        .slice(0, 1),
      timing: null,
      brief: '',
      criterion: '',
      result: '',
    };
  const edit = (i: number, h: Hypothesis, patch: Partial<Check>) =>
    setDraft((d) => ({ ...d, [i]: { ...checkAt(i, h), ...patch } }));
  if (list.length === 0) return <EmptyState title={t('hyp_empty_title')} body={t('hyp_empty_body')} />;
  const counts = list.reduce<Record<EvidenceState, number>>(
    (c, h) => ({ ...c, [stateOf(h.fact)]: c[stateOf(h.fact)] + 1 }),
    { unchecked: 0, supports: 0, contradicts: 0, insufficient: 0 }
  );
  const rows: HypRow[] = list.map((h, i) => ({ key: `${i}|${h.solution}|${h.effect}`, i, h, state: stateOf(h.fact) }));
  return (
    <div className={styles.screen}>
      <HowTo title={t('hyp_howto')}>{t('hyp_howto_body')}</HowTo>
      {(onPropose || kitNote) && (
        <div className={common.row}>
          {onPropose && (
            <Button
              type="button"
              variant="outline"
              disabled={saving.busy}
              title={t('hyp_propose_title')}
              onClick={() => {
                setSaving({ busy: true });
                onPropose(
                  hypothesesDocument(
                    list,
                    (h) => stateOf(h.fact),
                    (h) => checkOf(h),
                    catalogue
                  )
                )
                  .then((done) => setSaving({ done }))
                  .catch((e: unknown) => setSaving({ error: errText(e) }));
              }}
            >
              {saving.busy ? t('proposing') : t('hyp_propose')}
            </Button>
          )}
          {saving.done && <Proposed done={saving.done} />}
          {kitNote && <span className={common.hint}>{kitNote}</span>}
        </div>
      )}
      {saving.error && (
        <p className={common.error} role="alert">
          {saving.error}
        </p>
      )}
      <div className={common.card}>
        <DataTable<HypRow>
          list="dm-hypotheses"
          urlPrefix="hyp."
          rows={rows}
          rowKey={(r) => r.key}
          rowLabel={(r) => r.h.solution || t('solution_not_named')}
          pageSize={20}
          search={{ placeholder: t('search_hypotheses') }}
          searchText={(r) => [r.h.solution, r.h.role, r.h.effect, r.h.fact.text]}
          filters={[
            {
              id: 'state',
              allLabel: t('every_state'),
              kind: 'chips',
              options: EVIDENCE_STATES.filter((st) => counts[st] > 0).map((st) => ({
                value: st,
                label: t(`evidence_${st}`),
              })),
              match: (r, v) => r.state === v,
            },
          ]}
          empty={{ title: t('nothing_matches') }}
          columns={[
            {
              id: 'state',
              header: t('col_state'),
              cell: (r) => (
                <StatusChip tone={EVIDENCE_TONE[r.state]} data-evidence={r.state}>
                  {t(`evidence_${r.state}`)}
                </StatusChip>
              ),
            },
            {
              id: 'solution',
              header: t('col_solution'),
              compare: (a, b) => a.h.solution.localeCompare(b.h.solution),
              cell: (r) => <b>{r.h.solution || <i>{t('not_named')}</i>}</b>,
            },
            {
              id: 'role',
              header: t('col_for_whom'),
              cell: (r) => r.h.role || <i className={common.muted}>{t('not_named')}</i>,
            },
            {
              id: 'effect',
              header: t('col_expected'),
              cell: (r) => r.h.effect || <i className={common.muted}>{t('not_stated')}</i>,
            },
            {
              id: 'method',
              header: t('col_check_by'),
              cell: (r) => {
                const c = checkOf(r.h);
                return c ? (
                  <span>
                    {c.methods.map(label).join(', ') || <i className={common.muted}>{t('no_method')}</i>}
                    {c.timing && <small className={`${common.hint} ${styles.block}`}>{t(`timing_${c.timing}`)}</small>}
                  </span>
                ) : (
                  <span className={common.muted}>
                    {t('proposed_method', { method: label(proposedMethods(r.h, catalogue)[0].id) })}
                  </span>
                );
              },
            },
          ]}
          expand={(r) => {
            const c = checkAt(r.i, r.h);
            const chosen = catalogue.filter((m) => c.methods.includes(m.id));
            const proposals = proposedMethods(r.h, catalogue);
            const size = checkSize(c);
            return (
              <div className={styles.hypDetail}>
                <FactRow fact={r.h.fact} onOpenFile={onOpenFile} />
                <div className={styles.check}>
                  <span className={common.hint}>
                    {t('proposals', { list: proposals.map((p) => `${label(p.id)} — ${p.why}`).join('; ') })}
                  </span>
                  <div className={styles.methods} role="group" aria-label={t('col_check_by')}>
                    {catalogue.map((m) => (
                      <label
                        key={m.id}
                        className={styles.method}
                        title={t('method_title', { uncertainty: m.uncertainty, inputs: m.inputs, limits: m.limits })}
                      >
                        <Checkbox
                          checked={c.methods.includes(m.id)}
                          onCheckedChange={(on) =>
                            edit(r.i, r.h, { methods: on ? [...c.methods, m.id] : c.methods.filter((x) => x !== m.id) })
                          }
                        />
                        {m.label}
                        {m.kit && <small className={common.hint}> · {t('kit', { kit: m.kit })}</small>}
                      </label>
                    ))}
                  </div>
                  {chosen.map((m) => (
                    <span key={m.id} className={common.hint}>
                      <b>{m.label}:</b> {m.uncertainty} {m.action} <i>{t('limit', { limits: m.limits })}</i>
                    </span>
                  ))}
                  <label className={styles.inline}>
                    {t('when')}
                    <NativeSelect
                      value={c.timing ?? ''}
                      onChange={(e) => edit(r.i, r.h, { timing: (e.target.value || null) as Timing | null })}
                    >
                      <NativeSelectOption value="">{t('not_chosen')}</NativeSelectOption>
                      {TIMINGS.map((x) => (
                        <NativeSelectOption key={x} value={x}>
                          {t(`timing_${x}`)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <div className={styles.field}>
                    <span className={common.row}>
                      {t('brief')}
                      <button
                        type="button"
                        className={common.link}
                        onClick={() => edit(r.i, r.h, { brief: proposedBrief(r.h, chosen, c.timing) })}
                      >
                        {c.brief ? t('propose_again') : t('propose_one')}
                      </button>
                    </span>
                    <Textarea
                      aria-label={t('brief')}
                      rows={c.brief ? 7 : 2}
                      value={c.brief}
                      onChange={(e) => edit(r.i, r.h, { brief: e.target.value })}
                    />
                  </div>
                  <label className={styles.field}>
                    {t('criterion')}
                    <Input
                      type="text"
                      placeholder={t('criterion_placeholder')}
                      value={c.criterion}
                      onChange={(e) => edit(r.i, r.h, { criterion: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    {t('result')}
                    <Textarea
                      rows={3}
                      placeholder={t('result_placeholder')}
                      value={c.result}
                      onChange={(e) => edit(r.i, r.h, { result: e.target.value })}
                    />
                  </label>
                  {onSaveCheck && (
                    <div className={common.row}>
                      <Button
                        type="button"
                        disabled={size > CHECK_NOTE_MAX || saving.i === r.i}
                        onClick={() => {
                          setSaving({ i: r.i });
                          onSaveCheck(r.h, c)
                            .then(() => {
                              setDraft((d) => {
                                const rest = { ...d };
                                delete rest[r.i];
                                return rest;
                              });
                              setSaving({});
                            })
                            .catch((e: unknown) => setSaving({ error: errText(e) }));
                        }}
                      >
                        {saving.i === r.i ? t('saving') : t('save_check')}
                      </Button>
                      <span className={size > CHECK_NOTE_MAX ? common.error : common.hint}>
                        {t('bytes', { size, max: CHECK_NOTE_MAX })}
                      </span>
                      {!c.criterion.trim() && c.result.trim() && (
                        <span className={common.hint}>{t('exploratory')}</span>
                      )}
                    </div>
                  )}
                </div>
                {onEvidence && (
                  <div className={common.row}>
                    <span className={common.hint}>{t('result_label')}</span>
                    {(['supports', 'contradicts', 'insufficient', 'unchecked'] as EvidenceState[]).map((st) => (
                      <Button
                        key={st}
                        type="button"
                        size="sm"
                        variant={r.state === st ? 'default' : 'ghost'}
                        aria-pressed={r.state === st}
                        onClick={() => void onEvidence(r.h.fact, st)}
                      >
                        {t(`evidence_${st}`)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

/** Bounded behaviour coverage: what the specification must say about each
 *  action in each state, answered by a passage, asked, or excluded with a
 *  reason. Nothing here is a release gate. */
export function BehaviourScreen({
  facts,
  rules,
  decisionOf,
  onExclude,
  onOpenFile,
}: {
  facts: SpecModelFact[];
  /** The constraints a member accepted, read: what an action is checked against. */
  rules: ReturnType<typeof readRule>[];
  decisionOf: (key: string) => { state: string; note: string | null } | undefined;
  /** Record a reason an obligation does not apply, or `null` to ask it again. */
  onExclude?: (o: Obligation, reason: string | null) => Promise<void>;
  onOpenFile: OpenFile;
}) {
  const { t } = useDiscoveryTranslations();
  const list = obligations(facts);
  const blocked = blockedByRules(facts, rules);
  const [reason, setReason] = useState<Record<string, string>>({});
  const question = (o: Obligation) => (
    <Bold
      text={(p) => t('may_question', p)}
      parts={{ role: o.role || t('someone'), action: o.action, entity: o.entity, state: o.state }}
    />
  );
  const cannot = blocked.length > 0 && (
    <details className={`${common.card} ${styles.problems}`} open aria-label={t('cannot_label')}>
      <summary className={styles.summary}>{t.count('blocked', blocked.length)}</summary>
      {blocked.map((b, i) => (
        <div key={i} className={styles.problem}>
          <StatusChip tone="danger">{t('cannot_happen')}</StatusChip>
          <div>
            <b>{b.witness}.</b>
            <FactRow fact={b.fact} onOpenFile={onOpenFile} />
            <FactRow fact={b.rule.fact} onOpenFile={onOpenFile} />
          </div>
        </div>
      ))}
    </details>
  );
  if (list.length === 0)
    return (
      <div className={styles.screen}>
        {cannot}
        <EmptyState title={t('beh_empty_title')} body={t('beh_empty_body')} />
      </div>
    );
  const excluded = list.filter((o) => decisionOf(o.key)?.state === 'excluded');
  const answered = list.filter((o) => o.answer && !excluded.includes(o));
  const open = list.filter((o) => !o.answer && !excluded.includes(o));
  const statusOf = (o: Obligation) => (excluded.includes(o) ? 'excluded' : o.answer ? 'answered' : 'open');
  const row = (o: Obligation) => (
    <div key={o.key} className={styles.ob}>
      <div>{question(o)}</div>
      {o.answer ? (
        <FactRow fact={o.answer} onOpenFile={onOpenFile} />
      ) : decisionOf(o.key)?.state === 'excluded' ? (
        <div className={common.hint}>
          {t('excluded_because', { note: decisionOf(o.key)?.note ?? '' })}{' '}
          {onExclude && (
            <button type="button" className={common.link} onClick={() => void onExclude(o, null)}>
              {t('ask_again')}
            </button>
          )}
        </div>
      ) : (
        onExclude && (
          <div className={common.row}>
            <Input
              type="text"
              className={styles.reason}
              placeholder={t('exclude_placeholder')}
              value={reason[o.key] ?? ''}
              onChange={(e) => setReason((r) => ({ ...r, [o.key]: e.target.value }))}
              aria-label={t('exclude_reason')}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!reason[o.key]?.trim()}
              onClick={() => void onExclude(o, reason[o.key].trim())}
            >
              {t('exclude')}
            </Button>
          </div>
        )
      )}
    </div>
  );
  const countOf = { open: open.length, answered: answered.length, excluded: excluded.length };
  return (
    <div className={styles.screen}>
      <HowTo title={t('beh_howto')}>{t('beh_howto_body')}</HowTo>
      {cannot}
      <div className={common.card}>
        <DataTable<Obligation>
          list="dm-behaviour"
          urlPrefix="beh."
          rows={list}
          rowKey={(o) => o.key}
          rowLabel={(o) => `${o.action} ${o.entity} ${o.state}`}
          pageSize={20}
          search={{ placeholder: t('search_questions') }}
          searchText={(o) => [o.role, o.action, o.entity, o.state]}
          filters={[
            {
              id: 'status',
              allLabel: t('every_question'),
              kind: 'chips',
              options: (['open', 'answered', 'excluded'] as const)
                .filter((x) => countOf[x] > 0)
                .map((x) => ({ value: x, label: t(`filter_${x}`) })),
              match: (o, v) => statusOf(o) === v,
            },
            {
              id: 'entity',
              allLabel: t('every_thing'),
              kind: 'select',
              options: [...new Set(list.map((o) => o.entity))].sort().map((x) => ({ value: x, label: x })),
              match: (o, v) => o.entity === v,
            },
          ]}
          empty={{ title: t('nothing_matches') }}
          columns={[
            {
              id: 'status',
              header: t('col_status'),
              cell: (o) => (
                <StatusChip tone={statusOf(o) === 'open' ? 'warn' : 'ok'}>{t(`status_${statusOf(o)}`)}</StatusChip>
              ),
            },
            { id: 'question', header: t('col_question'), cell: (o) => <span>{question(o)}</span> },
            {
              id: 'entity',
              header: t('col_thing'),
              compare: (a, b) => a.entity.localeCompare(b.entity),
              cell: (o) => o.entity,
            },
            { id: 'state', header: t('col_state'), cell: (o) => o.state },
          ]}
          expand={(o) => row(o)}
        />
      </div>
    </div>
  );
}

/** The rules a member confirmed, read into a precise form, and checked
 *  against each other: a conflict with the two passages that witness it,
 *  none among what was read, incomplete, or a rule this check has no form
 *  for. Unconfirmed rules give no verdict. */
export function RulesScreen({
  facts,
  accepted,
  onOpenFile,
}: {
  facts: SpecModelFact[];
  accepted: (f: SpecModelFact) => boolean;
  onOpenFile: OpenFile;
}) {
  const { t } = useDiscoveryTranslations();
  const all = facts.filter((f) => f.kind === 'constraint' && f.status === 'active');
  const confirmed = all.filter(accepted).map(readRule);
  const pending = all.length - confirmed.length;
  const found = conflicts(confirmed);
  const read = confirmed.filter((r) => r.outcome === 'read');
  const incomplete = confirmed.filter((r) => r.outcome === 'incomplete');
  const unsupported = confirmed.filter((r) => r.outcome === 'unsupported');
  return (
    <div className={styles.screen}>
      <HowTo title={t('rules_howto')}>{t('rules_howto_body')}</HowTo>
      <div className={styles.kpis} data-rule-counts>
        <KpiTile label={t('kpi_conflicts')} value={found.length} tone={found.length ? 'danger' : 'ok'} />
        <KpiTile label={t('kpi_read')} value={read.length} />
        <KpiTile label={t('kpi_incomplete')} value={incomplete.length} tone={incomplete.length ? 'warn' : undefined} />
        <KpiTile label={t('kpi_unsupported')} value={unsupported.length} tone={unsupported.length ? 'warn' : undefined} />
        <KpiTile label={t('kpi_pending')} value={pending} />
      </div>
      {confirmed.length === 0 && <EmptyState title={t('rules_empty_title')} body={t('rules_empty_body')} />}
      {confirmed.length > 0 && (
        <div className={common.card}>
          <DataTable<RuleRow>
            list="dm-rules"
            urlPrefix="rule."
            rows={confirmed.map((r, i) => ({
              key: `${i}|${r.fact.subject}|${r.fact.text}`,
              r,
              conflict: found.find((x) => x.a === r || x.b === r) ?? null,
            }))}
            rowKey={(x) => x.key}
            rowLabel={(x) => x.r.fact.subject}
            pageSize={20}
            search={{ placeholder: t('search_rules') }}
            searchText={(x) => [x.r.fact.subject, x.r.fact.text, x.r.fact.value]}
            filters={[
              {
                id: 'outcome',
                allLabel: t('every_rule'),
                kind: 'chips',
                options: [
                  { value: 'conflict', label: t('filter_conflict') },
                  { value: 'read', label: t('outcome_read') },
                  { value: 'incomplete', label: t('outcome_incomplete') },
                  { value: 'unsupported', label: t('outcome_unsupported') },
                ],
                match: (x, v) => (v === 'conflict' ? !!x.conflict : x.r.outcome === v),
              },
            ]}
            empty={{ title: t('nothing_matches') }}
            columns={[
              {
                id: 'outcome',
                header: t('col_outcome'),
                cell: (x) =>
                  x.conflict ? (
                    <StatusChip tone="danger">{t('outcome_conflict')}</StatusChip>
                  ) : (
                    <StatusChip tone={x.r.outcome === 'read' ? 'ok' : 'warn'}>{t(`outcome_${x.r.outcome}`)}</StatusChip>
                  ),
              },
              {
                id: 'subject',
                header: t('col_about'),
                compare: (a, b) => a.r.fact.subject.localeCompare(b.r.fact.subject),
                cell: (x) => <b>{x.r.fact.subject}</b>,
              },
              {
                id: 'reading',
                header: t('col_read_as'),
                cell: (x) => (x.r.reading ? sayRule(x.r.reading) : <span className={common.muted}>{x.r.why}</span>),
              },
            ]}
            expand={(x) => (
              <div>
                {x.conflict && (
                  <div className={styles.gap}>
                    <b>{t('cannot_both_hold')}</b> {x.conflict.witness}
                  </div>
                )}
                <FactRow fact={x.r.fact} onOpenFile={onOpenFile} />
                {x.conflict && (
                  <FactRow fact={(x.conflict.a === x.r ? x.conflict.b : x.conflict.a).fact} onOpenFile={onOpenFile} />
                )}
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}

interface NeedRow {
  key: string;
  kind: NeedKind;
  role: string;
  fact: SpecModelFact;
}

interface HypRow {
  key: string;
  i: number;
  h: Hypothesis;
  state: EvidenceState;
}

interface RuleRow {
  key: string;
  r: ReturnType<typeof readRule>;
  conflict: ReturnType<typeof conflicts>[number] | null;
}
