/**
 * Workspace › Document types, the prototype's `DocumentTypesTab` and
 * `TypesView` (documents.tsx) carried over (ADR-0069 §5): define a document
 * type once — its template, the sections it must contain, and the rules that
 * make it valid — and every project in the workspace inherits it, so its
 * documents are checked against the same requirements.
 *
 * The list is the workspace's effective types (built-in, the organization's,
 * its own); saving always writes a workspace-owned type, overriding one of the
 * same key it inherits. Beside each type: whether the spec-quality analyser
 * accepts its key, asked of that service rather than restated here.
 */

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@gears-frontx/ui-kit';
import {
  errorMessage,
  refusalText,
  useHostChrome,
  useWorkspace,
  type WorkspaceRef,
} from '@constructor-studio/mfe-shared';
import { DocumentTypesApiService } from '../../api/DocumentTypesApiService';
import type { DocType } from '../../api/types';
import { blankForm, bodyOf, conformance, formOf, formProblem, type SectionRow, type TypeForm } from '../../model/doc-types';
import { useDocumentTypesTranslations } from '../../i18n';
import styles from './DocumentTypesScreen.module.css';

type Text = ReturnType<typeof useDocumentTypesTranslations>['t'];

/** The gear's own words for a refusal, else the error's message. */
const errText = (e: unknown) => refusalText(e) ?? errorMessage(e);

/** `_one` or `_many`, by the count. */
const plural = (t: Text, key: string, count: number, params: Record<string, string | number> = {}) =>
  t(`${key}_${count === 1 ? 'one' : 'many'}`, { count, ...params });

export const DocumentTypesScreen: React.FC = () => {
  const { workspace, loading: wsLoading } = useWorkspace();
  const { containerRef, dataTheme } = useHostChrome();
  const { t, loading } = useDocumentTypesTranslations();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-document-types>
      {loading || wsLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : !workspace ? (
        <p className={styles.muted}>{t('no_workspace')}</p>
      ) : (
        // Keyed by the workspace: another workspace is another read, from nothing.
        <WorkspaceDocTypes key={workspace.id} workspace={workspace} t={t} />
      )}
    </div>
  );
};

DocumentTypesScreen.displayName = 'DocumentTypesScreen';

function WorkspaceDocTypes({ workspace, t }: { workspace: WorkspaceRef; t: Text }) {
  const [types, setTypes] = useState<DocType[]>([]);
  const [err, setErr] = useState<string | null>(null);
  /** The type keys the analyser accepts. null = not read, or it could not say: "unknown", not "none". */
  const [analysable, setAnalysable] = useState<Set<string> | null>(null);
  /** Bumped by every save: the list is read again. */
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    apiRegistry
      .getService(DocumentTypesApiService)
      .types({ workspaceId: workspace.id })
      .fetch({ staleTime: 0 })
      .then((r) => {
        if (!alive) return;
        setTypes(r.items ?? []);
        setErr(null);
      })
      .catch((e: unknown) => alive && setErr(errText(e)));
    return () => {
      alive = false;
    };
  }, [workspace.id, revision]);

  useEffect(() => {
    let alive = true;
    apiRegistry
      .getService(DocumentTypesApiService)
      .capabilities.fetch()
      .then((r) => alive && setAnalysable(new Set(r.doc_types ?? [])))
      // The wrapper answers 500 when the upstream is unreachable or
      // unconfigured: the column says "?" rather than a second red error.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={styles.body}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.about}>{t('about')}</p>
      </header>
      <Flow t={t} />
      {err && (
        <p role="alert" className={styles.error}>
          {err}
        </p>
      )}
      <TypesView
        workspaceId={workspace.id}
        types={types}
        analysable={analysable}
        t={t}
        onSaved={() => setRevision((n) => n + 1)}
      />
    </div>
  );
}

/** The concept in one line: what you define here, and what it enables in projects. */
function Flow({ t }: { t: Text }) {
  const steps = ['type', 'template', 'sections', 'rules'];
  return (
    <div className={styles.flow} data-doc-types-flow>
      {steps.map((s, i) => (
        <Fragment key={s}>
          <div className={styles.flowStep}>
            <span className={styles.flowN}>{i + 1}</span>
            <span className={styles.flowBody}>
              <span className={styles.flowT}>{t(`flow_${s}`)}</span>
              <span className={styles.flowD}>{t(`flow_${s}_hint`)}</span>
            </span>
          </div>
          {i < steps.length - 1 && <span className={styles.flowArrow}>→</span>}
        </Fragment>
      ))}
      <span className={`${styles.flowArrow} ${styles.flowArrowBig}`}>⇒</span>
      <div className={`${styles.flowStep} ${styles.flowOutcome}`}>
        <span className={styles.flowBody}>
          <span className={styles.flowT}>{t('flow_outcome')}</span>
          <span className={styles.flowD}>{t('flow_outcome_hint')}</span>
        </span>
      </div>
    </div>
  );
}

function TypesView({
  workspaceId,
  types,
  analysable,
  t,
  onSaved,
}: {
  workspaceId: string;
  types: DocType[];
  analysable: Set<string> | null;
  t: Text;
  onSaved: () => void;
}) {
  /** The working copy; null until a type is picked or a new one started. */
  const [form, setForm] = useState<TypeForm | null>(null);
  /** The type the form was loaded from, or saved as. */
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accepted = useMemo(() => (analysable ? [...analysable].join(', ') : ''), [analysable]);

  const pick = (type: DocType) => {
    setSelected(type.key);
    setForm(formOf(type));
    setErr(null);
  };
  const blank = () => {
    setSelected(null);
    setForm(blankForm());
    setErr(null);
  };
  const patch = (p: Partial<TypeForm>) => setForm((f) => (f ? { ...f, ...p } : f));
  const setRow = (i: number, p: Partial<SectionRow>) =>
    setForm((f) => (f ? { ...f, sections: f.sections.map((r, k) => (k === i ? { ...r, ...p } : r)) } : f));

  async function save() {
    if (!form) return;
    if (formProblem(form)) {
      setErr(t('key_and_name'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body = bodyOf(form);
      await apiRegistry.getService(DocumentTypesApiService).upsertType(workspaceId).fetch(body);
      onSaved();
      setSelected(body.key);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const checks = form ? conformance(form) : null;

  return (
    <div className={styles.grid}>
      {/* A table, not a column of cards: the reader compares types by scanning a column. */}
      <Card className={styles.list} data-doc-types-list>
        <div className={styles.listHead}>
          <span className={styles.listTitle}>{plural(t, 'types_count', types.length)}</span>
          <Button size="sm" variant="outline" onClick={blank} data-doc-type-new>
            {t('new_type')}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_name')}</TableHead>
              <TableHead>{t('col_key')}</TableHead>
              <TableHead>{t('col_owner')}</TableHead>
              <TableHead className={styles.num}>{t('col_sections')}</TableHead>
              <TableHead className={styles.num}>{t('col_front_matter')}</TableHead>
              <TableHead>{t('col_analyser')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => (
              <TableRow
                key={type.key}
                className={`${styles.typeRow}${selected === type.key ? ` ${styles.active}` : ''}`}
                aria-selected={selected === type.key}
                onClick={() => pick(type)}
                data-doc-type={type.key}
              >
                <TableCell>
                  {/* A button for the keyboard; its click reaches the row. */}
                  <button type="button" className={styles.typeName}>
                    {type.name}
                  </button>
                </TableCell>
                <TableCell>
                  <code className={styles.typeKey}>{type.key}</code>
                </TableCell>
                <TableCell>
                  <Badge size="xs" variant={type.owner === 'workspace' ? 'info' : 'outline'}>
                    {t(`owner_${type.owner}`)}
                  </Badge>
                </TableCell>
                <TableCell className={styles.num}>{type.sections.length}</TableCell>
                {/* A dash, not a 0: zero front-matter keys is "does not use front matter". */}
                <TableCell className={styles.num}>
                  {type.rules.front_matter.length || <span className={styles.dash}>—</span>}
                </TableCell>
                <TableCell data-doc-type-analyser>
                  {analysable === null ? (
                    <span className={styles.dash} title={t('analyser_unknown')}>
                      ?
                    </span>
                  ) : analysable.has(type.key) ? (
                    <Badge size="xs" variant="success">
                      {t('analysable')}
                    </Badge>
                  ) : (
                    <Badge size="xs" variant="outline" title={t('template_only_hint', { accepted })}>
                      {t('template_only')}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <section className={styles.editor}>
        {err && (
          <p role="alert" className={styles.error}>
            {err}
          </p>
        )}
        {!form || !checks ? (
          <div className={styles.empty} data-doc-types-empty>
            <p>{t('pick_one')}</p>
            <p className={styles.hint}>{t('pick_one_hint')}</p>
          </div>
        ) : (
          <>
            <Panel n={1} title={t('panel_identity')}>
              <div className={styles.idRow}>
                <label className={styles.field}>
                  <span>{t('field_key')}</span>
                  <Input placeholder="adr" value={form.key} onChange={(e) => patch({ key: e.target.value })} data-doc-type-key />
                </label>
                <label className={styles.field}>
                  <span>{t('field_name')}</span>
                  <Input
                    placeholder={t('name_placeholder')}
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    data-doc-type-name
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span>{t('field_description')}</span>
                <Input
                  placeholder={t('description_placeholder')}
                  value={form.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
            </Panel>

            <Panel n={2} title={t('panel_template')} sub={t('panel_template_sub')}>
              <Textarea
                className={styles.template}
                value={form.body}
                onChange={(e) => patch({ body: e.target.value })}
                spellCheck={false}
                aria-label={t('panel_template')}
                data-doc-type-body
              />
            </Panel>

            <Panel n={3} title={t('panel_sections')} sub={t('panel_sections_sub')}>
              <div className={styles.secHead}>
                <span>{t('section_title')}</span>
                <span>{t('section_required')}</span>
                <span>{t('section_min_words')}</span>
                <span />
              </div>
              {form.sections.map((s, i) => (
                <div key={i} className={styles.secRow} data-doc-type-section={i}>
                  <Input
                    placeholder={t('section_title')}
                    aria-label={t('section_title')}
                    value={s.title}
                    onChange={(e) => setRow(i, { title: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant={s.required ? 'secondary' : 'outline'}
                    aria-pressed={s.required}
                    onClick={() => setRow(i, { required: !s.required })}
                    data-doc-type-required
                  >
                    {s.required ? t('required') : t('optional')}
                  </Button>
                  <Input
                    type="number"
                    min={0}
                    title={t('min_words_hint')}
                    aria-label={t('section_min_words')}
                    value={s.minWords}
                    onChange={(e) => setRow(i, { minWords: Number(e.target.value) || 0 })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('remove_section')}
                    aria-label={t('remove_section')}
                    onClick={() => patch({ sections: form.sections.filter((_, k) => k !== i) })}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => patch({ sections: [...form.sections, { title: '', required: false, minWords: 0 }] })}
                data-doc-type-add-section
              >
                {t('add_section')}
              </Button>
            </Panel>

            <Panel n={4} title={t('panel_rules')} sub={t('panel_rules_sub')}>
              <label className={styles.field}>
                <span>{t('front_matter')}</span>
                <Input
                  placeholder="status, owner"
                  value={form.frontMatter}
                  onChange={(e) => patch({ frontMatter: e.target.value })}
                  data-doc-type-front-matter
                />
              </label>
              <div className={styles.rules}>
                <label className={styles.inline}>
                  <span>{t('min_title_words')}</span>
                  <Input
                    type="number"
                    min={0}
                    className={styles.small}
                    value={form.minTitle}
                    onChange={(e) => patch({ minTitle: Number(e.target.value) || 0 })}
                  />
                </label>
                <Button
                  size="sm"
                  variant={form.forbid ? 'secondary' : 'outline'}
                  aria-pressed={form.forbid}
                  onClick={() => patch({ forbid: !form.forbid })}
                  data-doc-type-forbid
                >
                  {form.forbid ? '✓ ' : ''}
                  {t('forbid_placeholders')}
                </Button>
                <Button
                  size="sm"
                  variant={form.warn ? 'secondary' : 'outline'}
                  aria-pressed={form.warn}
                  onClick={() => patch({ warn: !form.warn })}
                  data-doc-type-warn
                >
                  {form.warn ? '✓ ' : ''}
                  {t('warn_unknown')}
                </Button>
              </div>
            </Panel>

            <div className={styles.checks} data-doc-type-checks>
              <div className={styles.checksHead}>{t('conforms_when')}</div>
              <ul>
                <li>
                  {plural(t, 'check_required', checks.required)}
                  {checks.defined > checks.required ? ` ${t('check_of_defined', { defined: checks.defined })}` : ''}
                </li>
                {checks.minWords && <li>{t('check_min_words')}</li>}
                {checks.frontMatter.length > 0 && <li>{t('check_front_matter', { keys: checks.frontMatter.join(', ') })}</li>}
                <li>{plural(t, 'check_title', checks.minTitle)}</li>
                {checks.forbid && <li>{t('check_placeholders')}</li>}
                {checks.warn && <li>{t('check_unknown')}</li>}
              </ul>
            </div>

            <div className={styles.actions}>
              <Button onClick={() => void save()} disabled={busy} data-doc-type-save>
                {busy ? t('saving') : t('save')}
              </Button>
              <span className={styles.hint}>{t('save_note')}</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Panel({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className={styles.panel}>
        <h3 className={styles.panelHead}>
          <span className={styles.step}>{n}</span> {title}
          {sub && <span className={styles.panelSub}>{sub}</span>}
        </h3>
        {children}
      </CardContent>
    </Card>
  );
}
