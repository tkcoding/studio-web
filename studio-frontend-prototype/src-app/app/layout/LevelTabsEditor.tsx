/**
 * Customize tabs — the prototype's band editor (`level-tabs-ui.tsx`,
 * `BandMenu`): every tab the level has, each with a switch. A switch flipped
 * shows in the row at once (`onPreview`), before anything is saved; Save
 * writes the names that are off to the level's settings document
 * (`hidden_tabs`), for everyone in that organization, workspace or project.
 * Nothing a tab shows is removed. The last tab showing cannot be switched off.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { errorMessage, hiddenToSave, refusalText } from '@constructor-studio/mfe-shared';
import { useShellText } from '@/app/i18n/shellTranslations';
import { cn } from '@/app/lib/utils';
import styles from './LevelTabs.module.css';

export interface EditorTab {
  /** The tab's model name, what `hidden_tabs` stores. */
  id: string;
  label: string;
}

export interface LevelTabsEditorProps {
  /** Every tab the level could show, in its order. */
  tabs: readonly EditorTab[];
  /** What the document hides now. */
  hidden: readonly string[];
  onSave: (hidden: string[]) => Promise<void>;
  /** The names switched off so far while editing; null when done. */
  onPreview: (hidden: string[] | null) => void;
}

export const LevelTabsEditor: React.FC<LevelTabsEditorProps> = ({ tabs, hidden, onSave, onPreview }) => {
  const t = useShellText();
  const [off, setOff] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const editing = off !== null;

  const close = useCallback(() => {
    setOff(null);
    setError(null);
    onPreview(null);
  }, [onPreview]);

  // Escape, or a pointer down outside the editor, is Cancel.
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (panel.current && e.target instanceof Node && !panel.current.contains(e.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [editing, close]);

  if (tabs.length === 0) return null;

  const change = (next: Set<string>) => {
    setOff(next);
    onPreview([...next]);
  };
  const ids = tabs.map((tab) => tab.id);
  const next = off ? hiddenToSave(ids, off, hidden) : null;
  const showing = off ? tabs.filter((tab) => !off.has(tab.id)).length : tabs.length;

  return (
    <div className={styles.editorAnchor} ref={panel}>
      <button
        type="button"
        className={cn(styles.aside, editing && styles.asideOn)}
        aria-expanded={editing}
        title={t('level_tabs_customize_hint')}
        data-tabs-customize
        onClick={() => {
          if (editing) {
            close();
            return;
          }
          setError(null);
          setOff(new Set(hidden.filter((name) => ids.includes(name))));
        }}
      >
        <SlidersHorizontal aria-hidden="true" className={styles.asideGlyph} />
        {t('level_tabs_customize')}
      </button>
      {off && (
        <div className={styles.editor} role="dialog" aria-label={t('level_tabs_customize_title')}>
          <strong>{t('level_tabs_customize_title')}</strong>
          <p className={styles.editorNote}>{t('level_tabs_customize_note')}</p>
          <ul className={styles.editorList}>
            {tabs.map((tab) => {
              const on = !off.has(tab.id);
              // The last tab showing stays: a row is never empty.
              const last = on && showing <= 1;
              return (
                <li key={tab.id}>
                  <label className={styles.editorRow} title={last ? t('level_tabs_keep_one') : undefined}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t('level_tabs_show_named', { label: tab.label })}
                      checked={on}
                      disabled={last}
                      onChange={(e) => {
                        const changed = new Set(off);
                        if (e.target.checked) changed.delete(tab.id);
                        else changed.add(tab.id);
                        change(changed);
                      }}
                    />
                    <span>{tab.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {error && (
            <p role="alert" className={styles.editorError}>
              {error}
            </p>
          )}
          <div className={styles.editorFoot}>
            <button
              type="button"
              className={styles.aside}
              disabled={off.size === 0}
              title={t('level_tabs_reset_hint')}
              onClick={() => change(new Set())}
            >
              {t('level_tabs_reset')}
            </button>
            <span className={styles.editorSpacer} />
            <button type="button" className={styles.aside} onClick={close}>
              {t('level_tabs_cancel')}
            </button>
            <button
              type="button"
              className={cn(styles.aside, styles.asideOn)}
              disabled={busy || next === null}
              title={next === null ? t('level_tabs_keep_one') : undefined}
              data-tabs-save
              onClick={async () => {
                if (next === null) return;
                setBusy(true);
                setError(null);
                try {
                  await onSave(next);
                  close();
                } catch (e) {
                  setError(refusalText(e) ?? errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? t('level_tabs_saving') : t('level_tabs_save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

LevelTabsEditor.displayName = 'LevelTabsEditor';
