/**
 * A tenant's attributes as the Studio domain model defines them — the
 * prototype's `ObjectAttributes` (`object-attributes.tsx`), on every level.
 *
 * An organization, a workspace, a project is a tenant in account-management:
 * its id, name and place in the tree are the core and stay there. Everything
 * else an organization wants to say about one — a cost centre, a phase, a
 * customer — is a field of the level's model type, added in Admin › Studio
 * domain model. This card shows the fields the live model has for the type,
 * reads the one object that describes the tenant (keyed `self` in its scope,
 * carrying its id in `tenant_id`) and saves through `POST /mutate`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Badge, Button, Card, CardContent, Input, NativeSelect, NativeSelectOption } from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  DomainModelApiService,
  attributesWrite,
  domainChanged,
  inputValue,
  readableFields,
  responseStatus,
  selfQuery,
  shownValue,
  useStudioEventRefresh,
  type DomainModel,
  type ModelField,
  type TabLevel,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import { ErrorLine, Header, errText, useAdmin } from '../admin/common';
import styles from '../admin/Admin.module.css';
import own from './Model.module.css';

export function ObjectAttributes({
  orgId,
  model,
  level,
  tenant,
  onModelChanged,
}: {
  orgId: string;
  model: DomainModel;
  level: TabLevel;
  tenant: { id: string; name: string };
  /** Called after this card changed the model (made the level's type). */
  onModelChanged?: () => void;
}) {
  const { t } = useAdmin();
  const type = level;
  const known = model.byId.has(type);
  const fields = useMemo(() => readableFields(model, type), [model, type]);
  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [objectId, setObjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [name, setName] = useState(tenant.name);

  // A project's name is not in what the shell publishes: read the tenant.
  useEffect(() => {
    if (tenant.name) return undefined;
    let live = true;
    apiRegistry
      .getService(AccountsApiService)
      .getTenant({ tenantId: tenant.id })
      .fetch()
      .then(
        (found) => live && setName(found.name ?? ''),
        () => undefined
      );
    return () => {
      live = false;
    };
  }, [tenant.id, tenant.name]);

  // Read again after a save here, or when someone else writes the type.
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useStudioEventRefresh(domainChanged([type]), reload);
  useEffect(() => {
    if (!known) return undefined;
    let live = true;
    apiRegistry
      .getService(DomainModelApiService)
      .query(orgId)
      .fetch(selfQuery(type, tenant.id))
      .then(
        (res) => {
          if (!live) return;
          const row = res.items[0];
          setObjectId(row?.id ?? null);
          setValue(row?.value ?? {});
          setForbidden(false);
          setError(null);
        },
        (e: unknown) => {
          if (!live) return;
          setForbidden(responseStatus(e) === 403);
          setError(errText(e));
          setValue({});
        }
      );
    return () => {
      live = false;
    };
  }, [known, orgId, type, tenant.id, tick]);

  /** What the tenant already says about itself: shown, and written with the first save. */
  const facts = useMemo<Record<string, unknown>>(() => (name ? { name, title: name } : {}), [name]);
  const factFields = fields.filter((f) => f.name in facts);
  const valueOf = (f: ModelField): unknown => value?.[f.name] ?? (f.name in facts ? facts[f.name] : undefined);
  const filledField = (f: ModelField) => {
    const v = valueOf(f);
    return v !== undefined && v !== null && v !== '';
  };
  // The type's own fields, and any field that holds something, come first;
  // what a base type declares for the model's machinery waits behind a toggle.
  const primary = fields.filter((f) => f.declaredBy === type || filledField(f) || f.name in facts);
  const listed = showAll ? fields : primary;
  const filled = fields.filter(filledField);
  const empty = listed.filter((f) => !filled.includes(f));
  const behind = fields.length - primary.length;

  if (!known) {
    // Who may change the model can make the type here, as the prototype offered.
    const create = async () => {
      setBusy(true);
      setError(null);
      try {
        await apiRegistry
          .getService(AdminApiService)
          .createDomainType(orgId)
          .fetch({ id: type, name: type[0].toUpperCase() + type.slice(1), extends: 'managed-object' });
        onModelChanged?.();
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <>
        <Header
          title={t('model_attributes_title')}
          action={
            model.canEdit ? (
              <Button size="sm" disabled={busy} onClick={() => void create()} data-attributes-create-type>
                {t('model_create_type', { type })}
              </Button>
            ) : undefined
          }
        />
        <p className={styles.muted}>{t('model_attributes_no_type', { type })}</p>
        {error && <ErrorLine>{error}</ErrorLine>}
      </>
    );
  }

  const startEdit = () => {
    setDraft(
      Object.fromEntries(
        fields.filter((f) => !f.heldBy).map((f) => [f.name, f.kind.kind === 'boolean' ? valueOf(f) === true : inputValue(valueOf(f))])
      )
    );
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const op = attributesWrite({
        type,
        tenantId: tenant.id,
        objectId,
        fields,
        before: value ?? {},
        draft,
        facts: Object.fromEntries(factFields.map((f) => [f.name, facts[f.name]])),
      });
      if (op) await apiRegistry.getService(DomainModelApiService).mutate(orgId).fetch({ operations: [op] });
      setEditing(false);
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        title={t('model_attributes_title')}
        info={t('model_attributes_about', { level: t(`model_level_${level}`) })}
        status={<Badge variant="outline">{t('model_attributes_fields', { count: String(fields.length), type })}</Badge>}
        action={
          !editing && !forbidden ? (
            <Button size="sm" variant="outline" disabled={value === null} onClick={startEdit} data-attributes-edit>
              {t('model_edit')}
            </Button>
          ) : undefined
        }
      />
      {error && <ErrorLine>{forbidden ? t('model_forbidden') : error}</ErrorLine>}
      <Card>
        <CardContent className={own.card}>
          {value === null ? (
            <p className={styles.muted}>{t('reading')}</p>
          ) : editing ? (
            <form
              className={own.grid}
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {listed
                .filter((f) => !f.heldBy)
                .map((f) => (
                  <FieldInput
                    key={f.name}
                    field={f}
                    value={draft[f.name] ?? ''}
                    onChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))}
                  />
                ))}
              <span />
              <div className={styles.inline}>
                {behind > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? t('model_only_own') : t('model_all_fields', { count: String(fields.length) })}
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={busy} data-attributes-save>
                  {busy ? t('model_saving') : t('model_save')}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              {filled.length === 0 ? (
                <p className={styles.muted} data-attributes-empty>
                  {t('model_nothing_recorded')}
                </p>
              ) : (
                <dl className={own.grid}>
                  {filled.map((f) => (
                    <FieldRow
                      key={f.name}
                      field={f}
                      value={valueOf(f)}
                      from={value?.[f.name] === undefined && f.name in facts ? t('model_from_tenant') : undefined}
                    />
                  ))}
                </dl>
              )}
              {(empty.length > 0 || behind > 0) && (
                <div className={styles.inline}>
                  {empty.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setShowEmpty((v) => !v)}>
                      {showEmpty
                        ? t('model_hide_empty', { count: String(empty.length) })
                        : t('model_show_empty', { count: String(empty.length) })}
                    </Button>
                  )}
                  {behind > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('model_base_fields_hint')}
                      onClick={() => {
                        setShowAll((v) => !v);
                        setShowEmpty(true);
                      }}
                    >
                      {showAll
                        ? t('model_hide_base_fields', { count: String(behind) })
                        : t('model_show_base_fields', { count: String(behind) })}
                    </Button>
                  )}
                </div>
              )}
              {showEmpty && empty.length > 0 && (
                <dl className={own.grid}>
                  {empty.map((f) => (
                    <FieldRow key={f.name} field={f} value={undefined} />
                  ))}
                </dl>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function FieldRow({ field, value, from }: { field: ModelField; value: unknown; from?: string }) {
  const { t } = useAdmin();
  return (
    <>
      <dt className={styles.sub} title={field.description || field.type}>
        {field.name.replace(/_/g, ' ')}
        {field.required && ' *'}
      </dt>
      <dd className={own.value}>
        {shownValue(value, t('model_yes'), t('model_no'))}
        {from && <span className={styles.sub}> · {from}</span>}
      </dd>
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ModelField;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  const id = `attr-${field.name}`;
  const k = field.kind;
  let input;
  if (k.kind === 'boolean') {
    input = <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  } else if (k.kind === 'enum') {
    input = (
      <NativeSelect id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">—</NativeSelectOption>
        {k.values.map((v) => (
          <NativeSelectOption key={v} value={v}>
            {v}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  } else {
    input = (
      <Input
        id={id}
        type={k.kind === 'number' ? 'number' : 'text'}
        value={String(value)}
        placeholder={k.kind === 'list' ? 'a, b, c' : field.type}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <>
      <label className={styles.sub} htmlFor={id} title={field.description || field.type}>
        {field.name.replace(/_/g, ' ')}
        {field.required && ' *'}
      </label>
      {input}
    </>
  );
}
