/**
 * Project › Project domain model — the prototype's `SpecModelTab` (spec-model-tab.tsx
 * at 00828880) carried over as the `project-domain-model` kit: what the
 * project's documents say the application is, each fact with the passage it
 * comes from, and where they disagree about it (docs/project-domain-model.md).
 *
 * Seven tabs, each one question: Entities (the model map, its diagram and
 * the entity editor), Requirements, Need (Needs, Hypotheses), Rules (Rules,
 * Behaviour), Priorities, Glossary, Sources (Documents, Work, Against the
 * code, Elsewhere). A build runs on the viewer's own model key, so the
 * button says so; while it runs the tab reads again every three seconds —
 * the build is in the backend's process and pushes nothing.
 *
 * Review keys are the server's `fact_key` (c3b2cbf5) where a fact carries
 * one, the browser's identical FNV-64 otherwise.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@gears-frontx/ui-kit';
import { openScreen } from '@constructor-studio/mfe-shared';
import { dmApi, type Candidate } from '../../api/client';
import { estimateLabel, etaLabel, readFraction, tokensLabel, type SpecModelBuildEstimate } from '../../model/build-eta';
import type { Obligation } from '../../model/behaviour';
import { gearRefs } from '../../model/entity-gears';
import { checkIndex, checkWrite, hypothesesFor, methodCatalogue, type Check, type MethodDef } from '../../model/hypothesis-check';
import { hypothesesOf, materialDocument, type EvidenceState, type Hypothesis } from '../../model/need-view';
import { indexCatalogue, type CatalogueIndex } from '../../model/product-configurator';
import {
  correctionWrite,
  decisionIndex,
  EVIDENCE_PREFIX,
  evidenceIndex,
  FactReviewContext,
  reviewIndex,
  type FactReview,
  type SpecModelReview,
} from '../../model/review-state';
import { readRule } from '../../model/rule-checks';
import { overlaySaved, pruneSaved, savedWrites, withSaved, type SavedEdit } from '../../model/saved-entities';
import {
  buildLine,
  entitiesOf,
  orderProductFindings,
  subjectKey,
  unreadNote,
  type GlossaryEntry,
  type RelatedRequirements,
  type RequirementTraces,
  type SpecModel,
  type SpecModelFact,
  type SpecModelUploads,
  type SpecRequirements,
  type WorkLinks,
} from '../../model/spec-model';
import type { SpecModelEntityEdit } from '../../api/types';
import { useDomainTranslations } from '../../i18n';
import { BehaviourScreen, HypothesesScreen, NeedsScreen, RulesScreen } from '../discovery/DiscoveryScreens';
import { EntitiesView } from '../entities/EntitiesView';
import { GlossaryScreen } from '../glossary/GlossaryScreen';
import { PrioritiesScreen } from '../priorities/PrioritiesScreen';
import { RequirementsView } from '../requirements/RequirementsView';
import { AgainstTheCode, Coverage, Elsewhere, relatedKey, Uploads, Work, type ProductRead } from '../sources/SourcesViews';
import { ErrorLine, errText, Hint, keyOf, Loading, PageHeader, Segmented, StatusChip, useScope } from '../common/ui';
import common from '../common/common.module.css';
import styles from './domain.module.css';

type View =
  | 'map'
  | 'reqs'
  | 'needs'
  | 'hypotheses'
  | 'behaviour'
  | 'rules'
  | 'priorities'
  | 'glossary'
  | 'work'
  | 'product'
  | 'elsewhere'
  | 'coverage';

type TabId = 'entities' | 'reqs' | 'need' | 'rules' | 'priorities' | 'glossary' | 'sources';

const POLL_MS = 3000;

/** The project's Product tab, where a gear is chosen for a capability (product-mfe). */
const PRODUCT_ROUTE = '/product';

type Catalogue = { index: CatalogueIndex } | { error: string } | null;

export function DomainModelScreen() {
  const { projectId, workspaceId, bridge } = useScope();
  const { t } = useDomainTranslations();
  const [model, setModel] = useState<SpecModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('map');
  /** The requirement followed in the Requirements view. */
  const [traced, setTraced] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [product, setProduct] = useState<ProductRead | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [work, setWork] = useState<WorkLinks | { error: string } | null>(null);
  const [requirements, setRequirements] = useState<SpecRequirements | { error: string } | null>(null);
  const [related, setRelated] = useState<RelatedRequirements | { error: string } | null>(null);
  const [traces, setTraces] = useState<RequirementTraces | { error: string } | null>(null);
  /** Entities saved this visit, laid over the model until a build reads them. */
  const [saved, setSaved] = useState<SavedEdit[]>([]);
  /** The check methods the project's kits add, read when Hypotheses opens. */
  const [kitMethods, setKitMethods] = useState<{ items: MethodDef[]; note: string | null } | null>(null);
  /** Members' accept or reject on each fact. */
  const [reviews, setReviews] = useState<SpecModelReview[]>([]);
  /** When the model was last read: the build's ETA is counted from it (no clock read while drawing). */
  const [readAt, setReadAt] = useState(0);

  /** Every state change in a callback of the reads: an effect may call it. */
  const load = useCallback((): Promise<void> => {
    // A backend from before fact reviews answers 404: nothing is reviewed.
    void dmApi
      .specModelReviews(projectId)
      .then((r) => setReviews(r.items))
      .catch(() => setReviews([]));
    return Promise.all([
      dmApi.specModel(projectId),
      // A backend from before the glossary answers 404: the model still shows.
      dmApi.glossary(projectId).catch(() => ({ items: [] as GlossaryEntry[], total: 0 })),
    ]).then(
      ([m, g]) => {
        setModel(m);
        setReadAt(Date.now());
        setSaved((s) => pruneSaved(s, m.build));
        setGlossary(g.items);
        setError(null);
      },
      (e: unknown) => setError(errText(e))
    );
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A separate read: the comparison with the code needs the catalogue and a
  // repository, and its absence must not hide the documents' own problems.
  useEffect(() => {
    let live = true;
    dmApi
      .productFindings(projectId)
      .then((r) => live && setProduct({ repo: r.repo, items: orderProductFindings(r.items) }))
      .catch((e: unknown) => live && setProduct({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [projectId]);

  // Its own read: no synced work must not hide the documents' own problems.
  useEffect(() => {
    let live = true;
    dmApi
      .workLinks(projectId)
      .then((r) => live && setWork(r))
      .catch((e: unknown) => live && setWork({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [projectId]);

  // Read without a model and without a key: what the documents define.
  useEffect(() => {
    let live = true;
    dmApi
      .specRequirements(projectId)
      .then((r) => live && setRequirements(r))
      .catch((e: unknown) => live && setRequirements({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [projectId]);

  // The project's own gears, which keep entities the catalogue does not.
  // Read once the map is opened, and quietly left out when the plan cannot be read.
  const [ownGears, setOwnGears] = useState<Candidate[]>([]);
  const mapOpened = view === 'map';
  useEffect(() => {
    if (!mapOpened) return;
    let live = true;
    dmApi
      .projectPlan(projectId)
      .then((r) => live && setOwnGears(r.items.flatMap((row) => row.candidates).filter((c) => c.origin === 'project')))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, mapOpened]);

  // Which gear keeps each Domain entity: the catalogue read when the map is
  // first opened. Without it no gear is known, so no gap is claimed either.
  const [catalogue, setCatalogue] = useState<Catalogue>(null);
  useEffect(() => {
    if (!mapOpened || catalogue) return;
    let live = true;
    dmApi
      .gearboxCatalogue()
      .then((r) => live && setCatalogue({ index: indexCatalogue(r.catalogue, r, projectId) }))
      .catch((e: unknown) => live && setCatalogue({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [projectId, mapOpened, catalogue]);

  // Read when the view is opened: it reads every code file of the checkouts.
  useEffect(() => {
    if (view !== 'reqs' || traces !== null) return;
    let live = true;
    dmApi
      .requirementTrace(projectId)
      .then((r) => live && setTraces(r))
      .catch((e: unknown) => live && setTraces({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [view, traces, projectId]);

  // Read only when the view is opened: it reads every other project's documents.
  useEffect(() => {
    if (view !== 'elsewhere' || related !== null) return;
    let live = true;
    dmApi
      .relatedRequirements(projectId)
      .then((r) => live && setRelated(r))
      .catch((e: unknown) => live && setRelated({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [view, related, projectId]);

  // While a build runs, read again until it stops.
  const running = model?.build.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  // What the next build would read and how long it should take, read again
  // whenever a build stops. A backend from before the estimate answers 404.
  const [estimate, setEstimate] = useState<SpecModelBuildEstimate | null>(null);
  useEffect(() => {
    if (running) return;
    let live = true;
    dmApi
      .specModelBuildEstimate(projectId)
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [projectId, running]);

  const startBuild = async (path?: string) => {
    setStarting(true);
    try {
      await dmApi.startSpecModelBuild(projectId, path);
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setStarting(false);
    }
  };

  const decideTerm = async (key: string, decision: { name: string | null; alias_of: string | null }) => {
    try {
      await dmApi.decideGlossaryEntry(projectId, key, decision);
      setGlossary((await dmApi.glossary(projectId)).items);
    } catch (e) {
      setError(errText(e));
    }
  };

  const saveEntity = async (edit: SpecModelEntityEdit) => {
    const write = await dmApi.saveSpecModelEntity(projectId, edit);
    setSaved((s) => withSaved(s, { edit, write, at: Date.now() }));
    return write;
  };

  const rereadReviews = async () => setReviews((await dmApi.specModelReviews(projectId)).items);

  /** The sources uploaded to the model, read when Sources › Documents opens. */
  const [uploads, setUploads] = useState<SpecModelUploads | { error: string } | null>(null);
  const rereadUploads = useCallback(
    () =>
      dmApi.specModelUploads(projectId).then(
        (u) => setUploads(u),
        (e: unknown) => setUploads({ error: errText(e) })
      ),
    [projectId]
  );
  useEffect(() => {
    if (view === 'coverage') void rereadUploads();
  }, [view, rereadUploads]);

  // A corrected reading is the project's reading, as an accepted one is.
  const reviewByKey = useMemo(
    () => reviewIndex(reviews),
    [reviews]
  );
  const evidence = useMemo(() => evidenceIndex(reviews), [reviews]);
  const decisions = useMemo(() => decisionIndex(reviews), [reviews]);
  const revisionOf = useCallback(
    (path: string) => model?.documents.find((d) => d.path === path)?.revision ?? '',
    [model]
  );
  const loadGlossaryDocument = useCallback(() => dmApi.glossaryDocument(projectId), [projectId]);

  useEffect(() => {
    if (view !== 'hypotheses' || kitMethods) return;
    let live = true;
    void dmApi
      .kitInstallations(projectId)
      .then(async ({ items }) => {
        const kits = [...new Set(items.filter((k) => k.status === 'installed').map((k) => k.kit_slug))];
        if (kits.length === 0) return { items: [], note: null };
        const got = await dmApi.specModelCheckMethods(projectId, kits);
        const from = [...new Set(got.items.map((m) => m.kit))];
        const unread = Object.entries(got.unread);
        return {
          items: got.items.map((m) => ({
            id: m.id,
            kit: m.kit,
            label: m.label,
            uncertainty: m.uncertainty,
            inputs: m.inputs,
            action: m.action,
            limits: m.limits,
            appliesTo: m.applies_to,
          })),
          note:
            [
              from.length ? t.count('methods_from', from.length, { kits: from.join(', ') }) : '',
              unread.length ? t('methods_unread', { kits: unread.map(([kit, why]) => `${kit} (${why})`).join(', ') }) : '',
            ]
              .filter(Boolean)
              .join(' ') || null,
        };
      })
      .catch((e: unknown) => ({ items: [], note: t('methods_failed', { error: errText(e) }) }))
      .then((v) => live && setKitMethods(v));
    return () => {
      live = false;
    };
  }, [view, projectId, kitMethods, t]);
  const methods = useMemo(() => methodCatalogue(kitMethods?.items ?? []), [kitMethods]);
  const checks = useMemo(() => checkIndex(reviews), [reviews]);
  const saveCheck = async (h: Hypothesis, check: Check) => {
    await dmApi.reviewSpecModelFacts(projectId, [checkWrite(h, check, revisionOf(h.fact.source.path))]);
    await rereadReviews();
  };
  /** Record a decision kept by key: an excluded obligation, a match across projects. `proposed` withdraws it. */
  const recordDecision = async (key: string, state: string, note: string | null = null, path = '') => {
    try {
      await dmApi.reviewSpecModelFacts(projectId, [{ fact_key: key, state, path, revision: '', note }]);
      await rereadReviews();
    } catch (e) {
      setError(errText(e));
    }
  };
  const recordEvidence = async (f: SpecModelFact, state: EvidenceState) => {
    try {
      await dmApi.reviewSpecModelFacts(projectId, [
        {
          fact_key: `${EVIDENCE_PREFIX}${keyOf(f)}`,
          state: state === 'unchecked' ? 'proposed' : state,
          path: f.source.path,
          revision: revisionOf(f.source.path),
        },
      ]);
      await rereadReviews();
    } catch (e) {
      setError(errText(e));
    }
  };
  const allFacts = useMemo(() => overlaySaved(model?.facts ?? [], saved), [model, saved]);
  const facts = useMemo(
    () => (reviewByKey.size === 0 ? allFacts : allFacts.filter((f) => reviewByKey.get(keyOf(f)) !== 'rejected')),
    [allFacts, reviewByKey]
  );
  const factReview = useMemo<FactReview>(
    () => ({
      stateOf: (f) => reviewByKey.get(keyOf(f)),
      reviewedEarlier: (f) => {
        const r = reviews.find((x) => x.fact_key === keyOf(f));
        const now = model?.documents.find((d) => d.path === f.source.path)?.revision;
        return !!r && !!r.revision && !!now && r.revision !== now;
      },
      rejectedOf: (keys) =>
        allFacts.filter((f) => reviewByKey.get(keyOf(f)) === 'rejected' && keys.includes(subjectKey(f.subject))),
      review: async (fs, state) => {
        const items = fs.map((f) => ({ fact_key: keyOf(f), state, path: f.source.path, revision: revisionOf(f.source.path) }));
        try {
          await dmApi.reviewSpecModelFacts(projectId, items);
          await rereadReviews();
        } catch (e) {
          setError(errText(e));
        }
      },
      correct: async (f, value) => {
        try {
          await dmApi.reviewSpecModelFacts(projectId, [
            correctionWrite(keyOf(f), f.source.path, revisionOf(f.source.path), value),
          ]);
          // The server shows a correction in place of the value read: read the model again.
          await load();
        } catch (e) {
          setError(errText(e));
        }
      },
    }),
    // rereadReviews is recreated each render; it only reads projectId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewByKey, reviews, allFacts, model, projectId, revisionOf, load]
  );
  const writes = useMemo(() => savedWrites(saved), [saved]);
  const hypotheses = useMemo(() => hypothesesOf(facts), [facts]);
  const entities = useMemo(() => entitiesOf(facts, glossary), [facts, glossary]);
  // The lines a fact names are the repository's lines only for a document
  // read at its current revision: a sentence is proposed only there.
  const revisions = useMemo(
    () => new Map((model?.documents ?? []).filter((d) => d.state === 'extracted').map((d) => [d.path, d.revision])),
    [model]
  );
  const index = catalogue && 'index' in catalogue ? catalogue.index : null;
  const gears = useMemo(() => (index ? gearRefs(index, ownGears) : null), [index, ownGears]);
  const line = model ? buildLine(model.build) : '';
  const accepted = (f: SpecModelFact) => reviewByKey.get(keyOf(f)) === 'accepted';
  const kindCount = (kinds: string[]) => facts.filter((f) => kinds.includes(f.kind)).length;
  const reqTotal = requirements && 'items' in requirements ? requirements.total : 0;
  const rulesCount = facts.filter((f) => f.kind === 'constraint' && accepted(f)).length;

  /* Seven tabs, each one question; a tab of two views shows a segment under it. */
  const tabs: { id: TabId; count: number; views: { id: View; count: number }[] }[] = [
    { id: 'entities', count: entities.length, views: [{ id: 'map', count: entities.length }] },
    { id: 'reqs', count: reqTotal, views: [{ id: 'reqs', count: reqTotal }] },
    {
      id: 'need',
      count: kindCount(['problem', 'outcome', 'idea', 'benefit']),
      views: [
        { id: 'needs', count: kindCount(['problem', 'outcome', 'idea']) },
        { id: 'hypotheses', count: kindCount(['benefit']) },
      ],
    },
    {
      id: 'rules',
      count: rulesCount + kindCount(['action']),
      views: [
        { id: 'rules', count: rulesCount },
        { id: 'behaviour', count: kindCount(['action']) },
      ],
    },
    { id: 'priorities', count: 0, views: [{ id: 'priorities', count: 0 }] },
    { id: 'glossary', count: glossary.length, views: [{ id: 'glossary', count: glossary.length }] },
    {
      id: 'sources',
      count: model?.documents.length ?? 0,
      views: [
        { id: 'coverage', count: model?.documents.length ?? 0 },
        { id: 'work', count: work && 'items' in work ? work.total : 0 },
        { id: 'product', count: product && 'items' in product ? product.items.length : 0 },
        { id: 'elsewhere', count: related && 'items' in related ? related.total : 0 },
      ],
    },
  ];
  const tabOf = (v: View): TabId => tabs.find((x) => x.views.some((y) => y.id === v))?.id ?? 'entities';
  const current = tabs.find((x) => x.id === tabOf(view))!;
  const trace = (id: string) => {
    setTraced(id);
    setView('reqs');
  };
  // Opening a passage's document in the editor needs the file's artifact
  // node, which the model does not carry: not carried yet (parity.md).
  const onOpenFile = undefined;

  return (
    <FactReviewContext.Provider value={factReview}>
      <div className={common.stack} data-domain-model>
        <PageHeader
          title={t('title')}
          info={
            <>
              <p>{t('info')}</p>
              <ul>
                {tabs.map((x) => (
                  <li key={x.id}>
                    <b>{t(`tab_${x.id}`)}</b>: {t(`why_${x.id}`)}
                  </li>
                ))}
              </ul>
            </>
          }
          status={
            <>
              {model && <span>{t.count('documents', model.documents.length)}</span>}
              {line && (
                <StatusChip tone={running ? 'running' : model?.build.error ? 'danger' : 'ok'} data-build-line="">
                  {line}
                </StatusChip>
              )}
              {model && running && model.build.documents > 0 && model.build.done < model.build.documents && (
                <span className={styles.progress} data-build-progress>
                  <progress value={readFraction(model.build)} max={1} />
                  {etaLabel(model.build, readAt)}
                </span>
              )}
            </>
          }
          actions={
            <Button
              type="button"
              disabled={running || starting || model?.documents.length === 0}
              onClick={() => void startBuild()}
              title={
                t('build_title') +
                (estimate && estimate.documents > 0
                  ? ` (${tokensLabel(estimate.input_tokens)}; ${estimate.measured ? t('timed_earlier') : t('first_guess')})`
                  : '')
              }
              data-build-button
            >
              {running
                ? t('building')
                : estimate && estimate.documents > 0
                  ? t('build_estimate', { estimate: estimateLabel(estimate) })
                  : t('build')}
            </Button>
          }
        />

        <Segmented
          label={t('title')}
          value={current.id}
          onChange={(id) => setView(tabs.find((x) => x.id === id)!.views[0].id)}
          items={tabs.map((x) => ({ id: x.id, label: t(`tab_${x.id}`), title: t(`why_${x.id}`), count: x.count }))}
        />
        {current.views.length > 1 && (
          <Segmented
            role="group"
            label={t('views')}
            value={view}
            onChange={setView}
            items={current.views.map((v) => ({ id: v.id, label: t(`view_${v.id}`), count: v.count }))}
          />
        )}

        {error && <ErrorLine>{error}</ErrorLine>}
        {!model && !error && <Loading>{t('loading')}</Loading>}
        {model && unreadNote(model) && <Hint data-unread={model.unread_documents ?? 0}>{unreadNote(model)}</Hint>}

        {model && view === 'map' && (
          <EntitiesView entities={entities} onOpenFile={onOpenFile} onSave={saveEntity} saved={writes} gears={gears} />
        )}
        {view === 'reqs' && (
          <RequirementsView
            read={requirements}
            traces={traces}
            work={work}
            selected={traced}
            onSelect={setTraced}
            onOpenFile={onOpenFile}
          />
        )}
        {model && view === 'needs' && (
          <NeedsScreen
            facts={facts}
            onOpenFile={onOpenFile}
            readStopped={model.build.error}
            accepted={accepted}
            onAddMaterial={
              workspaceId
                ? async (title, content) => {
                    const doc = await dmApi.createProjectDocument(workspaceId, projectId, {
                      type_key: 'material',
                      title,
                      content: materialDocument(title, content),
                    });
                    // Read at once, on the key of whoever added it: no separate start.
                    await startBuild(`studio:${doc.id}`);
                  }
                : undefined
            }
            onPropose={(content) =>
              dmApi.proposeSpecModelFile(projectId, 'docs/discovery.md', content, 'the need as accepted in Studio')
            }
            requirements={
              requirements && 'items' in requirements
                ? requirements.items.filter((r) => ['fr', 'usecase', 'flow'].includes((r.kind ?? '').toLowerCase()))
                : []
            }
          />
        )}
        {model && view === 'hypotheses' && (
          <HypothesesScreen
            facts={facts}
            stateOf={(f) => (evidence.get(keyOf(f)) as EvidenceState | undefined) ?? 'unchecked'}
            onEvidence={recordEvidence}
            catalogue={methods}
            kitNote={kitMethods?.note}
            checkOf={(h) => checks.get(keyOf(h.fact))}
            onSaveCheck={saveCheck}
            onPropose={(content) =>
              dmApi.proposeSpecModelFile(projectId, 'docs/hypotheses.md', content, 'the hypotheses and their checks')
            }
            onOpenFile={onOpenFile}
          />
        )}
        {model && view === 'rules' && <RulesScreen facts={facts} accepted={accepted} onOpenFile={onOpenFile} />}
        {model && view === 'behaviour' && (
          <BehaviourScreen
            facts={facts}
            rules={facts.filter((f) => f.kind === 'constraint' && f.status === 'active' && accepted(f)).map(readRule)}
            decisionOf={(key) => decisions.get(key)}
            onExclude={(o: Obligation, reason) =>
              recordDecision(o.key, reason === null ? 'proposed' : 'excluded', reason, o.from.source.path)
            }
            onOpenFile={onOpenFile}
          />
        )}
        {view === 'priorities' && (
          <PrioritiesScreen
            read={requirements}
            projectId={projectId}
            reviews={reviews}
            claimsFor={(r) =>
              hypothesesFor(r, hypotheses).map((h) => ({
                claim: h.solution || h.effect || h.fact.subject,
                state: (evidence.get(keyOf(h.fact)) as EvidenceState | undefined) ?? 'unchecked',
                methods: checks.get(keyOf(h.fact))?.methods ?? [],
              }))
            }
            onSave={async (items) => {
              await dmApi.reviewSpecModelFacts(projectId, items);
              await rereadReviews();
            }}
            onConfirm={(content) =>
              dmApi.proposeSpecModelFile(projectId, 'docs/priorities.md', content, 'the priorities as confirmed in Studio')
            }
            onTrace={trace}
          />
        )}
        {view === 'elsewhere' && (
          <Elsewhere
            read={related}
            onOpenFile={onOpenFile}
            decisionOf={(r) => decisions.get(relatedKey(r))?.state}
            onDecide={(r, state) => recordDecision(relatedKey(r), state, null, r.defined_in.path)}
          />
        )}
        {model && view === 'glossary' && (
          <GlossaryScreen
            entries={glossary}
            entities={entities}
            onDecide={decideTerm}
            onProposeRename={(from, to) => dmApi.proposeGlossaryRename(projectId, from, to)}
            onProposeSentence={(sentence) => dmApi.proposeSpecModelSentence(projectId, sentence)}
            onDistinct={(a, b) =>
              dmApi.decideGlossaryDistinct(projectId, a, b).catch((e: unknown) => setError(errText(e)))
            }
            onOpenFile={onOpenFile}
            revisions={revisions}
            onLoadDocument={loadGlossaryDocument}
            onProposeDocument={(rows) => dmApi.proposeGlossaryDocument(projectId, rows)}
          />
        )}
        {view === 'work' && <Work read={work} onOpenFile={onOpenFile} />}
        {view === 'product' && (
          <AgainstTheCode read={product} onOpenFile={onOpenFile} onOpenProduct={() => openScreen(bridge, PRODUCT_ROUTE)} />
        )}
        {view === 'coverage' && (
          <Uploads
            read={uploads}
            onUpload={async (name, content) => {
              await dmApi.uploadSpecModelSource(projectId, name, content);
              await rereadUploads();
              await load();
            }}
            onRemove={async (u) => {
              try {
                await dmApi.removeSpecModelUpload(projectId, u.id);
                await rereadUploads();
                await load();
              } catch (e) {
                setError(errText(e));
              }
            }}
          />
        )}
        {model && view === 'coverage' && (
          <Coverage model={model} busy={running || starting} onRebuild={(path) => void startBuild(path)} />
        )}
      </div>
    </FactReviewContext.Provider>
  );
}
