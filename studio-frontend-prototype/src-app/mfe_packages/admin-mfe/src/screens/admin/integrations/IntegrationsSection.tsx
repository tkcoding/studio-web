/**
 * Admin › Integrations and Organization › Connections — the prototype's
 * `ConnectorsView` (`App.tsx` at 00828880) with the organization as its tenant,
 * which is how the prototype rendered both. What the organization connects to
 * and shares with its projects: the connections as a table with their health
 * (asked once, kept five minutes), the provider picker and the credential form,
 * a connection made by signing in, the editor that keeps the connection's id,
 * and the repository browser of a source-code connection. A person's own
 * connections are not listed here; they are on the profile, which renders this
 * same screen with `personal` (the prototype's `ConnectorsView owner="personal"`).
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Card, CardContent } from '@gears-frontx/ui-kit';
import { responseStatus, useOrganization, type OrganizationRef } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../../api/AdminApiService';
import type { ConnectorProvider, StoredConnection } from '../../../api/types';
import {
  environmentsByConnection,
  personalConnections,
  personalProviders,
  sharedConnections,
} from '../../../model/connections';
import { ErrorLine, Header, errText, useAdmin } from '../common';
import { AddConnection } from './AddConnection';
import { ConnectionTable } from './ConnectionTable';
import styles from '../Admin.module.css';

export function IntegrationsSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) {
    return (
      <>
        <Header title={t('int_title')} />
        <p className={styles.muted}>{t('int_no_org')}</p>
      </>
    );
  }
  return <Integrations key={org.id} org={org} />;
}

/**
 * One organization's connections: the shared ones (Admin › Integrations), or with
 * `personal` the caller's own there (Profile), which are added only as the caller's.
 */
export function Integrations({ org, personal = false }: { org: OrganizationRef; personal?: boolean }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [providers, setProviders] = useState<ConnectorProvider[] | null>(null);
  const [connections, setConnections] = useState<StoredConnection[] | null>(null);
  const [disabled, setDisabled] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The provider picker: closed (null), open on every kind (''), or open on one kind. */
  const [adding, setAdding] = useState<string | null>(null);
  /** Bumped when a repository is attached, so the browsers' "attached" marks follow. */
  const [sourcesTick, setSourcesTick] = useState(0);
  const [envUses, setEnvUses] = useState<Map<string, string[]>>(new Map());

  // Which environments deploy with each cluster, for Used by. A failure leaves the column quiet.
  // A person's own connections are never a cluster or a registry, so the profile does not ask.
  useEffect(() => {
    if (personal) return;
    let live = true;
    api
      .environments({ orgId: org.id })
      .fetch({ staleTime: 0 })
      .then((r) => live && setEnvUses(environmentsByConnection(r.items ?? [])))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, org.id, personal]);

  const reload = useCallback(
    () =>
      Promise.all([
        api.connectorProviders.fetch({ staleTime: 0 }),
        api.storedConnections({ tenant: org.id, withAncestors: true }).fetch({ staleTime: 0 }),
      ]).then(
        ([p, c]) => {
          setProviders(p.items ?? []);
          setConnections(c.items ?? []);
          setDisabled(null);
          setErr(null);
        },
        (e: unknown) => {
          // 503: no driver plugin is registered in this build. Said plainly, not as an
          // empty list that reads as "nothing connected".
          if (responseStatus(e) === 503) {
            setDisabled(errText(e));
            setProviders([]);
            setConnections([]);
          } else {
            setErr(errText(e));
          }
        }
      ),
    [api, org.id]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const listed =
    connections === null ? null : personal ? personalConnections(connections) : sharedConnections(connections);

  return (
    <>
      {personal ? (
        <h3 className={styles.subtitle} data-my-connections={org.id}>
          {t('prof_connections_in', { name: org.name })}
        </h3>
      ) : (
        <Header
          title={t('int_title')}
          info={
            <>
              <p>{t('int_about', { name: org.name })}</p>
              <p>{t('int_about_tokens')}</p>
            </>
          }
        />
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      {note && (
        <p className={styles.notice} role="status" data-integrations-note>
          {note}
        </p>
      )}
      {disabled && (
        <Card data-integrations-disabled>
          <CardContent className={styles.cardBody}>
            <h3 className={styles.subtitle}>{t('int_unavailable')}</h3>
            <p className={styles.muted}>{disabled}</p>
          </CardContent>
        </Card>
      )}

      {/* What is connected comes first; the picker opens above the list only when someone adds one. */}
      {!disabled && adding !== null && (
        <AddConnection
          org={org}
          providers={providers ?? []}
          category={adding || undefined}
          personal={personal}
          onClose={() => setAdding(null)}
          onAdded={(r) => {
            setNote(
              r.display_name
                ? t('int_connected_as_named', { account: r.account, name: r.display_name })
                : t('int_connected_as', { account: r.account })
            );
            setAdding(null);
            void reload();
          }}
        />
      )}

      {!disabled && (
        <ConnectionTable
          org={org}
          providers={personal ? personalProviders(providers ?? []) : (providers ?? [])}
          connections={listed ?? []}
          // A failed read stays "reading" under its error, never "nothing connected".
          loading={listed === null}
          sourcesTick={sourcesTick}
          envUses={envUses}
          adding={adding !== null}
          onAdd={(category) => setAdding(category ?? '')}
          onSourcesChanged={() => setSourcesTick((n) => n + 1)}
          onChanged={() => void reload()}
          onNote={setNote}
        />
      )}
    </>
  );
}
