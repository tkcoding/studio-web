/**
 * Project domain model › Sources (the prototype's `Coverage`, `Work`, `AgainstTheCode`
 * and `Elsewhere` in spec-model-tab.tsx): which documents were read, the
 * work that names what they define, the documents against the code, and
 * what other projects of the organization require alike.
 */

import { Button } from '@gears-frontx/ui-kit';
import { useState } from 'react';
import {
  coverageCounts,
  orderRelated,
  readAtLabel,
  RELATION_LABEL,
  ruleLabel,
  workLabel,
  workState,
  type ProductFinding,
  type RelatedRequirement,
  type RelatedRequirements,
  type SpecModel,
  type SpecModelUpload,
  type SpecModelUploads,
  type WorkLinks,
  UPLOAD_ACCEPT,
  uploadRefusal,
} from '../../model/spec-model';
import { useSourcesTranslations } from '../../i18n';
import { DataTable } from '../common/DataTable';
import { Prose, SideLink, type OpenFile } from '../common/facts';
import { EmptyState, ErrorLine, Hint, Loading } from '../common/ui';
import common from '../common/common.module.css';
import styles from './sources.module.css';

/** The product findings as read, or why they could not be. */
export type ProductRead = { repo: string | null; items: ProductFinding[] } | { error: string };

/** A match across projects as its decision is kept. */
export const relatedKey = (r: RelatedRequirement) => `rel:${r.id}|${r.other_project_id}|${r.other_id}`;

const MATCH_DECISIONS = ['reuse', 'coordinate', 'separate', 'unrelated'] as const;

export function AgainstTheCode({
  read,
  onOpenFile,
  onOpenProduct,
}: {
  read: ProductRead | null;
  onOpenFile?: OpenFile;
  /** Opens the project's Product tab, where a gear is chosen for a capability. */
  onOpenProduct?: () => void;
}) {
  const { t } = useSourcesTranslations();
  if (!read) return <Loading>{t('loading')}</Loading>;
  if ('error' in read) return <ErrorLine>{read.error}</ErrorLine>;
  if (!read.repo) return <EmptyState title={t('no_code_title')} body={t('no_code_body')} />;
  if (read.items.length === 0)
    return <EmptyState title={t('nothing_missing_title')} body={t('nothing_missing_body', { repo: read.repo })} />;
  return (
    <div className={common.stack}>
      <Hint>
        {t('against_code_hint', { repo: read.repo })}{' '}
        {onOpenProduct ? (
          <button type="button" className={common.link} onClick={onOpenProduct}>
            {t('decide_in_product')}
          </button>
        ) : (
          t('decide_in_product')
        )}
      </Hint>
      <div className={common.card}>
        <DataTable<ProductFinding>
          list="dm-against-code"
          urlPrefix="code."
          rows={read.items}
          rowKey={(f) => f.fingerprint}
          rowLabel={(f) => f.capability}
          pageSize={20}
          search={{ placeholder: t('search_capabilities') }}
          searchText={(f) => [f.capability, f.message, f.gear]}
          empty={{ title: t('nothing_matches') }}
          columns={[
            {
              id: 'sev',
              header: t('col_severity'),
              cell: (f) => <span className={`${common.sev} ${common[`sev_${f.severity}`] ?? ''}`}>{f.severity}</span>,
            },
            { id: 'rule', header: t('col_what'), cell: (f) => ruleLabel(f.rule) },
            {
              id: 'cap',
              header: t('col_capability'),
              compare: (a, b) => a.capability.localeCompare(b.capability),
              cell: (f) => <code>{f.capability}</code>,
            },
            { id: 'docs', header: t('col_documents'), num: true, cell: (f) => f.sides.length },
          ]}
          expand={(f) => (
            <div className={common.stack}>
              <p className={common.muted}>
                <Prose text={f.message} />
              </p>
              <div className={f.sides.length === 2 ? styles.two : common.stack}>
                {f.sides.slice(0, 6).map((sd, k) => (
                  <SideLink
                    key={k}
                    side={{ path: sd.path, quote: sd.quote }}
                    onOpenFile={sd.kind === 'file' ? onOpenFile : undefined}
                  />
                ))}
                {f.sides.length > 6 && <Hint>{t('more_documents', { n: f.sides.length - 6 })}</Hint>}
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}

/** The issues, pull requests and commits that name an identifier the
 *  documents define, by identifier. A link is made only by the work naming
 *  the identifier; nothing is guessed. */
export function Work({ read, onOpenFile }: { read: WorkLinks | { error: string } | null; onOpenFile?: OpenFile }) {
  const { t } = useSourcesTranslations();
  if (read === null) return <Loading>{t('loading')}</Loading>;
  if ('error' in read) return <ErrorLine>{read.error}</ErrorLine>;
  if (!read.synced) return <EmptyState title={t('no_work_title')} body={t('no_work_body')} />;
  if (read.items.length === 0) {
    return (
      <EmptyState
        title={t('work_names_none_title')}
        body={read.identifiers === 0 ? t('work_no_identifiers') : t('work_names_none', { n: read.identifiers })}
      />
    );
  }
  return (
    <div className={common.stack}>
      <Hint>
        {t('work_summary', { identifiers: read.identifiers, total: read.total, unlinked: read.unlinked, work: read.work })}
      </Hint>
      <div className={common.card}>
        <DataTable<WorkLinks['items'][number]>
          list="dm-work"
          urlPrefix="work."
          rows={read.items}
          rowKey={(l) => l.id}
          rowLabel={(l) => l.id}
          pageSize={20}
          search={{ placeholder: t('search_work') }}
          searchText={(l) => [l.id, ...l.work.map((w) => w.title)]}
          empty={{ title: t('nothing_matches') }}
          columns={[
            {
              id: 'id',
              header: t('col_identifier'),
              compare: (a, b) => a.id.localeCompare(b.id),
              cell: (l) => <code>{l.id}</code>,
            },
            { id: 'where', header: t('col_defined_in'), cell: (l) => <SideLink side={l.defined_in} onOpenFile={onOpenFile} /> },
            {
              id: 'work',
              header: t('col_work'),
              num: true,
              compare: (a, b) => a.work.length - b.work.length,
              cell: (l) => l.work.length,
            },
            {
              id: 'latest',
              header: t('col_named_by'),
              cell: (l) => (
                <span className={common.muted}>
                  {l.work
                    .slice(0, 2)
                    .map((w) => workLabel(w))
                    .join(', ')}
                  {l.work.length > 2 ? ' …' : ''}
                </span>
              ),
            },
          ]}
          expand={(l) => (
            <ul className={styles.workItems}>
              {l.work.map((w, k) => (
                <li key={k}>
                  {w.url ? (
                    <a href={w.url} target="_blank" rel="noreferrer">
                      {workLabel(w)}
                    </a>
                  ) : (
                    <span>{workLabel(w)}</span>
                  )}{' '}
                  <span className={common.muted}>{w.title}</span>{' '}
                  {workState(w) && <span className={common.status}>{workState(w)}</span>}
                </li>
              ))}
            </ul>
          )}
        />
      </div>
    </div>
  );
}

/** What other projects of the organization require that reads like this
 *  project's requirements: the same, overlapping, or the opposite. A list of
 *  candidates to read side by side; nothing is decided here unless a member
 *  records it. */
export function Elsewhere({
  read,
  onOpenFile,
  decisionOf,
  onDecide,
}: {
  read: RelatedRequirements | { error: string } | null;
  onOpenFile?: OpenFile;
  decisionOf?: (r: RelatedRequirement) => string | undefined;
  onDecide?: (r: RelatedRequirement, state: string) => Promise<void>;
}) {
  const { t } = useSourcesTranslations();
  if (read === null) return <Loading>{t('comparing')}</Loading>;
  if ('error' in read) return <ErrorLine>{read.error}</ErrorLine>;
  if (read.items.length === 0) {
    return (
      <EmptyState
        title={t('nothing_similar_title')}
        body={read.projects === 0 ? t('no_other_project') : t.count('nothing_similar', read.projects)}
      />
    );
  }
  const label = (state: string) => (MATCH_DECISIONS.includes(state as never) ? t(`decision_${state}`) : state);
  return (
    <div className={common.stack}>
      <Hint>{t.count(read.truncated ? 'compared_first' : 'compared', read.projects)}</Hint>
      <div className={common.card}>
        <DataTable<RelatedRequirement>
          list="dm-elsewhere"
          urlPrefix="else."
          rows={orderRelated(read.items)}
          rowKey={(r) => relatedKey(r)}
          rowLabel={(r) => r.id}
          pageSize={20}
          search={{ placeholder: t('search_requirements') }}
          searchText={(r) => [r.id, r.text, r.other_id, r.other_text, r.other_project_name]}
          filters={[
            {
              id: 'relation',
              allLabel: t('every_match'),
              kind: 'chips',
              options: (['opposite', 'same', 'overlap'] as const).map((x) => ({ value: x, label: RELATION_LABEL[x] })),
              match: (r, v) => r.relation === v,
            },
            {
              id: 'project',
              allLabel: t('every_project'),
              kind: 'select',
              options: [...new Set(read.items.map((r) => r.other_project_name))].sort().map((x) => ({ value: x, label: x })),
              match: (r, v) => r.other_project_name === v,
            },
          ]}
          empty={{ title: t('nothing_matches') }}
          columns={[
            {
              id: 'relation',
              header: t('col_match'),
              cell: (r) => (
                <span className={common.status} data-relation={r.relation}>
                  {RELATION_LABEL[r.relation]} · {Math.round(r.score * 100)}%
                </span>
              ),
            },
            {
              id: 'ours',
              header: t('col_ours'),
              cell: (r) => (
                <span>
                  <code>{r.id}</code>{' '}
                  <span className={common.muted}>
                    {r.text.slice(0, 90)}
                    {r.text.length > 90 ? '…' : ''}
                  </span>
                </span>
              ),
            },
            {
              id: 'theirs',
              header: t('col_theirs'),
              cell: (r) => (
                <span>
                  <code>{r.other_id}</code> <span className={common.muted}>{r.other_project_name}</span>
                </span>
              ),
            },
            {
              id: 'decision',
              header: t('col_decision'),
              cell: (r) => {
                const d = decisionOf?.(r);
                return d ? label(d) : <span className={common.muted}>—</span>;
              },
            },
          ]}
          expand={(r) => (
            <div className={common.stack}>
              <div className={styles.two}>
                <div>
                  <code>{r.id}</code> <SideLink side={r.defined_in} onOpenFile={onOpenFile} />
                  <div className={common.muted}>{r.text}</div>
                </div>
                <div>
                  <code>{r.other_id}</code>{' '}
                  <span className={common.status}>
                    {r.other_workspace_name} / {r.other_project_name}
                  </span>{' '}
                  <span className={common.muted}>
                    {r.other_defined_in.path}:{r.other_defined_in.line_start}
                  </span>
                  <div className={common.muted}>{r.other_text}</div>
                </div>
              </div>
              <div className={common.small}>{t('shared', { words: r.shared.join(', ') })}</div>
              {onDecide && (
                <div className={common.actions}>
                  {MATCH_DECISIONS.map((d) => (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      title={t(`decision_${d}_why`)}
                      variant={decisionOf?.(r) === d ? 'default' : 'ghost'}
                      aria-pressed={decisionOf?.(r) === d}
                      onClick={() => void onDecide(r, decisionOf?.(r) === d ? 'proposed' : d)}
                    >
                      {t(`decision_${d}`)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        />
      </div>
    </div>
  );
}

/** CSV, JSON and plain-text sources uploaded for the model to read, kept
 *  out of the repository: upload one, see each, remove one. */
export function Uploads({
  read,
  onUpload,
  onRemove,
}: {
  read: SpecModelUploads | { error: string } | null;
  /** Keep the file's text as an upload; rejects with the server's reason. */
  onUpload: (name: string, content: string) => Promise<void>;
  onRemove: (upload: SpecModelUpload) => Promise<void>;
}) {
  const { t } = useSourcesTranslations();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const refused = uploadRefusal(file.name, file.size);
    if (refused) {
      setProblem(t(refused === 'type' ? 'upload_wrong_type' : 'upload_too_large', { name: file.name }));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onUpload(file.name, await file.text());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={common.stack}>
      <Hint>{t('uploads_hint')}</Hint>
      <div className={common.actions}>
        <label className={styles.uploadPick}>
          <input
            type="file"
            accept={UPLOAD_ACCEPT}
            disabled={busy}
            aria-label={t('upload_pick')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void pick(file);
            }}
          />
          <span>{busy ? t('uploading') : t('upload_pick')}</span>
        </label>
      </div>
      {problem && <ErrorLine>{problem}</ErrorLine>}
      {read === null ? (
        <Loading>{t('loading')}</Loading>
      ) : 'error' in read ? (
        <ErrorLine>{read.error}</ErrorLine>
      ) : read.items.length === 0 ? (
        <EmptyState title={t('no_uploads_title')} body={t('no_uploads_body')} />
      ) : (
        <div className={common.card}>
          <DataTable<SpecModelUpload>
            list="dm-uploads"
            urlPrefix="up."
            rows={read.items}
            rowKey={(u) => u.id}
            rowLabel={(u) => u.name}
            pageSize={20}
            empty={{ title: t('nothing_matches') }}
            columns={[
              { id: 'name', header: t('col_document'), cell: (u) => <code className={common.code}>{u.path}</code> },
              { id: 'kind', header: t('col_kind'), cell: (u) => u.kind },
              { id: 'size', header: t('col_size'), num: true, cell: (u) => `${Math.max(1, Math.round(u.size / 1024))} KiB` },
              { id: 'revision', header: t('col_revision'), cell: (u) => <code className={common.code}>{u.revision.slice(0, 7)}</code> },
            ]}
            actions={(u) => [{ label: t('upload_remove'), disabled: busy, onSelect: () => void onRemove(u) }]}
          />
        </div>
      )}
    </div>
  );
}

/** Which documents have been read and at which revision; rebuild from one. */
export function Coverage({
  model,
  busy,
  onRebuild,
}: {
  model: SpecModel;
  /** A build is running or starting: no second one. */
  busy: boolean;
  /** Read one document again, replacing only its facts. */
  onRebuild: (path: string) => void;
}) {
  const { t } = useSourcesTranslations();
  const counts = coverageCounts(model.documents);
  const stateLabel = (st: string) =>
    st === 'extracted' ? t('state_read') : st === 'pending' ? t('state_never') : st === 'kept' ? t('state_kept') : st;
  return (
    <div className={common.stack}>
      <Hint>{t('coverage_hint', counts)}</Hint>
      <div className={common.card}>
        <DataTable<SpecModel['documents'][number]>
          list="dm-documents"
          urlPrefix="doc."
          rows={model.documents}
          rowKey={(d) => d.path}
          rowLabel={(d) => d.path}
          pageSize={20}
          search={{ placeholder: t('search_documents') }}
          searchText={(d) => [d.path]}
          filters={[
            {
              id: 'state',
              allLabel: t('every_state'),
              kind: 'chips',
              options: (['extracted', 'kept', 'stale', 'failed', 'pending'] as const)
                .filter((st) => counts[st] > 0)
                .map((st) => ({ value: st, label: stateLabel(st) })),
              match: (d, v) => d.state === v,
            },
          ]}
          empty={{ title: t('no_documents') }}
          columns={[
            {
              id: 'path',
              header: t('col_document'),
              compare: (a, b) => a.path.localeCompare(b.path),
              cell: (d) => <code className={common.code}>{d.path}</code>,
            },
            {
              id: 'state',
              header: t('col_state'),
              cell: (d) => (
                <span className={common.status} data-doc-state={d.state} title={d.error ?? (d.state === 'kept' ? t('kept_title') : undefined)}>
                  {d.state}
                </span>
              ),
            },
            {
              id: 'read_at',
              header: t('col_read_at'),
              cell: (d) => {
                const at = readAtLabel(d);
                return at ? (
                  <code className={common.code} title={d.source_commit ?? undefined}>
                    {at}
                  </code>
                ) : (
                  <span className={common.muted}>—</span>
                );
              },
            },
            { id: 'facts', header: t('col_facts'), num: true, compare: (a, b) => a.facts - b.facts, cell: (d) => d.facts },
            {
              id: 'dropped',
              header: t('col_dropped'),
              num: true,
              compare: (a, b) => a.dropped - b.dropped,
              cell: (d) => d.dropped,
            },
          ]}
          actions={(d) => [{ label: t('rebuild_from'), disabled: busy, onSelect: () => onRebuild(d.path) }]}
        />
      </div>
    </div>
  );
}
