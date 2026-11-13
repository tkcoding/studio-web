/**
 * Connect a place for the organization: a Kubernetes cluster (by a kubeconfig
 * or a token, with the bootstrap manifest its administrator applies once) or
 * an OCI registry (ADR-0048). The prototype's kubeconfig-field.tsx (00828880):
 * a cluster's credential is chosen as a file or pasted, never typed into one
 * input line, which would fold a kubeconfig's YAML into one line the server
 * cannot read. Both are stored in credstore for the organization through
 * studio-connector, which tests them before it keeps them.
 */

import { useRef, useState } from 'react';
import { Button, Card, CardContent, Input, Textarea } from '@gears-frontx/ui-kit';
import type { Connection } from '../../api/types';
import { clusterHost, kubeconfigServer } from '../../model/kubeconfig';
// What the cluster's administrator applies once. A copy of the repository's
// deploy/k8s/studio-environments/bootstrap.yaml inside this package, read at
// build time: the portal's image builds from studio-frontend-prototype/ alone,
// which cannot reach the repository's deploy/. src/assets/bootstrap.test.ts
// fails when the copy and the repository's file drift apart.
import BOOTSTRAP from '../../assets/bootstrap.yaml?raw';
import { errText, useApi, useInfra } from './parts';
import styles from './InfrastructureScreen.module.css';

function KubeconfigField({
  value,
  reveal,
  onReveal,
  placeholder,
  onChange,
}: {
  value: string;
  reveal: boolean;
  onReveal: () => void;
  placeholder: string;
  onChange: (text: string) => void;
}) {
  const { t } = useInfra();
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lines = value ? value.split('\n').length : 0;
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className={styles.hidden}
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
            (err: unknown) => setReadError(t('kubeconfig_unreadable', { file: file.name, error: String(err) }))
          );
        }}
      />
      <div className={styles.row}>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {t('kubeconfig_choose')}
        </Button>
        <span className={`${styles.grow} ${styles.hint}`}>
          {fileName
            ? t('kubeconfig_file', { file: fileName, lines })
            : value
              ? t.count('kubeconfig_pasted', lines)
              : t('kubeconfig_or_paste')}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onReveal}>
          {reveal ? t('hide') : t('show')}
        </Button>
      </div>
      {reveal || !value ? (
        <Textarea
          rows={reveal ? 10 : 3}
          spellCheck={false}
          className={styles.mono}
          placeholder={placeholder}
          value={value}
          aria-label={t('kubeconfig_label')}
          onChange={(e) => {
            setFileName(null);
            onChange(e.target.value);
          }}
        />
      ) : null}
      {readError && <p className={styles.error}>{readError}</p>}
    </>
  );
}

/** Connect a cluster for the organization: the only reach an environment
 *  accepts, since a deploy runs as the server. */
export function AddCluster({ onAdded, onCancel }: { onAdded: (c: Connection) => void; onCancel: () => void }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [credential, setCredential] = useState('');
  const [server, setServer] = useState('');
  const [label, setLabel] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.createConnection.fetch({
        provider: 'kubernetes',
        label: label.trim() || clusterHost(server),
        base_url: server.trim(),
        token: credential,
        scope: 'organization',
        owner_tenant_id: org.id,
      });
      onAdded(answer.connection);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-add-cluster>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.formTitle}>{t('connect_cluster')}</h3>
        <p className={styles.hint}>{t('connect_cluster_hint')}</p>
        <details className={styles.advanced} data-cluster-bootstrap>
          <summary>{t('bootstrap_title')}</summary>
          <p className={styles.hint}>
            {t('bootstrap_hint', {
              namespace: '<project>-<environment>',
              account: 'studio-environments/deployer',
              role: 'admin',
              command: 'kubectl apply -f',
            })}
          </p>
          <div className={styles.row}>
            <span className={`${styles.grow} ${styles.hint}`}>bootstrap.yaml</span>
            {copied && <span className={styles.hint}>{t('copied')}</span>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-bootstrap-copy
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(BOOTSTRAP)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }
            >
              {t('copy')}
            </Button>
          </div>
          <pre className={styles.manifest} data-bootstrap-manifest>
            {BOOTSTRAP}
          </pre>
        </details>
        <KubeconfigField
          value={credential}
          reveal={reveal}
          onReveal={() => setReveal((v) => !v)}
          placeholder={t('kubeconfig_placeholder')}
          onChange={(text) => {
            setCredential(text);
            const s = kubeconfigServer(text);
            if (s && !server.trim()) setServer(s);
          }}
        />
        <label className={styles.field}>
          {t('api_server')}
          <Input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://kubernetes.example.com:6443"
            aria-label={t('api_server')}
          />
        </label>
        <label className={styles.field}>
          {t('field_name')}
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={server ? clusterHost(server) : t('cluster_name_placeholder')}
            aria-label={t('place_name')}
          />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button
            type="button"
            disabled={busy || !credential.trim() || !server.trim()}
            onClick={() => void save()}
            data-add-cluster-save
          >
            {busy ? t('checking_cluster') : t('test_connect')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Connect an OCI registry for the organization (ADR-0048): its address and
 *  a login. The username and token are stored together as one credential,
 *  `username:token`; only the server uses it, to let the cluster pull and to
 *  fetch a published chart. */
export function AddRegistry({ onAdded, onCancel }: { onAdded: (c: Connection) => void; onCancel: () => void }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [address, setAddress] = useState('https://ghcr.io');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = (() => {
    try {
      return new URL(address.trim()).host;
    } catch {
      return '';
    }
  })();
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.createConnection.fetch({
        provider: 'registry',
        label: label.trim() || host,
        base_url: address.trim(),
        token: username.trim() ? `${username.trim()}:${secret.trim()}` : secret.trim(),
        scope: 'organization',
        owner_tenant_id: org.id,
      });
      onAdded(answer.connection);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-add-registry>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.formTitle}>{t('connect_registry')}</h3>
        <p className={styles.hint}>{t('connect_registry_hint')}</p>
        <label className={styles.field}>
          {t('registry_address')}
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https://ghcr.io"
            aria-label={t('registry_address')}
          />
        </label>
        <label className={styles.field}>
          {t('registry_username')}
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('registry_username_placeholder')}
            aria-label={t('registry_username')}
          />
        </label>
        <label className={styles.field}>
          {t('registry_token')}
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={t('registry_token_placeholder')}
            aria-label={t('registry_token')}
          />
        </label>
        <label className={styles.field}>
          {t('field_name')}
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={host || t('registry_name_placeholder')}
            aria-label={t('place_name')}
          />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="button" disabled={busy || !secret.trim() || !host} onClick={() => void save()} data-add-registry-save>
            {busy ? t('logging_in') : t('test_connect')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
