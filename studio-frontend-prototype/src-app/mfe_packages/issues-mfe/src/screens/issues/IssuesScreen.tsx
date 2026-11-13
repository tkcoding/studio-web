/**
 * Project › Issues — the Issues kit (ADR-0068 §7, ADR-0069 §5), the
 * prototype's Issues tab carried over (`SpecModelTab only="issues"` and
 * `ResolveView`, spec-model-tab.tsx and domain-model-screens.tsx at
 * 00828880): everything to decide about the project in one table — what stops
 * a build, what to look at, how the documentation could be better, what was
 * decided — with a verdict line over it and the model's build in the header.
 *
 * The queue, its groups and the actions each row offers come from the server
 * (`GET /project-domain-model/issues`), and so does whether anything stops a build
 * (`GET /project-domain-model/readiness`), and so do the documentation's thin
 * places with the change each proposes (`GET /project-domain-model/doc-quality`,
 * over the facts members did not reject); the prototype computed all three in
 * the browser. A row whose entity was saved on this screen is hidden until a
 * build reads the document again.
 */

import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  apiRegistry,
  useSharedProperty,
  FRONTX_SCREEN_DOMAIN,
  FRONTX_SHARED_PROPERTY_THEME,
} from '@gears-frontx/react';
import {
  Badge,
  Button,
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
import {
  sendToHost,
  STUDIO_ACTION_ARTIFACT_OPEN,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  useOrganization,
} from '@constructor-studio/mfe-shared';
import { IssuesApiService } from '../../api/IssuesApiService';
import type {
  DocQualityRow,
  NewIssue,
  SpecModelEntityEdit,
  SpecModelIssueRow,
  SpecModelIssueRowList,
  SpecModelReadiness,
  ServedSpecModel,
} from '../../api/types';
import { estimateLabel, etaLabel, readFraction, tokensLabel, type SpecModelBuildEstimate } from '../../model/build-eta';
import { GROUP_ORDER, issueRows, withoutSaved, type IssueRow, type RowGroup } from '../../model/issue-rows';
import { pruneSaved, withSaved, type SavedEdit } from '../../model/saved-entities';
import { buildLine, unreadNote } from '../../model/spec-model';
import { useIssuesTranslations } from '../../i18n';
import { DocItem, IssueForm, Prose, QueueItem, type Text } from './IssueItems';
import styles from './IssuesScreen.module.css';

const DARK_HOST_THEMES = ['dark', 'dracula', 'dracula-large'];
const POLL_MS = 3000;
const PAGE_SIZE = 20;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Person = { name: string; login: string };

/** The project and workspace in scope, from the shell's shared properties. */
function useScope(): { projectId: string | null; workspaceId: string | null } {
  const project = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);
  const workspace = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE) as { id?: string } | null;
  return {
    projectId: typeof project === 'string' && project ? project : null,
    workspaceId: workspace && typeof workspace.id === 'string' ? workspace.id : null,
  };
}

export const IssuesScreen: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const theme = useSharedProperty(FRONTX_SHARED_PROPERTY_THEME);
  const { t, loading } = useIssuesTranslations();
  const { projectId, workspaceId } = useScope();
  const { org } = useOrganization();

  return (
    <div
      className={styles.screen}
      data-theme={typeof theme === 'string' && DARK_HOST_THEMES.includes(theme) ? 'dark' : 'light'}
    >
      {loading ? (
        <Skeleton className={styles.skeleton} />
      ) : !projectId ? (
        <p className={styles.muted}>{t('no_project')}</p>
      ) : (
        // Keyed by the scope: another project is another read, from nothing.
        <ProjectIssues
          key={`${projectId}:${workspaceId ?? ''}`}
          projectId={projectId}
          orgId={org?.id ?? null}
          t={t}
          onOpenFile={(path) =>
            sendToHost(bridge, {
              type: STUDIO_ACTION_ARTIFACT_OPEN,
              target: FRONTX_SCREEN_DOMAIN,
              payload: { projectId, artifactId: path, repository: '', path, kind: 'file' },
            })
          }
        />
      )}
    </div>
  );
};

IssuesScreen.displayName = 'IssuesScreen';

interface Read {
  model: ServedSpecModel;
  queue: SpecModelIssueRowList;
  readiness: SpecModelReadiness;
  /** The documentation's thin places; empty from a backend before the route. */
  better: DocQualityRow[];
}

/** A backend from before the doc-quality route answers 404: the queue still shows. */
const noRows = { items: [] as DocQualityRow[], total: 0, by_kind: {} };

type SortBy = { column: 'kind' | 'group'; desc: boolean } | null;

function ProjectIssues({
  projectId,
  orgId,
  t,
  onOpenFile,
}: {
  projectId: string;
  orgId: string | null;
  t: Text;
  onOpenFile: (path: string) => void;
}) {
  const api = useMemo(() => apiRegistry.getService(IssuesApiService), []);
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Entities saved this visit: their rows stay hidden until a build reads them. */
  const [saved, setSaved] = useState<SavedEdit[]>([]);
  const [estimate, setEstimate] = useState<SpecModelBuildEstimate | null>(null);
  const [starting, setStarting] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  /** When the screen last read: the build's ETA is counted from it, never from render. */
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const [model, queue, readiness, better] = await Promise.all([
        api.model({ projectId }).fetch({ staleTime: 0 }),
        api.issues(projectId),
        api.readiness({ projectId }).fetch({ staleTime: 0 }),
        api.docQuality(projectId).catch(() => noRows),
      ]);
      setRead({ model, queue, readiness, better: better.items });
      setSaved((s) => pruneSaved(s, model.build));
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api, projectId]);

  // The first read starts after the effect: every state it sets comes from its answers.
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // While a build runs, read again until it stops: the build is in the
  // backend's process, and nothing pushes its progress.
  const running = read?.model.build.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  // What the next build would read and how long it should take, read again
  // whenever a build stops. An older backend answers 404: no estimate shown.
  useEffect(() => {
    if (running) return;
    let live = true;
    api
      .buildEstimate({ projectId })
      .fetch({ staleTime: 0 })
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [api, projectId, running]);

  // Who an issue can go to: the organization's members with a GitHub login
  // among their confirmed or claimed accounts.
  useEffect(() => {
    if (!orgId) return;
    let live = true;
    api
      .orgMembers(orgId)
      .then((members) =>
        Promise.all(
          members.slice(0, 50).map((m) =>
            api
              .memberIdentities({ orgId, userId: m.user_id })
              .fetch({ staleTime: 0 })
              .then((ids) => {
                const gh = ids.aliases.find((a) => a.kind === 'github' && a.confidence !== 'suggested');
                return gh ? { name: m.display_name || m.email || gh.external_id, login: gh.external_id } : null;
              })
              .catch(() => null)
          )
        )
      )
      .then((list) => live && setPeople(list.filter((p): p is Person => !!p)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, orgId]);

  const startBuild = async () => {
    setStarting(true);
    try {
      await api.startBuild.fetch({ project_id: projectId });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setStarting(false);
    }
  };

  /** The rows and the verdict again: a decision or an opened issue changes them on the server. */
  const reloadQueue = async () => {
    const [queue, readiness, better] = await Promise.all([
      api.issues(projectId),
      api.readiness({ projectId }).fetch({ staleTime: 0 }),
      api.docQuality(projectId).catch(() => noRows),
    ]);
    setRead((r) => (r ? { ...r, queue, readiness, better: better.items } : r));
  };

  const decide = async (item: SpecModelIssueRow, decision: 'confirmed' | 'dismissed') => {
    if (!item.fingerprint) return;
    try {
      await api.decideFinding(item.fingerprint).fetch({ project_id: projectId, decision });
      await reloadQueue();
    } catch (e) {
      setError(message(e));
    }
  };

  const saveEntity = async (edit: SpecModelEntityEdit) => {
    const write = await api.saveEntity(projectId).fetch(edit);
    setSaved((s) => withSaved(s, { edit, write, at: Date.now() }));
    return write;
  };

  const sameThing = async (alias: string, of: string) => {
    try {
      await api.decideGlossaryEntry.fetch({ project_id: projectId, key: alias, name: null, alias_of: of });
      await reloadQueue();
    } catch (e) {
      setError(message(e));
    }
  };

  const createIssue = async (key: string, issue: NewIssue) => {
    const made = await api.createIssue.fetch({ project_id: projectId, ...issue });
    if (made.url) {
      try {
        await api.review.fetch({
          project_id: projectId,
          items: [{ fact_key: `iss:${key}`, state: 'opened', path: '', revision: '', note: made.url }],
        });
        await reloadQueue();
      } catch (e) {
        setError(message(e));
      }
    }
    return made;
  };

  const model = read?.model ?? null;
  // Kept apart from the readiness: a thin passage does not stop a build.
  const better = useMemo(() => withoutSaved(read?.better ?? [], saved), [read, saved]);
  const rows = useMemo(() => issueRows(read?.queue.items ?? [], better), [read, better]);
  const issueOf = (r: IssueRow): string | null => r.queue?.issue_url ?? r.doc?.issue_url ?? null;

  const line = model ? buildLine(model.build) : '';
  const note = model ? unreadNote(model) : null;
  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title} title={t('about')}>
          {t('title')}
        </h2>
        <div className={styles.chips} data-issues-status>
          {model && <span className={styles.muted}>{t.count('documents', model.documents.length)}</span>}
          {line && (
            <Badge variant={running ? 'info' : model?.build.error ? 'danger' : 'success'} data-build-line>
              {line}
            </Badge>
          )}
          {model && running && model.build.documents > 0 && model.build.done < model.build.documents && (
            <span className={styles.progress} data-build-progress>
              <progress value={readFraction(model.build)} max={1} />
              {etaLabel(model.build, now)}
            </span>
          )}
        </div>
        <Button
          className={styles.build}
          disabled={running || starting || model?.documents.length === 0}
          onClick={() => void startBuild()}
          title={
            t('build_title') +
            (estimate && estimate.documents > 0
              ? ` (${tokensLabel(estimate.input_tokens)}; ${estimate.measured ? t('build_timed') : t('build_guess')})`
              : '')
          }
        >
          {running
            ? t('building')
            : estimate && estimate.documents > 0
              ? t('build_on_key_estimate', { estimate: estimateLabel(estimate) })
              : t('build_on_key')}
        </Button>
      </header>
      <p className={styles.about}>{t('about')}</p>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!read && !error && <p className={styles.muted}>{t('loading')}</p>}
      {note && (
        <p className={styles.hint} data-no-documentation data-unread={model?.unread_documents ?? 0}>
          {note}
        </p>
      )}

      {read && (
        <IssuesTable
          rows={rows}
          readiness={read.readiness}
          built={read.model.facts.length > 0}
          people={people}
          issueOf={issueOf}
          t={t}
          onDecide={decide}
          onPropose={(item) => api.proposeFix(projectId, item.fingerprint ?? '').fetch()}
          onSave={saveEntity}
          onSameThing={sameThing}
          onProposeSentence={(s) => api.proposeSentence(projectId).fetch(s)}
          onCreateIssue={createIssue}
          onOpenFile={onOpenFile}
        />
      )}
    </>
  );
}

function IssuesTable({
  rows,
  readiness,
  built,
  people,
  issueOf,
  t,
  onDecide,
  onPropose,
  onSave,
  onSameThing,
  onProposeSentence,
  onCreateIssue,
  onOpenFile,
}: {
  rows: IssueRow[];
  readiness: SpecModelReadiness;
  built: boolean;
  people: Person[];
  issueOf: (r: IssueRow) => string | null;
  t: Text;
  onDecide: React.ComponentProps<typeof QueueItem>['onDecide'];
  onPropose: React.ComponentProps<typeof QueueItem>['onPropose'];
  onSave: React.ComponentProps<typeof DocItem>['onSave'];
  onSameThing: React.ComponentProps<typeof DocItem>['onSameThing'];
  onProposeSentence: React.ComponentProps<typeof DocItem>['onProposeSentence'];
  onCreateIssue: (key: string, issue: NewIssue) => Promise<unknown>;
  onOpenFile: (path: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<RowGroup | ''>('');
  const [kind, setKind] = useState('');
  const [doc, setDoc] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortBy>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const kindLabel = (r: IssueRow) => t(`kind_${r.kindId}`);
  const n = (g: RowGroup) => rows.filter((r) => r.group === g).length;
  const kinds = [...new Set(rows.map(kindLabel))].sort();
  const docs = [...new Set(rows.map((r) => r.side?.path).filter((p): p is string => !!p))].sort();

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (!group || r.group === group) &&
        (!kind || t(`kind_${r.kindId}`) === kind) &&
        (!doc || r.side?.path === doc) &&
        (!words ||
          [r.title, t(`kind_${r.kindId}`), r.side?.path].some((s) => (s ?? '').toLowerCase().includes(words)))
    );
    if (!sort) return out;
    const cmp =
      sort.column === 'kind'
        ? (a: IssueRow, b: IssueRow) => t(`kind_${a.kindId}`).localeCompare(t(`kind_${b.kindId}`))
        : (a: IssueRow, b: IssueRow) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return [...out].sort((a, b) => (sort.desc ? -cmp(a, b) : cmp(a, b)));
  }, [rows, search, group, kind, doc, sort, t]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const pageRows = shown.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE);
  const sortBy = (column: 'kind' | 'group') =>
    setSort((s) => (s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }));
  const arrow = (column: 'kind' | 'group') => (sort?.column === column ? (sort.desc ? ' ↓' : ' ↑') : '');
  const filter = (set: () => void) => {
    set();
    setPage(0);
  };

  return (
    <div className={styles.resolve}>
      <div className={styles.verdict} data-verdict>
        <b className={readiness.ready ? styles.ok : styles.bad}>
          {readiness.ready ? t('verdict_ready') : t.count('verdict_blocking', readiness.blocking)}
        </b>
        <span className={styles.muted}>
          {' · '}
          {t('verdict_rest', { look: n('look'), improve: n('improve') })}
          {readiness.total > 0 ? ` · ${t('verdict_cited', { cited: readiness.cited, total: readiness.total })}` : ''}
        </span>
        {!built && <span className={styles.muted}> · {t('verdict_not_built')}</span>}
      </div>

      <div className={styles.toolbar}>
        <Input
          className={styles.search}
          placeholder={t('search')}
          aria-label={t('search')}
          value={search}
          onChange={(e) => filter(() => setSearch(e.target.value))}
        />
        <div className={styles.chips} role="group" aria-label={t('filter_group')}>
          <Button size="sm" variant={group === '' ? 'default' : 'outline'} onClick={() => filter(() => setGroup(''))}>
            {t('group_all')}
          </Button>
          {GROUP_ORDER.filter((g) => n(g) > 0).map((g) => (
            <Button
              key={g}
              size="sm"
              variant={group === g ? 'default' : 'outline'}
              aria-pressed={group === g}
              onClick={() => filter(() => setGroup(g))}
              data-group-chip={g}
            >
              {t(`filter_${g}`)} <span className={styles.count}>{n(g)}</span>
            </Button>
          ))}
        </div>
        <NativeSelect value={kind} onChange={(e) => filter(() => setKind(e.target.value))} aria-label={t('every_kind')}>
          <NativeSelectOption value="">{t('every_kind')}</NativeSelectOption>
          {kinds.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {k}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect value={doc} onChange={(e) => filter(() => setDoc(e.target.value))} aria-label={t('every_document')}>
          <NativeSelectOption value="">{t('every_document')}</NativeSelectOption>
          {docs.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {p}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {shown.length === 0 ? (
        <Empty data-issues-empty>
          <EmptyHeader>
            <EmptyTitle>{rows.length > 0 ? t('nothing_matches') : built ? t('empty_built') : t('empty_unbuilt')}</EmptyTitle>
            {rows.length === 0 && !built && <EmptyDescription>{t('empty_unbuilt_body')}</EmptyDescription>}
          </EmptyHeader>
        </Empty>
      ) : (
        <Table data-issues-table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button type="button" className={styles.sortable} onClick={() => sortBy('kind')}>
                  {t('col_kind')}
                  {arrow('kind')}
                </button>
              </TableHead>
              <TableHead>{t('col_issue')}</TableHead>
              <TableHead>{t('col_where')}</TableHead>
              <TableHead>
                <button type="button" className={styles.sortable} onClick={() => sortBy('group')}>
                  {t('col_status')}
                  {arrow('group')}
                </button>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => {
              const url = issueOf(r);
              const canCreate = !url && (r.queue ? r.queue.actions.includes('create_issue') : true);
              const open = expanded === r.key;
              return (
                <Fragment key={r.key}>
                  <TableRow
                    className={styles.row}
                    data-issue-row={r.key}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : r.key)}
                  >
                    <TableCell>
                      <Badge variant={r.tone === 'bad' ? 'danger' : 'warning'}>{kindLabel(r)}</Badge>
                    </TableCell>
                    <TableCell className={styles.titleCell}>
                      <Prose text={r.title} />
                    </TableCell>
                    <TableCell>
                      {r.side ? (
                        <code className={styles.where} title={r.side.path}>
                          {r.side.path.split('/').pop()}
                          {r.side.line_start ? `:${r.side.line_start}` : ''}
                        </code>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.issueLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t('issue_number', { number: url.split('/').pop() ?? '' })}
                        </a>
                      ) : (
                        <span className={`${styles.muted} ${styles[`status_${r.group}`] ?? ''}`}>{t(`status_${r.group}`)}</span>
                      )}
                    </TableCell>
                    <TableCell className={styles.rowActions}>
                      {canCreate && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpening(opening === r.key ? null : r.key);
                          }}
                        >
                          {t('create_issue')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {opening === r.key && canCreate && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <IssueForm
                          row={r}
                          people={people}
                          t={t}
                          onCancel={() => setOpening(null)}
                          onCreate={(issue) => onCreateIssue(r.key, issue).then((x) => (setOpening(null), x))}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {open && (
                    <TableRow className={styles.detailRow}>
                      <TableCell colSpan={5}>
                        {r.queue ? (
                          <QueueItem
                            item={r.queue}
                            kindLabel={kindLabel(r)}
                            onDecide={onDecide}
                            onPropose={onPropose}
                            onOpenFile={onOpenFile}
                            t={t}
                          />
                        ) : r.doc ? (
                          <DocItem
                            item={r.doc}
                            kindLabel={kindLabel(r)}
                            onSave={onSave}
                            onSameThing={onSameThing}
                            onProposeSentence={onProposeSentence}
                            onOpenFile={onOpenFile}
                            t={t}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      {pages > 1 && (
        <div className={styles.pager}>
          <Button size="sm" variant="outline" disabled={at === 0} onClick={() => setPage(at - 1)}>
            {t('previous')}
          </Button>
          <span className={styles.muted}>{t('page_of', { page: at + 1, pages, count: shown.length })}</span>
          <Button size="sm" variant="outline" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
            {t('next')}
          </Button>
        </div>
      )}
    </div>
  );
}
