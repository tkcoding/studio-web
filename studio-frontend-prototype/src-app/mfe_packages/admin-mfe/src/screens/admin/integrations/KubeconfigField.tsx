/**
 * A cluster's credential — the prototype's `KubeconfigField`
 * (`kubeconfig-field.tsx` at 00828880): chosen as a file or pasted, never typed
 * into one input line, which would fold a kubeconfig's YAML into one line the
 * server cannot read.
 */

import { useRef, useState } from 'react';
import { Button, Textarea } from '@gears-frontx/ui-kit';
import { ErrorLine, useAdmin } from '../common';
import styles from '../Admin.module.css';
import own from './Integrations.module.css';

export function KubeconfigField({
  value,
  reveal,
  onReveal,
  placeholder,
  label,
  onChange,
}: {
  value: string;
  reveal: boolean;
  onReveal: () => void;
  placeholder: string;
  label: string;
  onChange: (text: string) => void;
}) {
  const { t } = useAdmin();
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lines = value ? value.split('\n').length : 0;
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className={own.hidden}
        data-kubeconfig-file
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setReadError(null);
          file.text().then(
            (text) => {
              setFileName(file.name);
              onChange(text);
            },
            (err: unknown) => setReadError(t('int_kubeconfig_unreadable', { file: file.name, error: String(err) }))
          );
        }}
      />
      <div className={own.actions}>
        <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          {t('int_kubeconfig_choose')}
        </Button>
        <span className={`${styles.grow} ${own.hint}`}>
          {fileName
            ? t('int_kubeconfig_file', { file: fileName, lines })
            : value
              ? t.count('int_kubeconfig_pasted', lines)
              : t('int_kubeconfig_or_paste')}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={onReveal}>
          {reveal ? t('int_hide') : t('int_show')}
        </Button>
      </div>
      {reveal || !value ? (
        <Textarea
          rows={reveal ? 10 : 3}
          spellCheck={false}
          className={styles.mono}
          placeholder={placeholder}
          aria-label={label}
          value={value}
          onChange={(e) => {
            setFileName(null);
            onChange(e.target.value);
          }}
        />
      ) : null}
      {readError && <ErrorLine>{readError}</ErrorLine>}
    </>
  );
}
