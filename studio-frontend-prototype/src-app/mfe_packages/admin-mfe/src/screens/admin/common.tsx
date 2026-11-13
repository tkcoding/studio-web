/**
 * What every Admin section shares: the dictionary, the language, the themed
 * container dialogs portal into, a page header, a confirmation dialog, and the
 * gear's own words for a refusal.
 */

import React, { createContext, useContext, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gears-frontx/ui-kit';
import { errorMessage, refusalText, type ScreenText } from '@constructor-studio/mfe-shared';
import styles from './Admin.module.css';

export interface AdminContextValue {
  t: ScreenText;
  language: string;
  /** Where dialogs portal: inside this screen's themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
  bridge: ChildMfeBridge | null;
}

const fallbackText = Object.assign((key: string) => key, {
  count: (key: string, count: number) => `${key} ${count}`,
}) as ScreenText;

export const AdminContext = createContext<AdminContextValue>({
  t: fallbackText,
  language: 'en',
  container: { current: null },
  bridge: null,
});

export function useAdmin(): AdminContextValue {
  return useContext(AdminContext);
}

/** The gear's own words for a refusal, else the error's message. */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

export const shortId = (id: string): string => id.slice(0, 8);

/** An instant, in the reader's language; a dash when there is none. */
export function when(ms: number | null | undefined, language: string): string {
  if (ms == null) return '—';
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? '—' : at.toLocaleString(language);
}

export function day(ms: number, language: string): string {
  return new Date(ms).toLocaleDateString(language);
}

export function Header({
  title,
  info,
  status,
  action,
}: {
  title: React.ReactNode;
  info?: React.ReactNode;
  status?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {status && <div className={styles.chips}>{status}</div>}
        {action && <div className={styles.headerAction}>{action}</div>}
      </header>
      {info && <div className={styles.about}>{info}</div>}
    </>
  );
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className={styles.error}>
      {children}
    </p>
  );
}

export interface ConfirmAsk {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
}

/**
 * A confirmation before a destructive write, as the prototype's DataTable
 * asked one. `ask(question, run)` opens it; the dialog shows what the write
 * answered when it fails, and closes when it succeeds.
 */
export function useConfirm(): [(ask: ConfirmAsk, run: () => Promise<unknown>) => void, React.ReactNode] {
  const { t, container } = useAdmin();
  const [open, setOpen] = useState<{ ask: ConfirmAsk; run: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await open.run();
      setOpen(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Dialog
      open={open !== null}
      onOpenChange={(next) => {
        if (!next && !busy) setOpen(null);
      }}
    >
      {open && (
        <DialogContent container={container} closeLabel={t('close')} data-admin-confirm>
          <DialogHeader>
            <DialogTitle>{open.ask.title}</DialogTitle>
            <DialogDescription>{open.ask.body}</DialogDescription>
          </DialogHeader>
          {error && <ErrorLine>{error}</ErrorLine>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()} data-admin-confirm-go>
              {open.ask.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );

  return [
    (ask, run) => {
      setError(null);
      setOpen({ ask, run });
    },
    dialog,
  ];
}
