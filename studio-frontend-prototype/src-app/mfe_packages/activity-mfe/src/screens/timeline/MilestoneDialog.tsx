/**
 * Add or edit a milestone, the prototype's `MilestoneDialog`: name, date and
 * status first, then — behind "N more fields from the model" — whatever else
 * the `milestone` type has. One `POST /mutate`: a `patch` of the milestone or
 * an `upsert` of a new one in the project's scope. A refusal is shown in the
 * gear's words and the draft is kept.
 */

import React, { useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
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
import { errorMessage, refusalText, type ScreenText } from '@constructor-studio/mfe-shared';
import { ActivityApiService } from '../../api/ActivityApiService';
import type { ModelField } from '../../model/fields';
import {
  FIRST_FIELDS,
  canSave,
  draftOf,
  newKey,
  orderedFields,
  saveOperation,
  type Draft,
  type Milestone,
} from '../../model/timeline';
import styles from '../Screen.module.css';

const errText = (e: unknown) => refusalText(e) ?? errorMessage(e);

export function MilestoneDialog({
  t,
  container,
  orgId,
  projectId,
  fields,
  milestone,
  onClose,
  onSaved,
}: {
  t: ScreenText;
  container: React.RefObject<HTMLDivElement | null>;
  orgId: string;
  projectId: string;
  fields: readonly ModelField[];
  milestone: Milestone | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const ordered = orderedFields(fields);
  const [draft, setDraft] = useState<Draft>(() => draftOf(ordered, milestone));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = (n: string) => (FIRST_FIELDS as readonly string[]).includes(n);
  const shownFields = more ? ordered : ordered.filter((f) => first(f.name));
  const hidden = ordered.length - shownFields.length;
  const title = milestone ? t('edit_milestone') : t('add_milestone');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiRegistry
        .getService(ActivityApiService)
        .mutateDomain(orgId)
        .fetch({ operations: [saveOperation(ordered, draft, milestone, projectId, newKey())] });
      await onSaved();
    } catch (e) {
      setError(t('save_failed', { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const set = (name: string, v: string | boolean) => setDraft((d) => ({ ...d, [name]: v }));

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent container={container} closeLabel={t('close')} data-milestone-dialog>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className={styles.form}>
          {shownFields.map((f) =>
            f.name === 'target_at' ? (
              <React.Fragment key={f.name}>
                <label className={styles.label} htmlFor="attr-target_at">
                  {t('field_date')} *
                </label>
                <Input
                  id="attr-target_at"
                  type="date"
                  value={String(draft.target_at ?? '')}
                  onChange={(e) => set('target_at', e.target.value)}
                />
              </React.Fragment>
            ) : (
              <FieldInput key={f.name} field={f} value={draft[f.name] ?? ''} onChange={(v) => set(f.name, v)} />
            )
          )}
        </div>
        {ordered.length > FIRST_FIELDS.length && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setMore((v) => !v)} data-milestone-more>
              {more ? t('fewer_fields') : t.count('more_fields', hidden)}
            </Button>
          </div>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !canSave(draft)} data-milestone-save>
            {busy ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One field as the model describes it: a box, a choice, or a checkbox. */
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
  let input: React.ReactNode;
  if (k.kind === 'boolean') {
    input = <Checkbox id={id} checked={value === true} onCheckedChange={(v) => onChange(v === true)} />;
  } else if (k.kind === 'enum') {
    input = (
      <NativeSelect id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">—</NativeSelectOption>
        {k.values.map((v) => (
          <NativeSelectOption key={v} value={v}>
            {v.replace(/_/g, ' ')}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  } else {
    input = (
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.type}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <>
      <label className={styles.label} htmlFor={id} title={field.description || field.type}>
        {field.name === 'name' ? field.name : field.name.replace(/_/g, ' ')}
        {(field.required || field.name === 'name') && ' *'}
      </label>
      {input}
    </>
  );
}
