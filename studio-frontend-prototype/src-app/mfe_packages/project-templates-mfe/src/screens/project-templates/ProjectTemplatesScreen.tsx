/**
 * Workspace › Project templates, the prototype's project-types-editor.tsx
 * carried over (ADR-0069 §5): which templates the workspace's New project card
 * offers, and what each fills in — the sources, a brief, the kits ticked, the
 * tabs its projects show — and nothing more: a template does not say what the
 * product is. The model and its rules are `model/project-types.ts`, moved
 * unchanged; this is the form.
 *
 * Saved where the reader chooses: on this workspace, or on the organization so
 * every workspace of it inherits the list (the nearest tenant wins). The
 * sentences the model composes (what a template fills in, why a list cannot
 * be saved) stay the model's English.
 */

import React, { useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  Textarea,
} from '@gears-frontx/ui-kit';
import {
  errorMessage,
  refusalText,
  useHostChrome,
  useOrganization,
  useWorkspace,
  type OrganizationRef,
  type WorkspaceRef,
} from '@constructor-studio/mfe-shared';
import { ProjectTemplatesApiService, type CatalogKit } from '../../api/ProjectTemplatesApiService';
import {
  BUILTIN_TEMPLATES,
  PRESETS,
  keyFor,
  parseTemplates,
  templateFills,
  templatesProblem,
  type ProjectTemplate,
} from '../../model/project-types';
import { PROJECT_TABS, type ProjTab, type RepoRoad } from '../../model/project-tabs';
import { useProjectTemplatesTranslations } from '../../i18n';
import styles from './ProjectTemplatesScreen.module.css';

type Text = ReturnType<typeof useProjectTemplatesTranslations>['t'];

/** Whose list is shown: this workspace's own, the organization's, or Studio's built-in one. */
type Source = 'workspace' | 'organization' | 'builtin';
type Target = 'workspace' | 'organization';

const ROADS: readonly RepoRoad[] = ['none', 'new', 'existing'];
const TAB_IDS: ProjTab[] = PROJECT_TABS.map((t) => t.id);

/** The gear's own words for a refusal, else the error's message. */
const errText = (e: unknown) => refusalText(e) ?? errorMessage(e);

export const ProjectTemplatesScreen: React.FC = () => {
  const { org, loading: orgLoading } = useOrganization();
  const { workspace, loading: wsLoading } = useWorkspace();
  const { containerRef, dataTheme } = useHostChrome();
  const { t, loading } = useProjectTemplatesTranslations();
  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-project-templates>
      {loading || orgLoading || wsLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : !workspace || !org ? (
        <p className={styles.muted}>{t('no_workspace')}</p>
      ) : (
        // Keyed by the scope: another workspace is another read, from nothing.
        <WorkspaceTemplates key={`${org.id}:${workspace.id}`} org={org} workspace={workspace} t={t} />
      )}
    </div>
  );
};

ProjectTemplatesScreen.displayName = 'ProjectTemplatesScreen';

/** The note a save or a drop leaves, and the read it asks for, outlive the editor's working copy. */
function WorkspaceTemplates({ org, workspace, t }: { org: OrganizationRef; workspace: WorkspaceRef; t: Text }) {
  const [reload, setReload] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  return (
    <TemplatesEditor
      // Every reload reads afresh: the working copy is dropped with the editor.
      key={reload}
      org={org}
      workspace={workspace}
      t={t}
      note={note}
      onReload={(next) => {
        setNote(next);
        setReload((n) => n + 1);
      }}
    />
  );
}

interface Loaded {
  source: Source;
}

function TemplatesEditor({
  org,
  workspace,
  t,
  note,
  onReload,
}: {
  org: OrganizationRef;
  workspace: WorkspaceRef;
  t: Text;
  /** What the last save or drop said. */
  note: string | null;
  /** Read the lists again, with what to say about it. */
  onReload: (note: string | null) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [types, setTypes] = useState<ProjectTemplate[] | null>(null);
  const [target, setTarget] = useState<Target>('organization');
  const [kits, setKits] = useState<CatalogKit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const api = apiRegistry.getService(ProjectTemplatesApiService);
    Promise.all([
      api.projectTypes({ tenantId: workspace.id }).fetch({ staleTime: 0 }),
      api.projectTypes({ tenantId: org.id }).fetch({ staleTime: 0 }),
    ])
      .then(([ws, organization]) => {
        if (!alive) return;
        const own = ws.own ?? null;
        const inherited = organization.own ?? null;
        const from: Source = own ? 'workspace' : inherited ? 'organization' : 'builtin';
        setLoaded({ source: from });
        setTarget(from === 'workspace' ? 'workspace' : 'organization');
        setTypes(parseTemplates(own ?? inherited, TAB_IDS));
      })
      .catch((e: unknown) => alive && setErr(errText(e)));
    // The kits a template may tick; without the catalogue the editor just offers none.
    api.kits
      .fetch({ staleTime: 0 })
      .then((page) => alive && setKits(page.items ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [org.id, workspace.id]);

  if (!types || !loaded) {
    return err ? (
      <p role="alert" className={styles.error}>
        {err}
      </p>
    ) : (
      <p className={styles.muted}>{t('reading')}</p>
    );
  }

  const { source } = loaded;
  const problem = templatesProblem(types);
  const edit = (i: number, patch: Partial<ProjectTemplate>) =>
    setTypes(types.map((tpl, k) => (k === i ? { ...tpl, ...patch } : tpl)));
  const sourceWords =
    source === 'workspace'
      ? t('source_workspace')
      : source === 'organization'
        ? t('source_organization', { org: org.name })
        : t('source_builtin');
  const tabLabel = (id: ProjTab) => t(`tab_${id}`);

  async function save() {
    if (!types || templatesProblem(types)) return;
    setBusy(true);
    setErr(null);
    try {
      const api = apiRegistry.getService(ProjectTemplatesApiService);
      await api.putProjectTypes(target === 'workspace' ? workspace.id : org.id).fetch({ types });
      onReload(target === 'workspace' ? t('saved_workspace') : t('saved_organization', { org: org.name }));
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  async function dropOwn() {
    setBusy(true);
    setErr(null);
    try {
      await apiRegistry.getService(ProjectTemplatesApiService).deleteProjectTypes(workspace.id).fetch(undefined);
      onReload(t('dropped'));
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
      </header>
      <p className={styles.about}>{t('about', { source: sourceWords })}</p>

      <div className={styles.row}>
        <span className={styles.muted}>{t('start_from')}</span>
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant="outline"
            onClick={() => setTypes(p.templates.map((tpl) => ({ ...tpl })))}
            data-template-preset={p.id}
          >
            {t(`preset_${p.id}`)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setTypes([
              ...types,
              // The key is a slug: from the English title, whatever the screen's language.
              { key: keyFor('New template', types.map((tpl) => tpl.key)), title: t('new_template'), description: '' },
            ])
          }
          data-template-add
        >
          {t('add')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={types.length === 0}
          onClick={() => setTypes([])}
          title={t('offer_none_hint')}
          data-template-none
        >
          {t('offer_none')}
        </Button>
      </div>

      {types.length === 0 && <p className={styles.muted}>{t('none_offered')}</p>}

      {types.map((tpl, i) => (
        <Card key={i} data-template={tpl.key}>
          <CardContent className={styles.card}>
            <div className={styles.row}>
              <Input
                aria-label={t('field_title')}
                value={tpl.title}
                onChange={(e) => edit(i, { title: e.target.value })}
                className={styles.titleInput}
              />
              <label className={styles.control}>
                {t('field_key')}
                <Input
                  aria-label={t('field_key')}
                  value={tpl.key}
                  onChange={(e) => edit(i, { key: e.target.value.trim() })}
                  className={styles.keyInput}
                />
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                onClick={() => setTypes([...types.slice(0, i - 1), tpl, types[i - 1], ...types.slice(i + 1)])}
                aria-label={t('move_up')}
                title={t('move_up')}
              >
                ↑
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTypes(types.filter((_, k) => k !== i))}>
                {t('remove')}
              </Button>
            </div>
            <Textarea
              aria-label={t('field_description')}
              rows={2}
              value={tpl.description}
              placeholder={t('description_placeholder')}
              onChange={(e) => edit(i, { description: e.target.value })}
            />
            <div className={styles.row}>
              <label className={styles.control}>
                {t('sources_starts_with')}
                <NativeSelect
                  size="sm"
                  value={tpl.repository ?? 'none'}
                  onChange={(e) => {
                    const road = e.target.value as RepoRoad;
                    edit(i, road === 'none' ? { repository: undefined, starter_gear: undefined } : { repository: road });
                  }}
                  aria-label={t('sources_starts_with')}
                  data-template-repository
                >
                  {ROADS.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {t(`road_${r}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className={`${styles.control}${tpl.repository ? '' : ` ${styles.dim}`}`}>
                <Checkbox
                  checked={!!tpl.starter_gear}
                  disabled={!tpl.repository}
                  onCheckedChange={(on) => edit(i, { starter_gear: on || undefined })}
                  data-template-starter-gear
                />
                {t('starter_gear')}
              </label>
              <span className={styles.muted}>{templateFills(tpl)}</span>
            </div>
            <Textarea
              aria-label={t('field_brief')}
              rows={2}
              value={tpl.brief ?? ''}
              placeholder={t('brief_placeholder')}
              onChange={(e) => edit(i, { brief: e.target.value || undefined })}
            />
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>
                {t('tabs_shown')}{' '}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => edit(i, { tabs: undefined, first_tab: undefined })}
                  data-template-all-tabs
                >
                  {t('all')}
                </button>
              </legend>
              <div className={styles.checks}>
                {PROJECT_TABS.map((tab) => {
                  const on = !tpl.tabs || tpl.tabs.includes(tab.id);
                  return (
                    <label key={tab.id} className={styles.control} data-template-tab={tab.id}>
                      <Checkbox
                        checked={on}
                        onCheckedChange={() => {
                          const current = tpl.tabs ?? TAB_IDS;
                          const next = on
                            ? current.filter((x) => x !== tab.id)
                            : TAB_IDS.filter((x) => x === tab.id || current.includes(x));
                          edit(i, {
                            tabs: next.length === TAB_IDS.length ? undefined : next,
                            first_tab: tpl.first_tab && next.includes(tpl.first_tab) ? tpl.first_tab : undefined,
                          });
                        }}
                      />
                      {tabLabel(tab.id)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className={styles.row}>
              <label className={styles.control}>
                {t('opens_on')}
                <NativeSelect
                  size="sm"
                  value={tpl.first_tab ?? ''}
                  onChange={(e) => edit(i, { first_tab: (e.target.value || undefined) as ProjTab | undefined })}
                  aria-label={t('opens_on')}
                >
                  <NativeSelectOption value="">{t('its_first_tab')}</NativeSelectOption>
                  {PROJECT_TABS.filter((tab) => !tpl.tabs || tpl.tabs.includes(tab.id)).map((tab) => (
                    <NativeSelectOption key={tab.id} value={tab.id}>
                      {tabLabel(tab.id)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {kits.length > 0 && (
                <span className={styles.row} data-template-kits>
                  {t('kits_ticked')}
                  {kits.map((k) => {
                    const on = (tpl.kits ?? []).includes(k.slug);
                    return (
                      <label key={k.slug} className={styles.control}>
                        <Checkbox
                          checked={on}
                          onCheckedChange={() => {
                            const next = on ? (tpl.kits ?? []).filter((s) => s !== k.slug) : [...(tpl.kits ?? []), k.slug];
                            edit(i, { kits: next.length > 0 ? next : undefined });
                          }}
                          data-template-kit={k.slug}
                        />
                        {k.name}
                      </label>
                    );
                  })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <div className={styles.row}>
        <label className={styles.control}>
          {t('save_for')}
          <NativeSelect
            size="sm"
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            aria-label={t('save_for')}
            data-template-target
          >
            <NativeSelectOption value="organization">{t('target_organization', { org: org.name })}</NativeSelectOption>
            <NativeSelectOption value="workspace">{t('target_workspace', { workspace: workspace.name })}</NativeSelectOption>
          </NativeSelect>
        </label>
        <Button size="sm" disabled={busy || problem !== null} onClick={() => void save()} data-template-save>
          {t('save')}
        </Button>
        {source === 'workspace' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void dropOwn()} data-template-drop>
            {t('use_inherited')}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReload(null)} data-template-discard>
          {t('discard')}
        </Button>
        {problem && (
          <span role="alert" className={styles.error} data-template-problem>
            {problem}
          </span>
        )}
        {note && <span className={styles.muted}>{note}</span>}
        {err && (
          <span role="alert" className={styles.error}>
            {err}
          </span>
        )}
      </div>
      {source === 'builtin' && types === BUILTIN_TEMPLATES && <p className={styles.muted}>{t('nothing_stored')}</p>}
    </div>
  );
}
