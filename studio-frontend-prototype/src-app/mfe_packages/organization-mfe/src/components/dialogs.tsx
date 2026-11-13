/**
 * The two dialogs this MFE's screens ask with: a confirmation before a
 * destructive write and a new name. Both show the gear's refusal in its own
 * words and stay open on one, as the prototype's `DataTable` danger action and
 * rename modal did; both close once the write succeeds.
 */

import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@gears-frontx/ui-kit';
import { errorMessage, refusalText } from '@constructor-studio/mfe-shared';
import styles from './dialogs.module.css';

/** The gear's own words for a refusal, else the error's message. */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

interface Labels {
  cancel: string;
  close: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  labels: Labels;
  container?: React.RefObject<HTMLElement | null>;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  body,
  confirmLabel,
  labels,
  container,
  onConfirm,
  onClose,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open && (
        <DialogContent container={container} closeLabel={labels.close} data-confirm-dialog>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              {labels.cancel}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()} data-confirm-go>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
};

ConfirmDialog.displayName = 'ConfirmDialog';

export interface NameDialogProps {
  open: boolean;
  title: string;
  fieldLabel: string;
  initial: string;
  saveLabel: string;
  savingLabel: string;
  labels: Labels;
  container?: React.RefObject<HTMLElement | null>;
  /** Called with the trimmed name when it changed; an unchanged name just closes. */
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}

export const NameDialog: React.FC<NameDialogProps> = ({
  open,
  title,
  fieldLabel,
  initial,
  saveLabel,
  savingLabel,
  labels,
  container,
  onSave,
  onClose,
}) => {
  const [value, setValue] = useState(initial);
  const [shownFor, setShownFor] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A dialog reopened for another row starts from that row's name.
  if (shownFor !== initial) {
    setShownFor(initial);
    setValue(initial);
    setError(null);
  }
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next || next === initial) {
      close();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      setBusy(false);
      onClose();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open && (
        <DialogContent container={container} closeLabel={labels.close} data-name-dialog>
          <form className={styles.form} onSubmit={(e) => void save(e)}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <Input autoFocus aria-label={fieldLabel} value={value} onChange={(e) => setValue(e.target.value)} />
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={busy || !value.trim()}>
                {busy ? savingLabel : saveLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
};

NameDialog.displayName = 'NameDialog';
