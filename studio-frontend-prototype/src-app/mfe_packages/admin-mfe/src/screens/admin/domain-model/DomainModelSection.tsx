/**
 * Admin › Studio domain model — the prototype's Administration › Domain model
 * (`studio-frontend-poc/src/domain-model-admin.tsx`, ADR-0066) carried over:
 * the types the organization's screens show, where each came from (Studio's
 * core, a kit, a gear, an upload, this organization), its fields and
 * relations, edited where they live.
 *
 * A field added here is a field of every object of the type at once; a
 * field's edit is a numbered model version on the server. The model is the
 * organization's on the path bar (`?organization_id=`, as the prototype's
 * `orgScoped` named the organization on screen). Who may change it is the
 * server's answer (`can_edit_model`, `domain.model`): everyone else reads.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Card, CardContent, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gears-frontx/ui-kit';
import { useOrganization, useStudioEventRefresh, type OrganizationRef, type StudioEvent } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import { fieldsOfModel, modelOf, type DomainModel, type ModelField } from '../../../model/domain-runtime';
import { ORIGIN_ORDER, originOf, type OriginKey } from '../../../model/domain-origin';
import { basesOf, countByKit, countByOrigin, fieldEdit, groupTypes, typeLabel } from '../../../model/domain-admin';
import { ErrorLine, Header, errText, useAdmin } from '../common';
import { FieldDialog, TypeDialog } from './DomainModelDialogs';
import { GtsIds, Relations } from './DomainModelRelations';
import { DomainModelTools } from './DomainModelTools';
import { DomainConformance } from './DomainConformance';
import { DomainTabs } from './DomainTabs';
import styles from '../Admin.module.css';
import own from './DomainModel.module.css';

/** The type the prototype opened on. */
const FIRST_TYPE = 'project';

/** A change to the model itself (`domain.model_changed`): read it again. */
const modelChanged = (event: StudioEvent): boolean => event.kind === 'domain.model_changed';

export function DomainModelSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;
  return <DomainModelAdmin key={org.id} org={org} />;
}

function DomainModelAdmin({ org }: { org: OrganizationRef }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [model, setModel] = useState<DomainModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(FIRST_TYPE);
  const [query, setQuery] = useState('');
  const [originFilter, setOriginFilter] = useState<OriginKey | 'all'>('all');
  const [kitFilter, setKitFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ModelField | null>(null);
  const [creating, setCreating] = useState(false);
  const [showInherited, setShowInherited] = useState(false);
  const [revision, setRevision] = useState(0);

  const load = useCallback(
    () => api.domainTypes({ orgId: org.id }).fetch({ staleTime: 0 }).then(modelOf),
    [api, org.id]
  );

  useEffect(() => {
    let live = true;
    load().then(
      (m) => {
        if (!live) return;
        setModel(m);
        setLoadError(null);
      },
      (e: unknown) => live && setLoadError(errText(e))
    );
    return () => {
      live = false;
    };
  }, [load, revision]);

  // A model changed anywhere (another administrator, a kit installed) shows here without a reload.
  useStudioEventRefresh(modelChanged, () => setRevision((n) => n + 1));
  const counts = useTypeCounts(org.id, revision);

  const entity = model?.byId.get(selected);
  // `id` is the store's key for every object, not a field to rename or drop.
  const fields = useMemo(
    () => (model && entity ? fieldsOfModel(model, entity.id).filter((f) => f.name !== 'id') : []),
    [model, entity]
  );
  const ownFields = fields.filter((f) => f.declaredBy === selected);
  const inherited = fields.filter((f) => f.declaredBy !== selected);

  const grouped = useMemo(
    () => (model ? groupTypes(model, query, originFilter, kitFilter, t('dm_bucket_other')) : []),
    [model, query, originFilter, kitFilter, t]
  );
  const byOrigin = useMemo(() => (model ? countByOrigin(model) : new Map<OriginKey, number>()), [model]);
  const byKit = useMemo(() => (model ? countByKit(model) : []), [model]);

  /** Run a model edit, then read the model again so this screen shows it. */
  const run = async (what: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await what();
      setModel(await load());
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pickOrigin = (key: OriginKey | 'all') => {
    setOriginFilter(key);
    setKitFilter(null);
  };

  const header = (
    <Header
      title={t('dm_title')}
      status={
        model && <span className={styles.sub}>{t.count('dm_types', model.entities.length)}</span>
      }
      info={
        <>
          <p>{t('dm_about')}</p>
          <p>{t('dm_about_origin')}</p>
        </>
      }
    />
  );

  if (!model) {
    return (
      <>
        {header}
        {loadError ? (
          <div className={styles.inline}>
            <ErrorLine>{loadError}</ErrorLine>
            <Button size="sm" variant="outline" onClick={() => setRevision((n) => n + 1)}>
              {t('dm_retry')}
            </Button>
          </div>
        ) : (
          <p className={styles.muted}>{t('dm_loading')}</p>
        )}
      </>
    );
  }

  const countOf = (id: string) => counts.counts?.[id] ?? 0;

  return (
    <>
      {header}
      {loadError && <ErrorLine>{loadError}</ErrorLine>}
      <DomainModelTools orgId={org.id} canEdit={model.canEdit} onChanged={() => setRevision((n) => n + 1)} />
      <div className={own.layout} data-domain-model>
        <Card className={own.list}>
          <CardContent className={own.listBody}>
            <div className={own.listHead}>
              <h3 className={own.h3}>{t('dm_types_title')}</h3>
              {model.canEdit && (
                <Button size="sm" onClick={() => setCreating(true)} disabled={busy} data-dm-new-type>
                  {t('dm_new_type')}
                </Button>
              )}
            </div>
            <Input
              value={query}
              placeholder={t('dm_search')}
              aria-label={t('dm_search')}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={own.origins} role="group" aria-label={t('dm_origins_label')}>
              <Button
                size="sm"
                variant={originFilter === 'all' ? 'secondary' : 'ghost'}
                aria-pressed={originFilter === 'all'}
                onClick={() => pickOrigin('all')}
                data-dm-origin-filter="all"
              >
                {t('dm_origin_all')} <span className={styles.sub}>{model.entities.length}</span>
              </Button>
              {ORIGIN_ORDER.filter((k) => byOrigin.get(k)).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={originFilter === k ? 'secondary' : 'ghost'}
                  aria-pressed={originFilter === k}
                  onClick={() => pickOrigin(k)}
                  data-dm-origin-filter={k}
                >
                  <span className={`${own.dot} ${own[`origin_${k}`]}`} aria-hidden="true" /> {t(`dm_origin_${k}`)}{' '}
                  <span className={styles.sub}>{byOrigin.get(k)}</span>
                </Button>
              ))}
            </div>
            {originFilter === 'kit' && byKit.length > 0 && (
              <div className={own.origins} role="group" aria-label={t('dm_kits_label')}>
                <Button
                  size="sm"
                  variant={kitFilter === null ? 'secondary' : 'ghost'}
                  aria-pressed={kitFilter === null}
                  onClick={() => setKitFilter(null)}
                >
                  {t('dm_kits_all')}
                </Button>
                {byKit.map(([kit, n]) => (
                  <Button
                    key={kit}
                    size="sm"
                    variant={kitFilter === kit ? 'secondary' : 'ghost'}
                    aria-pressed={kitFilter === kit}
                    onClick={() => setKitFilter(kit)}
                    data-dm-kit-filter={kit}
                  >
                    <code className={styles.mono}>{kit}</code> <span className={styles.sub}>{n}</span>
                  </Button>
                ))}
              </div>
            )}
            {model.entities.length === 0 ? (
              <p className={styles.muted}>{t('dm_no_types')}</p>
            ) : grouped.length === 0 ? (
              <p className={styles.muted}>{t('dm_no_match')}</p>
            ) : (
              grouped.map(([bucket, list]) => (
                <div key={bucket} className={own.bucket}>
                  <div className={own.bucketName}>{bucket}</div>
                  {list.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className={`${own.type} ${e.id === selected ? own.typeOn : ''}`}
                      aria-current={e.id === selected ? 'true' : undefined}
                      onClick={() => setSelected(e.id)}
                      title={e.id}
                      data-dm-type={e.id}
                    >
                      <span className={`${own.dot} ${own[`origin_${e.origin}`]}`} title={t(`dm_origin_${e.origin}`)} />
                      <span className={own.typeName}>
                        {e.name}
                        {e.abstract && <span className={styles.sub}> · {t('dm_base')}</span>}
                      </span>
                      {counts.counts && (
                        <span className={styles.sub} title={t('dm_objects_hint')}>
                          {countOf(e.id).toLocaleString(language)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className={styles.cardBody}>
            {!entity ? (
              <p className={styles.muted}>{t('dm_pick')}</p>
            ) : (
              <>
                <div className={own.typeHead}>
                  <h3 className={own.h2}>{entity.name ?? entity.id}</h3>
                  <code className={styles.mono}>{entity.id}</code>
                  {(() => {
                    const o = originOf(model, entity);
                    return (
                      <span className={`${own.origin} ${own[`chip_${o.key}`]}`} title={o.hint} data-dm-origin={o.key}>
                        {o.label}
                      </span>
                    );
                  })()}
                  <span className={styles.sub} title={t('dm_objects_hint')}>
                    {counts.counts
                      ? t.count('dm_objects', countOf(entity.id))
                      : counts.loading
                        ? t('dm_counting')
                        : ''}
                  </span>
                  {basesOf(model, entity.id).length > 0 && (
                    <span className={styles.sub}>{t('dm_extends', { chain: basesOf(model, entity.id).join(' › ') })}</span>
                  )}
                  {model.canEdit && (
                    <Button
                      size="sm"
                      className={own.push}
                      onClick={() => setAdding(true)}
                      disabled={busy}
                      data-dm-add-field
                    >
                      {t('dm_add_field')}
                    </Button>
                  )}
                </div>
                <p className={styles.sub}>{originOf(model, entity).hint}</p>
                {entity.description && <p className={styles.muted}>{entity.description}</p>}
                <GtsIds model={model} id={entity.id} />
                <DomainConformance key={`${org.id}:${entity.id}:${revision}`} orgId={org.id} typeId={entity.id} />
                {!model.canEdit && <p className={styles.muted}>{t('dm_read_only')}</p>}
                {error && !adding && !editing && !creating && <ErrorLine>{error}</ErrorLine>}

                <FieldTable
                  fields={ownFields}
                  empty={t('dm_no_own_fields')}
                  onEdit={model.canEdit ? setEditing : undefined}
                  onRemove={
                    model.canEdit
                      ? (f) =>
                          void run(() => api.removeDomainField(org.id, entity.id, f.name).fetch(undefined))
                      : undefined
                  }
                />
                {inherited.length > 0 && (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setShowInherited((v) => !v)}>
                      {showInherited
                        ? t.count('dm_hide_inherited', inherited.length)
                        : t.count('dm_show_inherited', inherited.length)}
                    </Button>
                    {showInherited && <FieldTable fields={inherited} empty="" />}
                  </div>
                )}
                <DomainTabs key={entity.id} model={model} id={entity.id} busy={busy}
                  onAdd={(input) => run(() => api.addDomainTab(org.id, entity.id).fetch(input))}
                  onRemove={(name) => run(() => api.removeDomainField(org.id, entity.id, name).fetch(undefined))}
                />
                <Relations
                  model={model}
                  id={entity.id}
                  counts={counts.counts}
                  onPick={(id) => {
                    pickOrigin('all');
                    setSelected(id);
                  }}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {adding && entity && (
        <FieldDialog
          title={t('dm_add_field_to', { name: entity.name ?? entity.id })}
          busy={busy}
          error={error}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
          onSave={async (f) => {
            if (await run(() => api.addDomainField(org.id, entity.id).fetch(f))) setAdding(false);
          }}
        />
      )}
      {editing && entity && (
        <FieldDialog
          title={t('dm_edit_field', { name: `${entity.name ?? entity.id}.${editing.name}` })}
          initial={editing}
          busy={busy}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={async (f) => {
            const edit = fieldEdit(editing, f);
            if (await run(() => api.editDomainField(org.id, entity.id, editing.name).fetch(edit))) setEditing(null);
          }}
        />
      )}
      {creating && (
        <TypeDialog
          bases={model.entities.map((e) => ({ id: e.id, name: e.name ?? e.id }))}
          buckets={model.buckets}
          busy={busy}
          error={error}
          onCancel={() => {
            setCreating(false);
            setError(null);
          }}
          onSave={async (body) => {
            if (await run(() => api.createDomainType(org.id).fetch(body))) {
              setCreating(false);
              setSelected(body.id);
            }
          }}
        />
      )}
    </>
  );
}

function FieldTable({
  fields,
  empty,
  onEdit,
  onRemove,
}: {
  fields: ModelField[];
  empty: string;
  onEdit?: (f: ModelField) => void;
  onRemove?: (f: ModelField) => void;
}) {
  const { t } = useAdmin();
  if (fields.length === 0) return empty ? <p className={styles.muted}>{empty}</p> : null;
  const kind = (type: string) => {
    const label = typeLabel(type);
    if ('key' in label) return t(label.key);
    if ('choices' in label) return t('dm_kind_one_of', { values: label.choices.join(', ') });
    return label.raw;
  };
  return (
    <Table data-dm-fields={onEdit ? 'own' : 'inherited'}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('dm_col_field')}</TableHead>
          <TableHead>{t('dm_col_kind')}</TableHead>
          <TableHead>{t('dm_col_required')}</TableHead>
          <TableHead>{t('dm_col_description')}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((f) => (
          <TableRow key={`${f.declaredBy}.${f.name}`} data-dm-field={f.name}>
            <TableCell>
              <code className={styles.mono}>{f.name}</code>
              {onEdit === undefined && <span className={styles.sub}> · {f.declaredBy}</span>}
              {f.heldBy && (
                <span className={styles.sub} title={t('dm_held_hint', { gear: f.heldBy })}>
                  {' '}
                  · 🔒 {f.heldBy}
                </span>
              )}
            </TableCell>
            <TableCell title={f.type}>{kind(f.type)}</TableCell>
            <TableCell>{f.required ? t('dm_yes') : ''}</TableCell>
            <TableCell className={styles.sub}>{f.description}</TableCell>
            <TableCell className={own.actions}>
              {onEdit && !f.heldBy && (
                <Button size="sm" variant="ghost" onClick={() => onEdit(f)}>
                  {t('dm_edit')}
                </Button>
              )}
              {onRemove && !f.heldBy && (
                <Button size="sm" variant="ghost" onClick={() => onRemove(f)} title={t('dm_remove_hint')}>
                  {t('dm_remove')}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** How many objects of each type the organization holds: asked again while
 *  the read model fills (every 2 s, 15 times), and after the model changes. */
function useTypeCounts(orgId: string, revision: number): { counts: Record<string, number> | null; loading: boolean } {
  const api = apiRegistry.getService(AdminApiService);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (left: number) => {
      api
        .domainTypeCounts({ orgId })
        .fetch({ staleTime: 0 })
        .then(
          (r) => {
            if (!live) return;
            if (r.complete) {
              setCounts(r.counts);
              setLoading(false);
            } else if (left > 0) {
              timer = setTimeout(() => ask(left - 1), 2000);
            } else {
              setLoading(false);
            }
          },
          () => live && setLoading(false)
        );
    };
    ask(15);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, orgId, revision]);
  return { counts, loading };
}
