/**
 * The editor under a connection's row — the prototype's `EditConnection`
 * (`App.tsx` at 00828880). It exists because Remove-and-add mints a new id and
 * every project source names its connection by id; a PATCH keeps the id and
 * the credstore reference. An empty token keeps the stored credential, and the
 * backend verifies the change against it either way. Scope is not editable: it
 * is the credstore sharing mode, and changing it is a delete-and-recreate.
 */

import { useState, type FormEvent } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Input } from '@gears-frontx/ui-kit';
import type { OrganizationRef } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import type { StoredConnection } from '../../../api/types';
import { ErrorLine, errText, useAdmin } from '../common';
import own from './Integrations.module.css';

export function EditConnection({
  org,
  connection,
  onNote,
  onDone,
}: {
  org: OrganizationRef;
  connection: StoredConnection;
  onNote: (text: string) => void;
  onDone: (changed: boolean) => void;
}) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [label, setLabel] = useState(connection.label);
  const [baseUrl, setBaseUrl] = useState(connection.base_url);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = label.trim() !== connection.label || baseUrl.trim() !== connection.base_url || secret.trim().length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Only what changed: an unchanged field left out is no "same value" write to reason about.
      const r = await api.patchConnection(connection.id, org.id).fetch({
        ...(label.trim() !== connection.label ? { label: label.trim() } : {}),
        ...(baseUrl.trim() !== connection.base_url ? { base_url: baseUrl.trim() } : {}),
        ...(secret.trim() ? { token: secret.trim() } : {}),
      });
      onNote(r.account ? t('int_updated', { account: r.account }) : t('int_updated_unnamed'));
      onDone(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={own.form} onSubmit={(e) => void save(e)} data-connection-editor>
      <Input aria-label={t('int_label')} placeholder={t('int_label')} value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input
        aria-label={t('int_edit_url')}
        placeholder={t('int_edit_url')}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <Input
        type="password"
        autoComplete="new-password"
        aria-label={t('int_edit_token')}
        placeholder={t('int_edit_token')}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <p className={own.hint}>{t('int_edit_hint')}</p>
      <div className={own.actions}>
        <Button type="submit" size="sm" disabled={!dirty || busy} data-connection-save>
          {busy ? t('int_verifying') : t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onDone(false)}>
          {t('cancel')}
        </Button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  );
}
