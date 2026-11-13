/**
 * The prototype's two forms of the Domain model (`FieldDialog`, `TypeDialog`
 * in `studio-frontend-poc/src/domain-model-admin.tsx`): add or edit a field —
 * a common kind by name, one of a list, or any type expression — and make a
 * new type that extends another and sits in a group.
 */

import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';
import { COMMON_TYPES, slug, validFieldName, validTypeId } from '../../../model/domain-admin';
import type { ModelField } from '../../../model/domain-runtime';
import { ErrorLine, useAdmin } from '../common';
import styles from '../Admin.module.css';
import own from './DomainModel.module.css';

export interface FieldInput {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export function FieldDialog({
  title,
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  initial?: ModelField;
  busy: boolean;
  error: string | null;
  onSave: (f: FieldInput) => void;
  onCancel: () => void;
}) {
  const { t, container } = useAdmin();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'string');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [choices, setChoices] = useState(() => (type.includes('|') ? type : ''));
  const [kind, setKind] = useState<'common' | 'choice' | 'custom'>(() => type.includes('|') ? 'choice' : COMMON_TYPES.some((c) => c.type === type) ? 'common' : 'custom');
  const custom = kind === 'custom';
  const valid = validFieldName(name) && type.trim() !== '';

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent container={container} closeLabel={t('close')} data-dm-field-dialog>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className={own.dialogBody}>
          <label className={styles.field}>
            {t('dm_field_name')}
            <Input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="cost_center" data-dm-field-name />
            <span className={styles.sub}>{t('dm_field_name_hint')}</span>
          </label>
          <label className={styles.field}>
            {t('dm_col_kind')}
            <NativeSelect
              value={kind === 'choice' ? '__choice' : custom ? '__custom' : type}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__choice') { setKind('choice'); setType(choices || 'low | medium | high'); }
                else if (v === '__custom') { setKind('custom'); setType(type.includes('|') ? 'string' : type); }
                else { setKind('common'); setType(v); }
              }}
              data-dm-field-kind
            >
              {COMMON_TYPES.map((c) => (
                <NativeSelectOption key={c.type} value={c.type}>
                  {t(c.key)}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="__choice">{t('dm_kind_choice')}</NativeSelectOption>
              <NativeSelectOption value="__custom">{t('dm_kind_custom')}</NativeSelectOption>
            </NativeSelect>
          </label>
          {kind === 'choice' && (
            <label className={styles.field}>
              {t('dm_field_choices')}
              <Input
                value={choices || type}
                onChange={(e) => {
                  setChoices(e.target.value);
                  setType(e.target.value);
                }}
                placeholder="low | medium | high"
              />
              <span className={styles.sub}>{t('dm_field_choices_hint')}</span>
            </label>
          )}
          {custom && (
            <label className={styles.field}>
              {t('dm_field_expression')}
              <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="EntityId" />
            </label>
          )}
          <label className={own.check}>
            <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} />
            {t('dm_col_required')}
          </label>
          <label className={styles.field}>
            {t('dm_col_description')}
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={() => onSave({ name, type: type.trim(), required, description })}
            data-dm-field-save
          >
            {busy ? t('dm_saving') : t('dm_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface TypeInput {
  id: string;
  name: string;
  extends?: string;
  bucket?: string;
  description?: string;
}

export function TypeDialog({
  bases,
  buckets,
  busy,
  error,
  onSave,
  onCancel,
}: {
  bases: { id: string; name: string }[];
  buckets: { id: string; name: string }[];
  busy: boolean;
  error: string | null;
  onSave: (t: TypeInput) => void;
  onCancel: () => void;
}) {
  const { t, container } = useAdmin();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [base, setBase] = useState('managed-object');
  const [bucket, setBucket] = useState('');
  const [description, setDescription] = useState('');
  const valid = validTypeId(id);
  const sortedBases = useMemo(() => [...bases].sort((a, b) => a.name.localeCompare(b.name)), [bases]);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent container={container} closeLabel={t('close')} data-dm-type-dialog>
        <DialogHeader>
          <DialogTitle>{t('dm_new_type')}</DialogTitle>
        </DialogHeader>
        <div className={own.dialogBody}>
          <label className={styles.field}>
            {t('dm_type_name')}
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!id || id === slug(name)) setId(slug(e.target.value));
              }}
              placeholder="Workspace"
              data-dm-type-name
            />
          </label>
          <label className={styles.field}>
            {t('dm_type_id')}
            <Input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="workspace" data-dm-type-id />
            <span className={styles.sub}>{t('dm_type_id_hint')}</span>
          </label>
          <label className={styles.field}>
            {t('dm_type_extends')}
            <NativeSelect value={base} onChange={(e) => setBase(e.target.value)}>
              <NativeSelectOption value="">{t('dm_type_extends_nothing')}</NativeSelectOption>
              {sortedBases.map((b) => (
                <NativeSelectOption key={b.id} value={b.id}>
                  {b.name} ({b.id})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <span className={styles.sub}>{t('dm_type_extends_hint')}</span>
          </label>
          {buckets.length > 0 && (
            <label className={styles.field}>
              {t('dm_type_group')}
              <NativeSelect value={bucket} onChange={(e) => setBucket(e.target.value)}>
                <NativeSelectOption value="">{t('dm_type_group_base')}</NativeSelectOption>
                {buckets.map((b) => (
                  <NativeSelectOption key={b.id} value={b.id}>
                    {b.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          <label className={styles.field}>
            {t('dm_col_description')}
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={() =>
              onSave({
                id,
                name: name.trim() || id,
                ...(base ? { extends: base } : {}),
                ...(bucket ? { bucket } : {}),
                ...(description.trim() ? { description: description.trim() } : {}),
              })
            }
            data-dm-type-create
          >
            {busy ? t('dm_creating') : t('dm_create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
