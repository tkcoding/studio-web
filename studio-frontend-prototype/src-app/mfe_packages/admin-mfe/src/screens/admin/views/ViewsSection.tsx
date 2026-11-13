/**
 * Admin › Views — the prototype's Administration › Views (`ViewsScreen` in
 * `studio-frontend-poc/src/views.tsx`): lists of the Studio domain model's
 * objects, defined here and stored as objects of the model's own `view`
 * entity. Pick a type, its columns, conditions and related objects, save it,
 * and it is a screen; a new one needs no release (views-model.ts).
 *
 * The model and the views are the organization's on the path bar
 * (`?organization_id=`), as Studio domain model reads it. A view is written
 * with `POST /studio-domain-model/v1/mutate` (one upsert by its stable key)
 * and listed and run with `POST /studio-domain-model/v1/query`. Who may write
 * objects is the server's answer (`domain.edit`); nothing tells the portal
 * beforehand, so everyone is offered the writes, as in the prototype, and a
 * refusal says so, keeps the editor's draft, and turns the screen read-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Card, CardContent } from '@gears-frontx/ui-kit';
import {
  domainChanged,
  openScreen,
  responseStatus,
  useOrganization,
  useStudioEventRefresh,
  type OrganizationRef,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import { modelOf, type DomainModel } from '../../../model/domain-runtime';
import {
  LIST_VIEWS,
  VIEW_TYPE,
  blankView,
  canStoreViews,
  fromViewObject,
  saveViewMutation,
  viewableTypes,
  type ViewSpec,
} from '../../../model/views-model';
import { ErrorLine, Header, errText, useAdmin, useConfirm } from '../common';
import { ViewEditor } from './ViewEditor';
import { ViewGraph, ViewTable, useReadFailure } from './ViewTable';
import styles from '../Admin.module.css';
import own from './Views.module.css';

/** The type a new view starts on, as in the prototype; the first concrete one where the model has no project. */
const FIRST_TYPE = 'project';

/** The route of the Studio domain model section, where a missing `view` type is put right. */
export const DOMAIN_MODEL_ROUTE = '/admin/domain-model';

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function ViewsSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;
  return <ViewsAdmin key={org.id} org={org} />;
}

function ViewsAdmin({ org }: { org: OrganizationRef }) {
  const { t, bridge } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const failure = useReadFailure();
  const [model, setModel] = useState<DomainModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [views, setViews] = useState<ViewSpec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ViewSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [revision, setRevision] = useState(0);
  const [ask, confirmDialog] = useConfirm();

  // A view written or retired anywhere, or the model changed: read again.
  const watched = useMemo(() => domainChanged([VIEW_TYPE], { model: true }), []);
  useStudioEventRefresh(watched, () => setRevision((n) => n + 1));

  useEffect(() => {
    let live = true;
    api
      .domainTypes({ orgId: org.id })
      .fetch({ staleTime: 0 })
      .then(modelOf)
      .then(
        (m) => {
          if (!live) return;
          setModel(m);
          setModelError(null);
        },
        (e: unknown) => live && setModelError(errText(e))
      );
    return () => {
      live = false;
    };
  }, [api, org.id, revision]);

  const storable = model ? canStoreViews(model) : false;

  // The live views, read again after every write here and on every change the shell relays.
  const [listed, setListed] = useState(0);
  const reload = useCallback(() => setListed((n) => n + 1), []);
  useEffect(() => {
    if (!model || !canStoreViews(model)) return;
    let live = true;
    api
      .queryDomain(org.id)
      .fetch(LIST_VIEWS)
      .then(
        (res) => {
          if (!live) return;
          const specs = res.items.map((r) => fromViewObject(model, r.value)).filter((v): v is ViewSpec => v !== null);
          setViews(specs);
          setError(null);
          setSelectedId((id) => (id && specs.some((v) => v.id === id) ? id : (specs[0]?.id ?? null)));
        },
        (e: unknown) => {
          if (!live) return;
          setError(failure(e));
          setViews((v) => v ?? []);
        }
      );
    return () => {
      live = false;
    };
    // `failure` is the language's, not the list's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, org.id, model, listed]);

  const selected = views?.find((v) => v.id === selectedId) ?? null;

  /** A write refused for the caller's rights: say so once, and stop offering writes. */
  const refused = (e: unknown) => {
    if (responseStatus(e) === 403) setReadOnly(true);
  };

  const save = async (spec: ViewSpec) => {
    if (!model) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.mutateDomain(org.id).fetch(saveViewMutation(model, spec));
      setEditing(null);
      setSelectedId(spec.id);
      reload();
    } catch (e) {
      // The dialog stays open with what was typed in it.
      refused(e);
      setSaveError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // A view is retired, not deleted, as in the prototype: the model's
  // `valid_to` says it ended and the list reads live views only.
  const retire = (spec: ViewSpec) =>
    ask(
      { title: t('vw_retire_title', { name: spec.name }), body: t('vw_retire_body'), confirmLabel: t('vw_retire') },
      async () => {
        if (!model) return;
        try {
          await api.mutateDomain(org.id).fetch(saveViewMutation(model, spec, { valid_to: new Date().toISOString() }));
        } catch (e) {
          refused(e);
          throw e;
        }
        reload();
      }
    );

  const startNew = () => {
    if (!model) return;
    const types = viewableTypes(model);
    const type = types.includes(FIRST_TYPE) ? FIRST_TYPE : (types[0] ?? FIRST_TYPE);
    setSaveError(null);
    setEditing(blankView(model, type, newId()));
  };

  const header = (
    <Header
      title={t('vw_title')}
      status={views && <span className={styles.sub}>{t.count('vw_count', views.length)}</span>}
      info={<p>{t('vw_about')}</p>}
      action={
        storable &&
        !readOnly && (
          <Button size="sm" onClick={startNew} data-view-new>
            {t('vw_new')}
          </Button>
        )
      }
    />
  );

  if (!model) {
    return (
      <>
        {header}
        {modelError ? (
          <div className={styles.inline}>
            <ErrorLine>{modelError}</ErrorLine>
            <Button size="sm" variant="outline" onClick={() => setRevision((n) => n + 1)}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <p className={styles.muted}>{t('dm_loading')}</p>
        )}
      </>
    );
  }

  if (!storable) {
    return (
      <>
        {header}
        <div className={styles.notice} role="status" data-view-no-type>
          <p>{t('vw_no_view_type')}</p>
          <Button size="sm" variant="outline" onClick={() => openScreen(bridge, DOMAIN_MODEL_ROUTE)}>
            {t('vw_open_model')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {readOnly && <p className={styles.muted} data-view-read-only>{t('vw_read_only')}</p>}
      {error && (
        <div className={styles.inline}>
          <ErrorLine>{error}</ErrorLine>
          <Button size="sm" variant="outline" onClick={reload}>
            {t('retry')}
          </Button>
        </div>
      )}
      {views === null ? (
        <p className={styles.muted}>{t('vw_loading')}</p>
      ) : views.length === 0 ? (
        !error && <p className={styles.muted}>{t('vw_none')}</p>
      ) : (
        <div role="tablist" className={own.tabs} aria-label={t('vw_title')}>
          {views.map((v) => (
            <Button
              key={v.id}
              role="tab"
              size="sm"
              aria-selected={v.id === selectedId}
              variant={v.id === selectedId ? 'secondary' : 'ghost'}
              onClick={() => setSelectedId(v.id)}
              title={t('vw_tab_hint', { type: v.type, columns: String(v.columns.length) })}
              data-view-tab={v.id}
            >
              {v.name}
            </Button>
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <CardContent className={styles.cardBody}>
            <div className={own.head}>
              <strong>{selected.name}</strong>
              <span className={styles.sub}>
                {selected.type} · {t(selected.kind === 'graph' ? 'vw_kind_graph_short' : 'vw_kind_table_short')}
                {selected.conditions.length > 0 && ` · ${t.count('vw_conditions_count', selected.conditions.length)}`}
              </span>
              {!readOnly && (
                <span className={own.push}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSaveError(null);
                      setEditing(selected);
                    }}
                    data-view-edit
                  >
                    {t('vw_edit')}
                  </Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => retire(selected)} data-view-retire>
                    {t('vw_retire')}
                  </Button>
                </span>
              )}
            </div>
            {selected.kind === 'graph' ? (
              <ViewGraph orgId={org.id} model={model} spec={selected} />
            ) : (
              <ViewTable orgId={org.id} model={model} spec={selected} />
            )}
          </CardContent>
        </Card>
      )}

      {editing && (
        <ViewEditor
          orgId={org.id}
          model={model}
          initial={editing}
          busy={busy}
          error={saveError}
          onCancel={() => {
            setEditing(null);
            setSaveError(null);
          }}
          onSave={(s) => void save(s)}
        />
      )}
      {confirmDialog}
    </>
  );
}
