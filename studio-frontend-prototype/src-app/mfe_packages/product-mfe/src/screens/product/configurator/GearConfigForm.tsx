/**
 * The product's configuration of its gears, as a form (the prototype's
 * gear-config-form.tsx): for each gear in the product, the fields its
 * gear.gdl declares (required, default), prefilled with what product.config
 * sets. A required field with no default that the product leaves unset is
 * what makes the engine refuse the product, so those are marked. Fields
 * generation writes (an endpoint's address) are shown, not edited. A field the
 * schema does not name can still be set below.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button, Input, NativeSelect, NativeSelectOption } from '@gears-frontx/ui-kit';
import { productApi, type GearConfig, type GearConfigSchema } from '../../../api/client';
import { configRows, configText, configValue, unsetRequired, type ConfigRow } from '../../../model/gear-config';
import { gearLabel } from '../../../model/product';
import { useConfiguratorTranslations } from '../../../i18n';
import { errText } from '../../common';
import common from '../../product.module.css';
import styles from './configurator.module.css';

type Text = ReturnType<typeof useConfiguratorTranslations>['t'];

/** What the form needs of the product's state. */
export interface GearConfigProduct {
  picks: string[];
  config: GearConfig;
  /** Set one field of one gear; `undefined` removes it. */
  setField: (gear: string, field: string, value: unknown) => void;
}

export function GearConfigForm({ product }: { product: GearConfigProduct }) {
  const { t } = useConfiguratorTranslations();
  const { picks, config } = product;
  const [schemas, setSchemas] = useState<GearConfigSchema[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const asked = useMemo(() => [...new Set(picks)].sort().join('\n'), [picks]);

  useEffect(() => {
    if (!asked) return;
    let live = true;
    productApi
      .gearConfigSchemas(asked.split('\n'))
      .then((r) => {
        if (!live) return;
        setSchemas(r.items);
        setSchemaError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setSchemas([]);
        setSchemaError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [asked]);

  const gears = useMemo(() => configRows(picks, schemas, config), [picks, schemas, config]);
  const missing = unsetRequired(gears);
  if (picks.length === 0) return null;

  return (
    <div className={`${common.stack} ${common.small}`} data-gear-config>
      <div className={common.muted}>{t('config_title')}</div>
      {schemaError && <div className={common.muted}>{t('config_schema_failed', { error: schemaError })}</div>}
      {missing.length > 0 && (
        <div className={styles.missing} data-config-missing>
          {t.count('config_missing', missing.length)}
        </div>
      )}
      {gears.map((g) => (
        <fieldset key={g.gear} className={styles.fieldset} data-gear={g.gear}>
          <legend>
            <code className={common.code}>{gearLabel(g.gear)}</code>
            {!g.picked && <span className={common.muted}> · {t('config_not_in_product')}</span>}
          </legend>
          {g.rows.length === 0 && (
            <div className={common.muted}>{g.described ? t('config_nothing') : t('config_no_schema')}</div>
          )}
          {g.rows.map((r) => (
            <FieldRow key={r.field} gear={g.gear} row={r} product={product} t={t} />
          ))}
        </fieldset>
      ))}
      <OtherField picks={picks} product={product} t={t} />
    </div>
  );
}

function FieldRow({ gear, row, product, t }: { gear: string; row: ConfigRow; product: GearConfigProduct; t: Text }) {
  const label = `${gear} ${row.field}`;
  const text = configText(row.value);
  return (
    <div className={styles.field} data-config-field={row.field} data-missing={row.missing || undefined}>
      <code className={`${common.code} ${styles.fieldName} ${row.missing ? styles.missing : ''}`}>{row.field}</code>
      {row.derived ? (
        <span className={common.muted}>{t('config_derived')}</span>
      ) : (
        <>
          <Input
            // Keyed on the value, so a change from elsewhere (completion
            // aligning a vendor) replaces what the input shows.
            key={text}
            className={styles.fieldInput}
            aria-label={label}
            aria-invalid={row.missing || undefined}
            defaultValue={text}
            placeholder={row.default !== undefined ? configText(row.default) : row.required ? t('config_required') : ''}
            onBlur={(e) => {
              const next = e.target.value;
              if (next === text) return;
              product.setField(gear, row.field, next.trim() === '' ? undefined : configValue(next));
            }}
          />
          {row.set && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title={row.default !== undefined ? t('config_unset_default') : t('config_unset')}
              aria-label={t('config_remove', { field: label })}
              onClick={() => product.setField(gear, row.field, undefined)}
            >
              ×
            </Button>
          )}
        </>
      )}
      <span className={common.muted}>
        {[
          row.required && !row.derived ? t('config_required') : null,
          row.default !== undefined ? t('config_default', { value: configText(row.default) }) : null,
          row.declared ? null : t('config_undeclared'),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
}

/** A field the schema does not name: the escape hatch for a gear whose
 *  gear.gdl is behind its code, or one the corpus does not describe. */
function OtherField({ picks, product, t }: { picks: string[]; product: GearConfigProduct; t: Text }) {
  const [gear, setGear] = useState('');
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  return (
    <form
      className={styles.field}
      onSubmit={(e) => {
        e.preventDefault();
        if (!gear || !field.trim()) return;
        product.setField(gear, field.trim(), configValue(value));
        setField('');
        setValue('');
      }}
    >
      <span className={common.muted}>{t('config_other')}</span>
      <NativeSelect value={gear} onChange={(e) => setGear(e.target.value)} aria-label={t('config_other_gear')}>
        <NativeSelectOption value="">{t('config_gear_placeholder')}</NativeSelectOption>
        {picks.map((p) => (
          <NativeSelectOption key={p} value={p}>
            {gearLabel(p)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Input
        className={styles.fieldInput}
        placeholder={t('config_field_placeholder')}
        aria-label={t('config_field_placeholder')}
        value={field}
        onChange={(e) => setField(e.target.value)}
      />
      <Input
        className={styles.fieldInput}
        placeholder={t('config_value_placeholder')}
        aria-label={t('config_value_placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!gear || !field.trim()}>
        {t('config_set')}
      </Button>
    </form>
  );
}
