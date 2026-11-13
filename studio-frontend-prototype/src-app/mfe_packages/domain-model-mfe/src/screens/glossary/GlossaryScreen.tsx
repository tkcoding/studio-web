/**
 * The project's glossary (glossary-view.ts): what each word means, the pairs
 * that are probably one thing, and the words nobody has defined. Rows come a
 * page at a time and merging searches, so it opens at once however many words
 * the documents use. Ported from the prototype's glossary-screen.tsx; only the
 * UI kit and the words' translations changed.
 */

import { useCallback, useContext, useMemo, useState } from 'react';
import { Button, Input, Textarea } from '@gears-frontx/ui-kit';
import type {
  GlossaryDoc,
  GlossaryDocRow,
  GlossaryRenameProposal,
  SpecModelSentence,
  SpecModelWrite,
} from '../../api/types';
import { passageOf } from '../../model/doc-quality';
import { LAYER_TITLE } from '../../model/domain-layers';
import {
  clarifySentence,
  filterRows,
  glossaryRows,
  mergeCandidates,
  pairVerdict,
  renameOffer,
  similarPairs,
  type GlossaryFilter,
  type GlossaryRow,
  type PairAction,
  type PairVerdict,
  type SimilarPair,
} from '../../model/glossary-view';
import { FactReviewContext } from '../../model/review-state';
import type { Entity, GlossaryEntry } from '../../model/spec-model';
import { useGlossaryTranslations } from '../../i18n';
import { DataTable } from '../common/DataTable';
import { FactRow } from '../common/facts';
import { EmptyState, InfoPopover, Segmented, StatusChip, errText, type Tone } from '../common/ui';
import common from '../common/common.module.css';
import { GlossaryDocument } from './GlossaryDocument';
import styles from './glossary.module.css';

type Decide = (key: string, decision: { name: string | null; alias_of: string | null }) => Promise<void>;
type Rename = { from: string; to: string };
/** Offer, after a decision, to carry a rename into the documents. */
type Offer = (rename: Rename | null) => void;
type Text = ReturnType<typeof useGlossaryTranslations>['t'];

const NO_REVISIONS = new Map<string, string>();
const pairKey = (p: SimilarPair) => `${p.a.key}|${p.b.key}`;
const fileOf = (path: string) => path.split('/').pop();

const ACTION_KEY: Record<PairAction, string> = {
  same: 'action_same',
  clarify: 'action_clarify',
  different: 'action_different',
};
const ACTION_TONE: Record<PairAction, Tone> = { same: 'ok', clarify: 'info', different: 'neutral' };

export function GlossaryScreen({
  entries,
  entities,
  onDecide,
  onProposeRename,
  onProposeSentence,
  onDistinct,
  revisions = NO_REVISIONS,
  onOpenFile,
  onLoadDocument,
  onProposeDocument,
}: {
  /** The glossary the project's documents keep. */
  onLoadDocument?: () => Promise<GlossaryDoc>;
  /** Propose the glossary as docs/glossary.md. */
  onProposeDocument?: (rows: GlossaryDocRow[]) => Promise<SpecModelWrite>;
  /** Open a passage in the project's IDE. */
  onOpenFile?: (path: string) => void;
  entries: GlossaryEntry[];
  entities: Entity[];
  onDecide: Decide;
  onProposeRename: (from: string, to: string) => Promise<GlossaryRenameProposal>;
  /** Open a pull request adding a sentence to a document. */
  onProposeSentence?: (s: SpecModelSentence) => Promise<SpecModelWrite>;
  /** Keep two entries apart for good: they are different things. */
  onDistinct?: (a: string, b: string) => Promise<void>;
  /** Each read document's revision, by path. */
  revisions?: Map<string, string>;
}) {
  const { t } = useGlossaryTranslations();
  const [offer, setOffer] = useState<Rename | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState<GlossaryRenameProposal | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const offerRename: Offer = (rename) => {
    setOffer(rename);
    setProposed(null);
    setProposeError(null);
  };
  const propose = (rename: Rename) => {
    setProposing(true);
    setProposeError(null);
    onProposeRename(rename.from, rename.to)
      .then((r) => setProposed(r))
      .catch((e: unknown) => setProposeError(errText(e)))
      .finally(() => setProposing(false));
  };
  const [filter, setFilter] = useState<GlossaryFilter>('all');
  const [text, setText] = useState('');
  /** Pairs a person said are different things: hidden at once, and kept
   *  apart for good once the decision is saved. */
  const [apart, setApart] = useState<Set<string>>(new Set());
  const keepApart = (p: SimilarPair) => {
    setApart((s) => new Set(s).add(pairKey(p)));
    void onDistinct?.(p.a.key, p.b.key);
  };
  /** The pair whose clarifying sentence is open. */
  const [clarifying, setClarifying] = useState<string | null>(null);
  const rows = useMemo(() => glossaryRows(entries, entities), [entries, entities]);
  const pairs = useMemo(() => similarPairs(entries).filter((p) => !apart.has(pairKey(p))), [entries, apart]);
  const review = useContext(FactReviewContext);
  /** The definition a term goes by: one a member accepted, else the first. */
  const chosenDef = useCallback(
    (r: GlossaryRow) => r.definitions.find((f) => review?.stateOf(f) === 'accepted') ?? r.definitions[0] ?? null,
    [review]
  );
  const settled = useCallback(
    (r: GlossaryRow) => r.entry.chosen || r.definitions.some((f) => review?.stateOf(f) === 'accepted'),
    [review]
  );
  const validated = (r: GlossaryRow) => {
    const d = chosenDef(r);
    return d ? (review?.stateOf(d) ?? null) : null;
  };
  const list = useMemo(() => filterRows(rows, filter, text, pairs), [rows, filter, text, pairs]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.entry.key, r])), [rows]);
  const verdicts = useMemo(
    () => new Map<string, PairVerdict>(pairs.map((p) => [pairKey(p), pairVerdict(p, (k) => rowByKey.get(k))])),
    [pairs, rowByKey]
  );
  const verdictOf = (p: SimilarPair) => verdicts.get(pairKey(p)) ?? pairVerdict(p, (k) => rowByKey.get(k));
  const undefinedCount = useMemo(() => rows.filter((r) => !r.definition && r.layer !== null).length, [rows]);
  const named = useMemo(() => rows.filter((r) => r.entry.chosen || r.entry.aliases.length > 0).length, [rows]);

  if (entries.length === 0) return <EmptyState title={t('empty_title')} body={t('empty_body')} />;

  return (
    <div className={styles.gl}>
      <p className={styles.howto}>
        <b>{t('howto')}</b> <InfoPopover label={t('howto_label')}>{t('howto_body')}</InfoPopover>
      </p>
      {onLoadDocument && onProposeDocument && (
        <GlossaryDocument
          rows={rows}
          defOf={chosenDef}
          settled={settled}
          load={onLoadDocument}
          propose={onProposeDocument}
        />
      )}
      <div className={styles.bar}>
        <Input
          type="search"
          className={styles.search}
          placeholder={t('find_placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('find_label')}
        />
        <Segmented<GlossaryFilter>
          role="group"
          label={t('filter_label')}
          value={filter}
          onChange={setFilter}
          items={[
            { id: 'all', label: t('filter_all'), count: rows.length },
            { id: 'similar', label: t('filter_similar'), count: pairs.length },
            { id: 'undefined', label: t('filter_undefined'), count: undefinedCount },
            { id: 'named', label: t('filter_named'), count: named },
          ]}
        />
      </div>

      {offer && (
        <section className={`${common.card} ${styles.offer}`} aria-live="polite">
          {proposed ? (
            <span>
              {t.count('rename_proposed', proposed.files.length, offer)} ({t.count('uses', proposed.renamed)}):{' '}
              {proposed.pr_url ? (
                <a href={proposed.pr_url} target="_blank" rel="noreferrer">
                  {proposed.pr_url}
                </a>
              ) : (
                <code>{proposed.branch}</code>
              )}
            </span>
          ) : (
            <span className={common.row}>
              {t('rename_still', { from: offer.from })}
              <Button type="button" size="sm" disabled={proposing} onClick={() => propose(offer)}>
                {proposing ? t('proposing') : t('rename_propose', offer)}
              </Button>
              {proposeError && <span className={common.error}>{proposeError}</span>}
            </span>
          )}{' '}
          <Button type="button" size="sm" variant="ghost" onClick={() => offerRename(null)}>
            {proposed ? t('close') : t('not_now')}
          </Button>
        </section>
      )}

      {filter !== 'similar' && filter !== 'named' && pairs.length > 0 && (
        <p className={styles.verdictLine}>
          {t.count('pairs_line', pairs.length)}{' '}
          <button type="button" className={common.link} onClick={() => setFilter('similar')}>
            {t('pairs_review')}
          </button>
        </p>
      )}
      {filter === 'similar' && (
        <div className={common.card}>
          <DataTable<SimilarPair>
            list="glossary-pairs"
            urlPrefix="pair."
            rows={pairs}
            rowKey={pairKey}
            rowLabel={(p) => `${p.a.name} / ${p.b.name}`}
            pageSize={20}
            filters={[
              {
                id: 'action',
                allLabel: t('every_recommendation'),
                kind: 'chips',
                options: (['same', 'clarify', 'different'] as PairAction[]).map((a) => ({
                  value: a,
                  label: t(ACTION_KEY[a]),
                })),
                match: (p, v) => verdictOf(p).action === v,
              },
            ]}
            empty={{ title: t('no_pair_left') }}
            columns={[
              {
                id: 'pair',
                header: t('col_names'),
                cell: (p) => (
                  <span>
                    <b>{p.a.name}</b> · <b>{p.b.name}</b>
                    <div className={styles.sub}>{p.why}</div>
                  </span>
                ),
              },
              {
                id: 'evidence',
                header: t('col_said'),
                cell: (p) => {
                  const e = verdictOf(p).evidence;
                  return (
                    <span className={`${styles.sub} ${styles.evidence}`}>
                      {t('evidence_counts', {
                        aFacts: e.aFacts,
                        bFacts: e.bFacts,
                        aDocs: e.aDocs,
                        bDocs: e.bDocs,
                        shared: e.shared,
                      })}
                      <br />
                      {t('evidence_defined', { a: e.aDefined ? '✓' : '—', b: e.bDefined ? '✓' : '—' })}
                    </span>
                  );
                },
              },
              {
                id: 'recommend',
                header: t('col_recommended'),
                cell: (p) => {
                  const v = verdictOf(p);
                  return (
                    <span>
                      <StatusChip tone={ACTION_TONE[v.action]} data-action={v.action}>
                        {t(ACTION_KEY[v.action])}
                      </StatusChip>
                      <div className={styles.sub}>{v.why}</div>
                    </span>
                  );
                },
              },
            ]}
            expand={(p) => {
              const v = verdictOf(p);
              const ra = rowByKey.get(p.a.key);
              const rb = rowByKey.get(p.b.key);
              const key = pairKey(p);
              return (
                <div className={styles.pairDetail}>
                  <div className={styles.pairSides}>
                    {[ra, rb].map((r, k) => (
                      <div key={k}>
                        <div className={styles.h}>{(k === 0 ? p.a : p.b).name}</div>
                        {r && r.definitions.length ? (
                          r.definitions.slice(0, 2).map((f, i) => <FactRow key={i} fact={f} onOpenFile={onOpenFile} />)
                        ) : (
                          <p className={styles.sub}>{t('no_definition')}</p>
                        )}
                        {r && (
                          <div className={styles.sub}>
                            {t('said_in', {
                              files:
                                r.paths.slice(0, 4).map(fileOf).join(', ') +
                                (r.paths.length > 4 ? ` +${r.paths.length - 4}` : ''),
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className={common.row}>
                    <Button
                      type="button"
                      size="sm"
                      variant={v.action === 'same' ? 'default' : 'ghost'}
                      title={t('same_title', { b: p.b.name, a: p.a.name })}
                      onClick={() =>
                        void onDecide(p.b.key, { name: null, alias_of: p.a.key }).then(() =>
                          offerRename(renameOffer(p.b, p.a.name))
                        )
                      }
                    >
                      {t('action_same')}
                    </Button>
                    {onProposeSentence && (
                      <Button
                        type="button"
                        size="sm"
                        variant={v.action === 'clarify' ? 'default' : 'ghost'}
                        aria-expanded={clarifying === key}
                        onClick={() => setClarifying((c) => (c === key ? null : key))}
                      >
                        {t('action_clarify')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={v.action === 'different' ? 'default' : 'ghost'}
                      onClick={() => keepApart(p)}
                    >
                      {t('action_different')}
                    </Button>
                  </div>
                  {onProposeSentence && clarifying === key && (
                    <Clarify
                      pair={p}
                      entities={entities}
                      revisions={revisions}
                      onPropose={onProposeSentence}
                      onDone={() => keepApart(p)}
                    />
                  )}
                </div>
              );
            }}
          />
        </div>
      )}

      {filter !== 'similar' && (
        <div className={common.card}>
          <DataTable<GlossaryRow>
            list="glossary"
            urlPrefix="gl."
            rows={list}
            rowKey={(r) => r.entry.key}
            rowLabel={(r) => r.entry.name}
            pageSize={20}
            empty={{ title: t('nothing_matches') }}
            columns={[
              {
                id: 'term',
                header: t('col_term'),
                compare: (a, b) => a.entry.name.localeCompare(b.entry.name),
                cell: (r) => {
                  const d = chosenDef(r);
                  return (
                    <span>
                      <b>{r.entry.name}</b>
                      {r.entry.chosen && <span className={styles.sub}> · {t('named_by_you')}</span>}
                      {d && <div className={`${styles.sub} ${styles.def}`}>{d.text}</div>}
                    </span>
                  );
                },
              },
              {
                id: 'from',
                header: t('col_from'),
                cell: (r) => {
                  const d = chosenDef(r);
                  if (!d) return <span className={styles.sub}>—</span>;
                  return (
                    <span>
                      <code className={styles.where} title={d.source.path}>
                        {fileOf(d.source.path)}
                        {d.source.line_start ? `:${d.source.line_start}` : ''}
                      </code>
                      {r.definitions.length > 1 && <span className={styles.sub}> +{r.definitions.length - 1}</span>}
                    </span>
                  );
                },
              },
              {
                id: 'validated',
                header: t('col_validated'),
                cell: (r) => {
                  const v = validated(r);
                  if (v === 'accepted') return <span className={styles.ok}>✓ {t('accepted_mark')}</span>;
                  if (v === 'rejected') return <span className={styles.blocks}>✗ {t('rejected_mark')}</span>;
                  return <span className={styles.sub}>{r.definitions.length ? t('not_yet') : '—'}</span>;
                },
              },
              {
                id: 'aliases',
                header: t('col_aliases'),
                cell: (r) => {
                  const other = [
                    ...r.entry.spellings.filter((x) => x !== r.entry.name),
                    ...r.entry.aliases.map((a) => a.name),
                  ];
                  return (
                    <span className={styles.sub}>
                      {other.length
                        ? other.slice(0, 3).join(', ') + (other.length > 3 ? ` +${other.length - 3}` : '')
                        : '—'}
                    </span>
                  );
                },
              },
              {
                id: 'layer',
                header: t('col_layer'),
                cell: (r) => (r.layer ? LAYER_TITLE[r.layer] : <span className={styles.sub}>—</span>),
              },
              {
                id: 'defined',
                header: t('col_defined'),
                cell: (r) =>
                  r.definition ? (
                    '✓'
                  ) : r.layer ? (
                    <span className={styles.blocks}>{t('defined_no')}</span>
                  ) : (
                    <span className={styles.sub}>—</span>
                  ),
              },
              {
                id: 'facts',
                header: t('col_facts'),
                num: true,
                compare: (a, b) => a.entry.facts - b.entry.facts,
                cell: (r) => r.entry.facts,
              },
              {
                id: 'docs',
                header: t('col_documents'),
                num: true,
                compare: (a, b) => a.entry.documents - b.entry.documents,
                cell: (r) => r.entry.documents,
              },
            ]}
            filters={[
              {
                id: 'validated',
                allLabel: t('any_definition'),
                kind: 'chips',
                options: [
                  { value: 'not-yet', label: t('not_validated') },
                  { value: 'accepted', label: t('accepted') },
                  { value: 'rejected', label: t('rejected') },
                ],
                match: (r, v) => (v === 'not-yet' ? r.definitions.length > 0 && !validated(r) : validated(r) === v),
              },
            ]}
            expand={(r) => (
              <div>
                {r.definitions.length > 0 && (
                  <div className={styles.defs}>
                    <div className={styles.h}>{t.count('what_it_is', r.definitions.length)}</div>
                    {r.definitions.map((f, k) => (
                      <FactRow key={k} fact={f} onOpenFile={onOpenFile} />
                    ))}
                  </div>
                )}
                <ul className={styles.list}>
                  <GlossaryItem row={r} entries={entries} onDecide={onDecide} onOffer={offerRename} t={t} />
                </ul>
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}

function GlossaryItem({
  row,
  entries,
  onDecide,
  onOffer,
  t,
}: {
  row: GlossaryRow;
  entries: GlossaryEntry[];
  onDecide: Decide;
  onOffer: Offer;
  t: Text;
}) {
  const e = row.entry;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const others = e.spellings.filter((s) => s !== e.name);
  const candidates = merging === null ? [] : mergeCandidates(e, entries, merging);
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        {renaming !== null ? (
          <form
            className={styles.inline}
            onSubmit={(ev) => {
              ev.preventDefault();
              const name = renaming.trim();
              void onDecide(e.key, { name: name || null, alias_of: null }).then(() => {
                setRenaming(null);
                onOffer(renameOffer(e, name));
              });
            }}
          >
            <Input
              autoFocus
              aria-label={t('name_for', { name: e.name })}
              value={renaming}
              onChange={(ev) => setRenaming(ev.target.value)}
            />
            <Button type="submit" size="sm">
              {t('save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
              {t('cancel')}
            </Button>
          </form>
        ) : (
          <>
            <b className={styles.term}>{e.name}</b>
            {row.layer && (
              <span className={`${styles.layerPill} ${styles[`layer_${row.layer}`] ?? ''}`}>
                {LAYER_TITLE[row.layer]}
              </span>
            )}
            {e.chosen && <StatusChip tone="ok">{t('named_by_you')}</StatusChip>}
            <span className={common.hint}>
              {t.count('facts', e.facts)} · {t.count('docs', e.documents)}
            </span>
          </>
        )}
        {renaming === null && (
          <span className={styles.actions}>
            <button type="button" className={common.link} onClick={() => setRenaming(e.name)}>
              {t('rename')}
            </button>
            {e.chosen && (
              <button
                type="button"
                className={common.link}
                onClick={() => void onDecide(e.key, { name: null, alias_of: null })}
              >
                {t('use_documents_name')}
              </button>
            )}
            <button
              type="button"
              className={common.link}
              aria-expanded={merging !== null}
              onClick={() => setMerging(merging === null ? '' : null)}
            >
              {t('same_as')}
            </button>
          </span>
        )}
      </div>
      <div className={row.definition ? styles.def : `${styles.def} ${styles.missing}`}>
        {row.definition ?? (row.layer ? t('no_definition_yet') : t('not_a_thing'))}
      </div>
      {(others.length > 0 || e.aliases.length > 0) && (
        <div className={styles.names}>
          {others.length > 0 && <span className={common.hint}>{t('also_written', { names: others.join(', ') })}</span>}
          {e.aliases.map((a) => (
            <Button
              key={a.key}
              type="button"
              size="sm"
              variant="outline"
              title={t('split_title', { name: a.name })}
              onClick={() => void onDecide(a.key, { name: null, alias_of: null })}
            >
              = {a.name} ×
            </Button>
          ))}
        </div>
      )}
      {merging !== null && (
        <div className={styles.merge}>
          <Input
            autoFocus
            type="search"
            className={styles.search}
            placeholder={t('merge_placeholder', { name: e.name })}
            value={merging}
            onChange={(ev) => setMerging(ev.target.value)}
            aria-label={t('merge_label', { name: e.name })}
          />
          {candidates.map((c) => (
            <Button
              key={c.key}
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void onDecide(e.key, { name: e.chosen ? e.name : null, alias_of: c.key }).then(() => {
                  setMerging(null);
                  onOffer(renameOffer(e, c.name));
                })
              }
            >
              {c.name} <span className={common.count}>{c.facts}</span>
            </Button>
          ))}
          {merging.trim() && candidates.length === 0 && <span className={common.hint}>{t('no_word_matches')}</span>}
        </div>
      )}
    </li>
  );
}

/** A sentence that tells two words apart, editable, proposed as a pull
 *  request to the document that describes the longer word, after the passage
 *  that says what it is. The pair leaves the list once it is proposed: the
 *  documents now say they are two things. */
function Clarify({
  pair,
  entities,
  revisions,
  onPropose,
  onDone,
}: {
  pair: SimilarPair;
  entities: Entity[];
  revisions: Map<string, string>;
  onPropose: (s: SpecModelSentence) => Promise<SpecModelWrite>;
  onDone: () => void;
}) {
  const { t } = useGlossaryTranslations();
  const longer = pair.b.key.length >= pair.a.key.length ? pair.b : pair.a;
  const base = longer === pair.b ? pair.a : pair.b;
  const anchor = useMemo(() => {
    const of = (key: string) => entities.find((e) => e.key === key || e.keys.includes(key));
    const e = of(longer.key) ?? of(base.key);
    return e ? passageOf(e, revisions) : null;
  }, [entities, revisions, longer, base]);
  const [text, setText] = useState(() => clarifySentence(pair));
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: SpecModelWrite }>({ busy: false });
  const lineEnd = anchor?.source.line_end;
  if (!anchor || !lineEnd)
    return <div className={`${styles.clarify} ${common.hint}`}>{t('clarify_unread', { name: longer.name })}</div>;
  const path = anchor.source.path;
  const unfinished = !text.trim() || text.includes('…');
  const propose = () => {
    setState({ busy: true });
    onPropose({
      path,
      revision: revisions.get(path) ?? '',
      line: lineEnd,
      sentence: text,
      why: `tell “${longer.name}” and “${base.name}” apart`,
    })
      .then((done) => setState({ busy: false, done }))
      .catch((e: unknown) => setState({ busy: false, error: errText(e) }));
  };
  return (
    <div className={styles.clarify}>
      <label className={styles.field}>
        <span>{t('clarify_where', { path, line: lineEnd })}</span>
        <Textarea rows={2} value={text} disabled={!!state.done} onChange={(e) => setText(e.target.value)} />
      </label>
      {state.done ? (
        <span className={styles.saved}>
          ✓ {t('proposed')}{' '}
          {state.done.pr_url ? (
            <a href={state.done.pr_url} target="_blank" rel="noreferrer">
              {t('as_pull_request')}
            </a>
          ) : (
            t('on_branch', { branch: state.done.branch })
          )}{' '}
          <button type="button" className={common.link} onClick={onDone}>
            {t('done')}
          </button>
        </span>
      ) : (
        <span>
          <Button
            type="button"
            size="sm"
            disabled={state.busy || unfinished}
            onClick={propose}
            title={unfinished ? t('finish_sentence') : undefined}
          >
            {state.busy ? t('proposing') : t('propose_change')}
          </Button>
        </span>
      )}
      {state.error && <span className={common.error}>{state.error}</span>}
    </div>
  );
}
