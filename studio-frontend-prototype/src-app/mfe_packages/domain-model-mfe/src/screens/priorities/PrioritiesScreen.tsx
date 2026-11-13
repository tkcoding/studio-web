/**
 * Priorities (the prototype's priorities-screen.tsx over prioritise.ts): pick
 * the requirements to compare, give each an Impact, take Confidence from what
 * it rests on or correct it, give an effort for Ease, and read the ICE score
 * and the order it leads to. Every value says where it comes from, an unknown
 * stays unknown, a tie stays a tie.
 *
 * The confirmed docs/priorities.md stays in English, as the prototype wrote it:
 * it is a document in the repository, not this screen's words.
 */

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input } from '@gears-frontx/ui-kit';
import type { SpecModelWrite } from '../../api/types';
import {
  confidenceFromBasis,
  confidenceFromHypotheses,
  easeFromEffort,
  iceScore,
  orderItems,
  unknown,
  type CheckedClaim,
  type Criterion,
  type IceCriterion,
  type IceInputs,
  type IceScore,
} from '../../model/prioritise';
import {
  changedSince,
  confirmations,
  confirmationWrite,
  itemWrite,
  removeWrite,
  workingSet,
  type ConfirmedRow,
  type Entry,
  type ReviewWrite,
  type WorkingSet,
} from '../../model/priority-store';
import { classify } from '../../model/requirement-types';
import type { SpecModelReview } from '../../model/review-state';
import type { SpecRequirement, SpecRequirements } from '../../model/spec-model';
import { usePrioritiesTranslations } from '../../i18n';
import { DataTable } from '../common/DataTable';
import { EmptyState, ErrorLine, errText, InfoPopover, Loading, ScopeContext } from '../common/ui';
import common from '../common/common.module.css';
import styles from './priorities.module.css';

type Text = ReturnType<typeof usePrioritiesTranslations>['t'];

/** Where a value comes from, as the confirmed document says it. */
const ORIGIN_LABEL: Record<Criterion['origin'], string> = {
  measured: 'measured',
  estimated: "Studio's estimate",
  entered: 'entered',
  unknown: 'unknown',
};

/** Where an earlier version kept the working set: in this browser only. */
const legacyKey = (projectId: string) => `studio.priorities.${projectId}`;

function loadLegacy(projectId: string): WorkingSet | null {
  try {
    const raw = localStorage.getItem(legacyKey(projectId));
    const set = raw ? (JSON.parse(raw) as WorkingSet) : null;
    return set && Array.isArray(set.items) && set.items.length ? set : null;
  } catch {
    // Private window or blocked storage: nothing to bring over.
    return null;
  }
}

function dropLegacy(projectId: string) {
  try {
    localStorage.removeItem(legacyKey(projectId));
  } catch {
    // Nothing kept, nothing to drop.
  }
}

/** How long an entry waits for more typing before it is saved. */
const SAVE_AFTER_MS = 700;

/** The entries typed this visit and not saved yet: a reload of the project's set must not undo them. */
function stillTyped(entries: Record<string, Entry>, typing: ReadonlySet<string>): Record<string, Entry> {
  return Object.fromEntries([...typing].filter((id) => entries[id]).map((id) => [id, entries[id]]));
}

/** "3" or "1.5-3" as person-weeks; undefined when it is neither. */
function parseEffort(text: string | undefined): number | [number, number] | undefined {
  if (!text?.trim()) return undefined;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(text);
  if (!m) return undefined;
  const a = Number(m[1].replace(',', '.'));
  return m[2] ? [a, Number(m[2].replace(',', '.'))] : a;
}

/** The three criteria of one item: what was entered, else what Studio can
 *  propose — Confidence from its checked hypotheses first, else from what
 *  the requirement rests on — else unknown. */
function inputsOf(r: SpecRequirement, e: Entry, claims: CheckedClaim[]): IceInputs {
  const effort = parseEffort(e.effort);
  return {
    impact:
      e.impact !== undefined
        ? { score: e.impact, origin: 'entered', basis: 'Entered by a person.' }
        : unknown('Needs the expected contribution to the goal.'),
    confidence:
      e.confidence !== undefined
        ? { score: e.confidence, origin: 'entered', basis: 'Entered by a person.' }
        : (confidenceFromHypotheses(claims) ?? confidenceFromBasis(r.basis)),
    ease:
      effort !== undefined
        ? easeFromEffort(effort, `${e.effort} person-weeks, entered.`, 'entered')
        : unknown('Needs an effort estimate in person-weeks.'),
  };
}

const scoreText = (ice: IceScore) => String(ice.score ?? (ice.range ? `${ice.range[0]}–${ice.range[1]}` : 'incomplete'));

const num = (v: string) => (v.trim() === '' ? undefined : Math.min(10, Math.max(1, Math.round(Number(v)))));

export function PrioritiesScreen({
  read,
  projectId,
  reviews,
  onSave,
  claimsFor,
  onTrace,
  onConfirm,
}: {
  read: SpecRequirements | { error: string } | null;
  projectId: string;
  /** The hypotheses about a requirement, as far as checking them went:
   *  what Confidence is first proposed from. */
  claimsFor?: (r: SpecRequirement) => CheckedClaim[];
  /** The project's decisions: the working set and the confirmed orders are among them. */
  reviews: SpecModelReview[];
  /** Keep changes to the working set, or a confirmed order, with the project. */
  onSave?: (writes: ReviewWrite[]) => Promise<void>;
  /** Propose the confirmed order as docs/priorities.md: versioned by the
   *  repository, reviewed like any change. */
  onConfirm?: (content: string) => Promise<SpecModelWrite>;
  /** Follow a requirement in the Requirements view. */
  onTrace: (id: string) => void;
}) {
  const { t } = usePrioritiesTranslations();
  const language = useContext(ScopeContext)?.language;
  const kept = useMemo(() => workingSet(reviews), [reviews]);
  const history = useMemo(() => confirmations(reviews), [reviews]);
  // What is on screen: the project's set, with this visit's typing laid over
  // it until it is saved.
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [typing, setTyping] = useState<ReadonlySet<string>>(() => new Set());
  const [saved, setSaved] = useState<WorkingSet>(kept);
  const [seen, setSeen] = useState(kept);
  if (seen !== kept) {
    // The project's set was read again: take it, keeping what is still being typed.
    setSeen(kept);
    setSaved((s) => ({ items: kept.items, entries: { ...kept.entries, ...stillTyped(s.entries, typing) } }));
  }
  useEffect(() => {
    const timers = pending.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
  const [legacy, setLegacy] = useState(() => loadLegacy(projectId));
  const [adding, setAdding] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ busy: boolean; done?: SpecModelWrite; error?: string }>({ busy: false });
  const save = (writes: ReviewWrite[]) => {
    if (!onSave || writes.length === 0) return Promise.resolve();
    return onSave(writes)
      .then(() => setSaveError(null))
      .catch((e: unknown) => setSaveError(errText(e)));
  };

  const items = useMemo(() => (read && 'items' in read ? read.items : []), [read]);
  const candidates = useMemo(
    () =>
      items.filter((r) => {
        const c = classify(r);
        return c && (c.type === 'functional' || c.type === 'user');
      }),
    [items]
  );
  const byId = useMemo(() => new Map(items.map((r) => [r.id, r])), [items]);
  const chosen = saved.items.map((id) => byId.get(id)).filter((r): r is SpecRequirement => !!r);
  const scored = chosen.map((r) => {
    const claims = claimsFor?.(r) ?? [];
    const inputs = inputsOf(r, saved.entries[r.id] ?? {}, claims);
    return { r, inputs, claims, ice: iceScore(inputs) };
  });
  const ordering = orderItems(
    scored.map((s) => ({ id: s.r.id, score: s.ice.score ?? s.ice.range?.[0] ?? null })),
    new Map()
  );
  const rank = new Map(ordering.order.map((id, n) => [id, n + 1]));
  const rows = [...scored].sort((a, b) => rank.get(a.r.id)! - rank.get(b.r.id)!);
  type Row = (typeof rows)[number];

  const setEntry = (id: string, patch: Partial<Entry>) => {
    const entry = { ...saved.entries[id], ...patch };
    setSaved((s) => ({ ...s, entries: { ...s.entries, [id]: entry } }));
    setTyping((s) => new Set(s).add(id));
    // Typing is saved once it pauses, one item at a time.
    clearTimeout(pending.current.get(id));
    pending.current.set(
      id,
      setTimeout(() => {
        pending.current.delete(id);
        setTyping((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        void save([itemWrite(id, entry)]);
      }, SAVE_AFTER_MS)
    );
  };
  const add = (ids: string[]) => {
    const fresh = ids.filter((id) => !saved.items.includes(id));
    setSaved((s) => ({ ...s, items: [...s.items, ...fresh] }));
    void save(fresh.map((id) => itemWrite(id, saved.entries[id] ?? {})));
  };
  const remove = (id: string) => {
    setSaved((s) => ({ ...s, items: s.items.filter((x) => x !== id) }));
    void save([removeWrite(id)]);
  };
  const bringLegacy = async () => {
    if (!legacy) return;
    const ids = legacy.items.filter((id) => !saved.items.includes(id));
    await save(ids.map((id) => itemWrite(id, legacy.entries[id] ?? {})));
    dropLegacy(projectId);
    setLegacy(null);
  };
  const q = adding.trim().toLowerCase();
  const matches = q
    ? candidates
        .filter((r) => !saved.items.includes(r.id) && `${r.id} ${r.title ?? ''}`.toLowerCase().includes(q))
        .slice(0, 8)
    : [];
  const p1 = candidates.filter((r) => r.priority === 'p1');
  const nowRows: ConfirmedRow[] = rows.map(({ r, ice }) => ({ id: r.id, rank: rank.get(r.id)!, ice: scoreText(ice) }));
  const last = history[0];
  const changed = changedSince(last, nowRows);

  const proposeOrder = () => {
    setConfirm({ busy: true });
    const lines = [
      '---',
      'type: material',
      '---',
      '',
      '# Priorities',
      '',
      '<!-- Confirmed in Studio. ICE: the mean of Impact, Confidence and Ease, each 1–10. -->',
      '',
      '| # | Requirement | Impact | Confidence | Ease | ICE |',
      '|---|---|---|---|---|---|',
      ...rows.map(({ r, inputs, ice }) => {
        const v = (k: IceCriterion) =>
          `${inputs[k].range ? `${inputs[k].range![0]}–${inputs[k].range![1]}` : (inputs[k].score ?? 'unknown')} (${ORIGIN_LABEL[inputs[k].origin]})`;
        const title = (r.title ?? r.id).replace(/\|/g, '\\|');
        const place = `${rank.get(r.id)}${ordering.ties.has(r.id) ? ' (tie)' : ''}`;
        return `| ${place} | ${title} \`${r.id}\` | ${v('impact')} | ${v('confidence')} | ${v('ease')} | ${scoreText(ice)} |`;
      }),
      '',
    ];
    onConfirm!(lines.join('\n'))
      .then(async (done) => {
        // The confirmation is kept with the project too: who, when, the pull
        // request and the order, to compare against later.
        await save([confirmationWrite(new Date().toISOString(), done, nowRows)]);
        setConfirm({ busy: false, done });
      })
      .catch((e: unknown) => setConfirm({ busy: false, error: errText(e) }));
  };

  if (!read) return <Loading>{t('loading')}</Loading>;
  if ('error' in read) return <ErrorLine>{read.error}</ErrorLine>;

  const criterion = (k: IceCriterion) => t(`criterion_${k}`);

  return (
    <div className={styles.screen} data-priorities>
      <p className={styles.howto}>
        <b>{t('howto_title')}</b>
        <InfoPopover label={t('howto_label')}>
          <p>{t('howto_body')}</p>
        </InfoPopover>
      </p>
      {legacy && onSave && (
        <div className={`${common.card} ${styles.legacy}`} data-priorities-legacy>
          <span>{t.count('legacy_note', legacy.items.length)}</span>
          <Button type="button" size="sm" onClick={() => void bringLegacy()}>
            {t('legacy_bring')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              dropLegacy(projectId);
              setLegacy(null);
            }}
          >
            {t('legacy_discard')}
          </Button>
        </div>
      )}
      {saveError && <ErrorLine>{t('not_saved', { error: saveError })}</ErrorLine>}
      <div className={`${common.card} ${styles.add}`}>
        <Input
          type="search"
          className={styles.addSearch}
          placeholder={t('add_placeholder')}
          aria-label={t('add_label')}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => add(p1.map((r) => r.id))}
          title={t('add_p1_title')}
        >
          {t('add_p1', { count: p1.length })}
        </Button>
        {matches.length > 0 && (
          <ul className={styles.matches}>
            {matches.map((r) => (
              <li key={r.id}>
                <button type="button" className={common.link} onClick={() => add([r.id])}>
                  {r.title ?? r.id}
                </button>{' '}
                <code className={`${common.hint} ${common.code}`}>{r.id}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('empty_title')} body={t('empty_body')} />
      ) : (
        <div className={common.card}>
          <DataTable<Row>
            list="priorities"
            urlPrefix="pri."
            rows={rows}
            rowKey={(x) => x.r.id}
            rowLabel={(x) => x.r.title ?? x.r.id}
            pageSize={20}
            empty={{ title: t('empty_title') }}
            columns={[
              {
                id: 'rank',
                header: t('col_rank'),
                num: true,
                compare: (a, b) => rank.get(a.r.id)! - rank.get(b.r.id)!,
                cell: ({ r }) => (
                  <span className={styles.rank} data-rank={rank.get(r.id)}>
                    {rank.get(r.id)}
                    {ordering.ties.has(r.id) && <small title={t('tie_title')}>{t('tie')}</small>}
                  </span>
                ),
              },
              {
                id: 'req',
                header: t('col_requirement'),
                cell: ({ r }) => (
                  <span>
                    <button type="button" className={common.link} onClick={() => onTrace(r.id)}>
                      {r.title ?? r.id}
                    </button>
                    <small className={styles.sub}>
                      {t(`type_${classify(r)!.type}`)} · {r.priority ?? t('no_mark')} ·{' '}
                      <code className={common.code}>{r.id}</code>
                    </small>
                  </span>
                ),
              },
              {
                id: 'impact',
                header: t('col_impact'),
                cell: ({ r, inputs }) => (
                  <Cell c={inputs.impact} t={t}>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      aria-label={t('criterion_of', { criterion: criterion('impact'), id: r.id })}
                      value={(saved.entries[r.id] ?? {}).impact ?? ''}
                      onChange={(ev) => setEntry(r.id, { impact: num(ev.target.value) })}
                    />
                  </Cell>
                ),
              },
              {
                id: 'confidence',
                header: t('col_confidence'),
                cell: ({ r, inputs, claims }) => (
                  <Cell c={inputs.confidence} t={t}>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      aria-label={t('criterion_of', { criterion: criterion('confidence'), id: r.id })}
                      placeholder={inputs.confidence.origin === 'estimated' ? String(inputs.confidence.score) : ''}
                      value={(saved.entries[r.id] ?? {}).confidence ?? ''}
                      onChange={(ev) => setEntry(r.id, { confidence: num(ev.target.value) })}
                    />
                    {claims.length > 0 && (
                      <small className={styles.claims} title={inputs.confidence.basis}>
                        {claims.map((c) => `${c.claim}: ${t(`evidence_${c.state}`)}`).join('; ')}
                      </small>
                    )}
                  </Cell>
                ),
              },
              {
                id: 'ease',
                header: t('col_ease'),
                cell: ({ r, inputs }) => (
                  <Cell c={inputs.ease} t={t}>
                    <Input
                      type="text"
                      aria-label={t('effort_of', { id: r.id })}
                      placeholder={t('effort_placeholder')}
                      value={(saved.entries[r.id] ?? {}).effort ?? ''}
                      onChange={(ev) => setEntry(r.id, { effort: ev.target.value })}
                    />
                  </Cell>
                ),
              },
              {
                id: 'ice',
                header: t('col_ice'),
                num: true,
                cell: ({ r, ice }) => (
                  <span className={styles.score} data-ice={r.id}>
                    {ice.score !== null ? ice.score : ice.range ? `${ice.range[0]}–${ice.range[1]}` : '—'}
                    {ice.missing.length > 0 && <small>{t('needs', { list: ice.missing.map(criterion).join(', ') })}</small>}
                  </span>
                ),
              },
            ]}
            actions={({ r }) => [{ label: t('remove'), onSelect: () => remove(r.id) }]}
          />
        </div>
      )}
      {rows.length > 0 && onConfirm && (
        <div className={styles.actions}>
          <Button type="button" disabled={confirm.busy} onClick={proposeOrder} title={t('confirm_title')}>
            {confirm.busy ? t('confirm_busy') : t('confirm')}
          </Button>
          {confirm.done && (
            <span className={styles.done}>
              {t('proposed')}{' '}
              {confirm.done.pr_url ? (
                <a href={confirm.done.pr_url} target="_blank" rel="noreferrer">
                  {t('as_pr')}
                </a>
              ) : (
                t('on_branch', { branch: confirm.done.branch })
              )}
            </span>
          )}
          {confirm.error && (
            <span className={common.error} role="alert">
              {confirm.error}
            </span>
          )}
        </div>
      )}
      {history.length > 0 && (
        <details className={`${common.card} ${styles.history}`} open={changed}>
          <summary>
            {changed ? t('history_changed') : t('history_same')} · {t.count('history_count', history.length)}
          </summary>
          <ul>
            {history.map((c) => (
              <li key={c.key}>
                {new Date(c.at).toLocaleString(language)} —{' '}
                {c.prUrl ? (
                  <a href={c.prUrl} target="_blank" rel="noreferrer">
                    {t('history_pr')}
                  </a>
                ) : (
                  c.branch && t('on_branch', { branch: c.branch })
                )}{' '}
                <span className={common.hint}>
                  {c.rows
                    .slice(0, 5)
                    .map((r) => `${r.rank}. ${r.id} (${r.ice})`)
                    .join(', ')}
                  {c.rows.length + c.more > 5 ? t('history_more', { count: c.rows.length + c.more }) : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {rows.length > 0 && <p className={common.hint}>{t('footer')}</p>}
    </div>
  );
}

/** One ICE criterion's cell: the field, then its value and where it comes from. */
function Cell({ c, t, children }: { c: Criterion; t: Text; children: ReactNode }) {
  return (
    <span className={`${styles.cell} ${styles[c.origin] ?? ''}`} title={c.basis} data-origin={c.origin}>
      {children}
      <small>
        {c.range ? `${c.range[0]}–${c.range[1]}` : (c.score ?? '?')} · {t(`origin_${c.origin}`)}
      </small>
    </span>
  );
}
