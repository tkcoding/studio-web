/**
 * Admin › System — the prototype's `SystemView` (`App.tsx`) carried over
 * (ADR-0069): live observability over the platform's gears. People before
 * processes: who is in Studio now with a note to one of them (`presence.tsx`
 * `WhoIsOnline`); then the one gear behaviour you can trigger by hand and watch
 * land, a test notification (`notifications.tsx`: a chat connection now or
 * through the queue, or the IDE of whoever has a workspace open); then the raw
 * state — the registered permissions, the running gears, the outbound gateway's
 * upstreams and the GTS entities, each as a table with its raw JSON a click away.
 *
 * The prototype's "Domain model" card lives in Admin › Studio domain model.
 * Each read fails on its own: one gear missing does not blank the page, and its
 * card says what the gear answered.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  refusalReason,
  useOrganization,
  type OrganizationRef,
  type ScreenText,
} from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type { ConnectorProvider, NotifyTarget, PresenceEntry, StoredConnection } from '../../api/types';
import {
  EXAMPLES,
  asksTopic,
  countOf,
  entityRows,
  fixedTarget,
  gearsOf,
  isNotificationProvider,
  isReadFailure,
  messageBody,
  permissionParts,
  permissionsIn,
  type NotifyLevel,
} from '../../model/system';
import { ErrorLine, Header, errText, shortId, useAdmin, when } from './common';

/**
 * A refusal of the online list or of a notification, said as who may (#1044):
 * the gears refuse with a reason token, and the screen names the role. Anything
 * else in the gear's own words.
 */
export function systemRefusal(e: unknown, t: ScreenText): string {
  switch (refusalReason(e)) {
    case 'PLATFORM_ADMIN_REQUIRED':
      return t('sys_refused_platform_admin');
    case 'ORG_ADMIN_REQUIRED':
      return t('sys_refused_org_admin');
    default:
      return errText(e);
  }
}
import styles from './Admin.module.css';

/** How often people report in, and so how often the list is worth asking again. */
export const PRESENCE_REFRESH_MS = 30_000;

export function SystemSection() {
  const { t } = useAdmin();
  const { org } = useOrganization();
  return (
    <>
      <Header title={t('sys_title')} info={<p>{t('sys_about')}</p>} />
      <WhoIsOnline />
      {org ? (
        <Notifications key={org.id} org={org} />
      ) : (
        <Card data-system-notify-none>
          <CardContent className={styles.cardBody}>
            <h3 className={styles.subtitle}>{t('sys_notify_title')}</h3>
            <p className={styles.muted}>{t('sys_notify_no_org')}</p>
          </CardContent>
        </Card>
      )}
      <PlatformState />
    </>
  );
}

/* ── Who is in Studio now ── */

function WhoIsOnline() {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [people, setPeople] = useState<PresenceEntry[] | null>(null);
  const [ttl, setTtl] = useState(90_000);
  // The refusal itself, said at render time in the reader's language.
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const err = failure ? systemRefusal(failure.error, t) : null;
  const [meId, setMeId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [writingTo, setWritingTo] = useState<PresenceEntry | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    const read = () =>
      api.presenceOnline.fetch({ staleTime: 0 }).then(
        (r) => {
          if (!live) return;
          setPeople(r.items ?? []);
          if (typeof r.online_ttl_ms === 'number') setTtl(r.online_ttl_ms);
          setFailure(null);
        },
        (e: unknown) => {
          if (!live) return;
          setFailure({ error: e });
          setPeople((current) => current ?? []);
        }
      );
    void read();
    // Refreshed on the cadence people report in on: faster shows the same answer more often.
    const timer = setInterval(() => void read(), PRESENCE_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, tick]);

  useEffect(() => {
    let live = true;
    accounts.getMe
      .fetch()
      .then((me) => live && setMeId(me?.subject_id ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accounts]);

  const send = async () => {
    if (!writingTo || !text.trim()) return;
    setSending(true);
    setSent(null);
    try {
      const r = await api.presenceSend.fetch({ to_user_id: writingTo.user_id, text: text.trim() });
      // The one thing the sender has to read: a note to somebody who left is not queued.
      setSent(r.delivered ? t('sys_note_delivered', { seconds: PRESENCE_REFRESH_MS / 1000 }) : t('sys_note_not_delivered'));
      if (r.delivered) {
        setText('');
        setWritingTo(null);
      }
    } catch (e) {
      setSent(errText(e));
    } finally {
      setSending(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (people ?? [])
    .filter((p) => !q || [p.display_name, p.place, p.detail].some((s) => s?.toLowerCase().includes(q)))
    .sort((a, b) => b.last_seen_ms - a.last_seen_ms);

  return (
    <Card data-system-presence>
      <CardContent className={styles.cardBody}>
        <div className={styles.header}>
          <h3 className={styles.subtitle}>
            {t('sys_online_title')}
            {people ? ` · ${people.length}` : ''}
          </h3>
          <div className={styles.headerAction}>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              {t('sys_refresh')}
            </Button>
          </div>
        </div>
        <p className={styles.muted}>{t('sys_online_about', { seconds: Math.round(ttl / 1000) })}</p>
        {err && <ErrorLine>{err}</ErrorLine>}
        <Input
          className={styles.search}
          value={query}
          placeholder={t('sys_search_people')}
          aria-label={t('sys_search_people')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {people === null ? (
          <p className={styles.muted}>{t('reading')}</p>
        ) : people.length === 0 ? (
          !err && <p className={styles.muted}>{t('sys_online_empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sys_col_person')}</TableHead>
                <TableHead>{t('sys_col_where')}</TableHead>
                <TableHead>{t('sys_col_since')}</TableHead>
                <TableHead>{t('sys_col_seen')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => (
                <TableRow key={p.user_id} data-presence={p.user_id}>
                  <TableCell>
                    {p.display_name || <code className={styles.mono}>{shortId(p.user_id)}…</code>}
                    {p.user_id === meId && <span className={styles.sub}> {t('sys_you')}</span>}
                  </TableCell>
                  <TableCell>
                    {p.place}
                    {p.detail ? <span className={styles.sub}> · {p.detail}</span> : null}
                  </TableCell>
                  <TableCell className={styles.sub}>{when(p.since_ms, language)}</TableCell>
                  <TableCell className={styles.sub}>{when(p.last_seen_ms, language)}</TableCell>
                  <TableCell>
                    {/* Writing to yourself works and checks the channel, but is not what this button is for. */}
                    {p.user_id !== meId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setWritingTo(p);
                          setSent(null);
                        }}
                        data-presence-message
                      >
                        {t('sys_message')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {writingTo && (
          <div className={styles.panel} data-presence-note>
            <h4 className={styles.name}>{t('sys_note_to', { name: writingTo.display_name || writingTo.user_id })}</h4>
            <Textarea
              autoFocus
              rows={3}
              placeholder={t('sys_note_placeholder')}
              aria-label={t('sys_note_placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className={styles.inline}>
              <Button size="sm" disabled={sending || !text.trim()} onClick={() => void send()} data-presence-send>
                {sending ? t('sys_sending') : t('sys_send')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWritingTo(null)}>
                {t('cancel')}
              </Button>
            </div>
            <p className={styles.sub}>{t('sys_note_about')}</p>
          </div>
        )}
        {sent && (
          <p className={styles.muted} role="status" data-presence-sent>
            {sent}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── A test notification ── */

interface Draft {
  title: string;
  text: string;
  link: string;
  topic: string;
  level: NotifyLevel;
}

const EMPTY: Draft = { title: '', text: '', link: '', topic: '', level: 'info' };

function ExampleChips({ onPick }: { onPick: (patch: Partial<Draft>) => void }) {
  const { t } = useAdmin();
  return (
    <div className={styles.chips}>
      <span className={styles.sub}>{t('sys_start_from')}</span>
      {EXAMPLES.map((x) => (
        <Button
          key={x.key}
          size="sm"
          variant="outline"
          type="button"
          onClick={() =>
            onPick({
              title: t(`sys_example_${x.key}_title`),
              text: t(`sys_example_${x.key}_text`),
              link: x.link(window.location.origin),
              level: x.level,
            })
          }
          data-notify-example={x.key}
        >
          {t(`sys_example_${x.key}`)}
        </Button>
      ))}
    </div>
  );
}

function MessageFields({ draft, onChange, askTopic }: { draft: Draft; onChange: (patch: Partial<Draft>) => void; askTopic: boolean }) {
  const { t } = useAdmin();
  return (
    <>
      <label className={styles.field}>
        {t('sys_field_title')}
        <Input value={draft.title} placeholder={t('sys_example_import_title')} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className={styles.field}>
        {t('sys_field_text')}
        <Textarea rows={3} value={draft.text} placeholder={t('sys_field_text_hint')} onChange={(e) => onChange({ text: e.target.value })} />
      </label>
      <label className={styles.field}>
        {t('sys_field_link')}
        <Input value={draft.link} placeholder={t('sys_field_link_hint')} onChange={(e) => onChange({ link: e.target.value })} />
      </label>
      {askTopic && (
        <label className={styles.field}>
          {t('sys_field_topic')}
          <Input value={draft.topic} placeholder={t('sys_field_topic_hint')} onChange={(e) => onChange({ topic: e.target.value })} />
        </label>
      )}
    </>
  );
}

function Notifications({ org }: { org: OrganizationRef }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [providers, setProviders] = useState<ConnectorProvider[]>([]);
  const [connections, setConnections] = useState<StoredConnection[] | null>(null);

  // A build with no connector driver answers 503: that means "no chat targets", which the panel says.
  useEffect(() => {
    let live = true;
    void Promise.all([
      api.connectorProviders.fetch({ staleTime: 0 }).then(
        (r) => r.items ?? [],
        () => [] as ConnectorProvider[]
      ),
      api.storedConnections({ tenant: org.id }).fetch({ staleTime: 0 }).then(
        (r) => r.items ?? [],
        () => [] as StoredConnection[]
      ),
    ]).then(([p, c]) => {
      if (!live) return;
      setProviders(p);
      setConnections(c);
    });
    return () => {
      live = false;
    };
  }, [api, org.id]);

  const chats = useMemo(() => (connections ?? []).filter((c) => isNotificationProvider(c.provider)), [connections]);

  return (
    <>
      {connections === null ? (
        <Card>
          <CardContent className={styles.cardBody}>
            <h3 className={styles.subtitle}>{t('sys_notify_title')}</h3>
            <p className={styles.muted}>{t('reading')}</p>
          </CardContent>
        </Card>
      ) : chats.length === 0 ? (
        <Card data-notify-no-chat>
          <CardContent className={styles.cardBody}>
            <h3 className={styles.subtitle}>{t('sys_notify_title')}</h3>
            <p className={styles.muted}>{t('sys_notify_no_chat')}</p>
          </CardContent>
        </Card>
      ) : (
        <ChatNotifier org={org} connections={chats} providers={providers} />
      )}
      <EditorNotifier org={org} />
    </>
  );
}

function ChatNotifier({
  org,
  connections,
  providers,
}: {
  org: OrganizationRef;
  connections: StoredConnection[];
  providers: ConnectorProvider[];
}) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  /** The channels read for one connection; another connection's answer is no answer for this one. */
  const [read, setRead] = useState<{ id: string; targets: NotifyTarget[]; note: string | null } | null>(null);
  /** The channel picked (or typed) per connection. */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<'send' | 'queue' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connection = connections.find((c) => c.id === connectionId) ?? null;
  const provider = providers.find((p) => p.provider === connection?.provider);
  const fixed = fixedTarget(connection?.provider, provider?.fixed_target);
  const targets = read?.id === connectionId ? read.targets : null;
  const targetsNote = read?.id === connectionId ? read.note : null;
  const target = picks[connectionId] ?? targets?.[0]?.id ?? '';
  const setTarget = (value: string) => setPicks((p) => ({ ...p, [connectionId]: value }));
  const picked = targets?.find((x) => x.id === target);
  const topic = asksTopic(connection?.provider, picked?.topic_required);

  useEffect(() => {
    let live = true;
    if (!connectionId || fixed) return;
    api
      .notifyTargets({ id: connectionId, tenant: org.id })
      .fetch({ staleTime: 0 })
      .then(
        (page) => live && setRead({ id: connectionId, targets: page.items ?? [], note: null }),
        // A rotated credential or a bot in no channels: the channel id can still be typed.
        (e: unknown) => live && setRead({ id: connectionId, targets: [], note: errText(e) })
      );
    return () => {
      live = false;
    };
  }, [api, connectionId, org.id, fixed]);

  async function act(mode: 'send' | 'queue') {
    if (!connectionId) return;
    setBusy(mode);
    setError(null);
    setResult(null);
    const body = { target: fixed ? undefined : target.trim() || undefined, ...messageBody(draft) };
    try {
      if (mode === 'send') {
        const sent = await api.sendConnectorMessage(connectionId, org.id).fetch(body);
        setResult(
          sent.message_id
            ? t('sys_delivered_id', { target: sent.target, id: sent.message_id })
            : t('sys_delivered', { target: sent.target })
        );
      } else {
        const queued = await api.queueNotification.fetch({ connection_id: connectionId, tenant_id: org.id, ...body });
        setResult(t('sys_queued', { run: shortId(queued.run_id) }));
      }
    } catch (e) {
      setError(systemRefusal(e, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-notify-chat>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('sys_notify_title')}</h3>
        <p className={styles.muted}>{t('sys_notify_about')}</p>
        <label className={styles.field}>
          {t('sys_through')}
          <NativeSelect value={connectionId} onChange={(e) => setConnectionId(e.target.value)} data-notify-connection>
            {connections.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.label} — {c.provider}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {fixed ? (
          <p className={styles.sub}>{t('sys_webhook_fixed')}</p>
        ) : (
          <label className={styles.field}>
            {t('sys_channel')}
            {targets === null ? (
              <span className={styles.sub}>{t('sys_channels_loading')}</span>
            ) : targets.length > 0 ? (
              <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)} data-notify-target>
                {targets.map((x) => (
                  <NativeSelectOption key={x.id} value={x.id}>
                    {x.container ? `${x.container} / ` : ''}
                    {x.name}
                    {x.private ? ` (${t('sys_private')})` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input value={target} placeholder={t('sys_channel_id')} onChange={(e) => setTarget(e.target.value)} />
            )}
            {targetsNote && <span className={styles.sub}>{targetsNote}</span>}
          </label>
        )}
        <ExampleChips onPick={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <MessageFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} askTopic={topic} />
        <div className={styles.inline}>
          <Button size="sm" disabled={!draft.text.trim() || busy !== null} onClick={() => void act('queue')} data-notify-queue>
            {busy === 'queue' ? t('sys_queueing') : t('sys_queue')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            title={t('sys_send_now_hint')}
            disabled={!draft.text.trim() || busy !== null}
            onClick={() => void act('send')}
            data-notify-send
          >
            {busy === 'send' ? t('sys_sending') : t('sys_send_now')}
          </Button>
        </div>
        <p className={styles.sub}>{t('sys_queue_or_send')}</p>
        {result && (
          <p className={styles.muted} role="status" data-notify-result>
            {result}
          </p>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </CardContent>
    </Card>
  );
}

/** The other destination: the IDE of whoever has a workspace of the organization open. */
function EditorNotifier({ org }: { org: OrganizationRef }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([org]);
  const [workspaceId, setWorkspaceId] = useState(org.id);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, level: 'warn' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    accounts
      .getWorkspaces({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((page) => live && setSpaces([org, ...(page?.items ?? []).map((w) => ({ id: w.id, name: w.name }))]))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accounts, org]);

  async function queue() {
    setBusy(true);
    setError(null);
    setResult(null);
    const { topic: _topic, ...body } = messageBody(draft);
    try {
      const queued = await api.queueNotification.fetch({ workspace_id: workspaceId, tenant_id: org.id, level: draft.level, ...body });
      setResult(t('sys_editor_queued', { run: shortId(queued.run_id) }));
    } catch (e) {
      // No live session: refused here rather than queued for nobody.
      setError(systemRefusal(e, t));
    } finally {
      setBusy(false);
    }
  }

  const name = spaces.find((s) => s.id === workspaceId)?.name ?? org.name;

  return (
    <Card data-notify-editor>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('sys_editor_title')}</h3>
        <p className={styles.muted}>{t('sys_editor_about', { name })}</p>
        <div className={styles.inline}>
          <label className={styles.field}>
            {t('sys_editor_workspace')}
            <NativeSelect value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} data-notify-workspace>
              {spaces.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className={styles.field}>
            {t('sys_level')}
            <NativeSelect value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value as NotifyLevel })}>
              <NativeSelectOption value="info">{t('sys_level_info')}</NativeSelectOption>
              <NativeSelectOption value="warn">{t('sys_level_warn')}</NativeSelectOption>
              <NativeSelectOption value="error">{t('sys_level_error')}</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>
        <ExampleChips onPick={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <MessageFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} askTopic={false} />
        <div className={styles.inline}>
          <Button size="sm" disabled={!draft.text.trim() || busy} onClick={() => void queue()} data-notify-editor-send>
            {busy ? t('sys_queueing') : t('sys_editor_send')}
          </Button>
        </div>
        {result && (
          <p className={styles.muted} role="status" data-notify-editor-result>
            {result}
          </p>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </CardContent>
    </Card>
  );
}

/* ── The platform's raw state ── */

type RawKey = 'gears' | 'upstreams' | 'entities';
const RAW_KEYS: RawKey[] = ['gears', 'upstreams', 'entities'];

function PlatformState() {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [raw, setRaw] = useState<Partial<Record<RawKey, unknown>>>({});
  const [shownSections, setShownSections] = useState<Record<RawKey, boolean>>({ gears: true, upstreams: true, entities: true });

  useEffect(() => {
    let live = true;
    const grab = (key: RawKey, read: Promise<unknown>) =>
      read
        .catch((e: unknown) => ({ error: errText(e) }))
        .then((value) => live && setRaw((current) => ({ ...current, [key]: value })));
    void grab('gears', api.gears.fetch({ staleTime: 0 }));
    void grab('upstreams', api.oagwUpstreams.fetch({ staleTime: 0 }));
    void grab('entities', api.gtsEntities.fetch({ staleTime: 0 }));
    return () => {
      live = false;
    };
  }, [api]);

  const permissions = permissionsIn(raw.entities);
  const count = (key: RawKey) => {
    const n = countOf(raw[key]);
    return n === null ? '—' : String(n);
  };

  return (
    <>
      <Card data-system-permissions>
        <CardContent className={styles.cardBody}>
          <h3 className={styles.subtitle}>{t.count('sys_permissions', permissions.length)}</h3>
          <p className={styles.muted}>{t('sys_permissions_about')}</p>
          {raw.entities === undefined ? (
            <p className={styles.muted}>{t('reading')}</p>
          ) : isReadFailure(raw.entities) ? (
            <ErrorLine>{raw.entities.error}</ErrorLine>
          ) : permissions.length === 0 ? (
            <p className={styles.muted}>{t('sys_permissions_none')}</p>
          ) : (
            <PermissionsTable ids={permissions} />
          )}
        </CardContent>
      </Card>

      <div className={styles.chips} role="group" aria-label={t('sys_sections')}>
        <span className={styles.sub}>{t('sys_sections')}</span>
        {RAW_KEYS.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={shownSections[key] ? 'secondary' : 'ghost'}
            aria-pressed={shownSections[key]}
            onClick={() => setShownSections((s) => ({ ...s, [key]: !s[key] }))}
            data-system-toggle={key}
          >
            {t(`sys_raw_${key}`)}
          </Button>
        ))}
      </div>
      {RAW_KEYS.every((key) => !shownSections[key]) && <p className={styles.muted}>{t('sys_all_hidden')}</p>}

      {RAW_KEYS.filter((key) => shownSections[key]).map((key) => (
        <RawCard key={key} name={key} title={`${t(`sys_raw_${key}`)} (${count(key)})`} source={t(`sys_raw_${key}_source`)} data={raw[key]}>
          {key === 'gears' ? <GearsTable data={raw.gears} /> : key === 'entities' ? <EntitiesTable data={raw.entities} /> : null}
        </RawCard>
      ))}
    </>
  );
}

/** A raw read: its table when there is one, and its JSON behind a toggle (or always, when there is none). */
function RawCard({
  name,
  title,
  source,
  data,
  children,
}: {
  name: string;
  title: string;
  source: string;
  data: unknown;
  children?: React.ReactNode;
}) {
  const { t } = useAdmin();
  const [json, setJson] = useState(false);
  const showJson = json || !children;
  return (
    <Card data-system-raw={name}>
      <CardContent className={styles.cardBody}>
        <div className={styles.header}>
          <h3 className={styles.subtitle}>{title}</h3>
          {children && data !== undefined && !isReadFailure(data) && (
            <div className={styles.headerAction}>
              <Button size="sm" variant="ghost" aria-pressed={json} onClick={() => setJson((v) => !v)} data-system-json={name}>
                {json ? t('sys_hide_json') : t('sys_show_json')}
              </Button>
            </div>
          )}
        </div>
        <p className={styles.mono}>{source}</p>
        {data === undefined ? (
          <p className={styles.muted}>{t('reading')}</p>
        ) : isReadFailure(data) ? (
          <ErrorLine>{data.error}</ErrorLine>
        ) : showJson ? (
          <pre className={styles.mono} style={{ overflow: 'auto', maxHeight: '18rem', margin: 0 }} data-system-json-body={name}>
            {JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function Pills({ items }: { items: string[] | undefined }) {
  if (!items?.length) return <span className={styles.sub}>—</span>;
  return (
    <div className={styles.chips}>
      {items.map((c) => (
        <Badge key={c} variant="outline">
          {c}
        </Badge>
      ))}
    </div>
  );
}

function GearsTable({ data }: { data: unknown }) {
  const { t } = useAdmin();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('');
  const gears = gearsOf(data);
  const modes = [...new Set(gears.map((g) => g.deployment_mode ?? '—'))].sort();
  const q = query.trim().toLowerCase();
  const shown = gears
    .filter((g) => !mode || (g.deployment_mode ?? '—') === mode)
    .filter((g) => !q || [g.name, ...(g.capabilities ?? []), ...(g.dependencies ?? [])].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className={styles.toolbar}>
        <Input className={styles.search} value={query} placeholder={t('sys_search_gears')} aria-label={t('sys_search_gears')} onChange={(e) => setQuery(e.target.value)} />
        {modes.length > 1 && (
          <NativeSelect size="sm" value={mode} aria-label={t('sys_col_mode')} onChange={(e) => setMode(e.target.value)}>
            <NativeSelectOption value="">{t('sys_any_mode')}</NativeSelectOption>
            {modes.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {m}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sys_col_gear')}</TableHead>
            <TableHead>{t('sys_col_capabilities')}</TableHead>
            <TableHead>{t('sys_col_dependencies')}</TableHead>
            <TableHead>{t('sys_col_mode')}</TableHead>
            <TableHead className={styles.num}>{t('sys_col_instances')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((g) => (
            <TableRow key={g.name} data-gear={g.name}>
              <TableCell className={styles.name}>{g.name}</TableCell>
              <TableCell>
                <Pills items={g.capabilities} />
              </TableCell>
              <TableCell>
                <Pills items={g.dependencies} />
              </TableCell>
              <TableCell className={styles.sub}>{g.deployment_mode ?? '—'}</TableCell>
              <TableCell className={styles.num}>{g.instances?.length ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className={styles.sub}>{t('sys_shown_of', { shown: shown.length, total: gears.length })}</p>
    </>
  );
}

function PermissionsTable({ ids }: { ids: string[] }) {
  const { t } = useAdmin();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = ids.filter((id) => !q || id.toLowerCase().includes(q));
  return (
    <>
      <Input className={styles.search} value={query} placeholder={t('sys_search_permissions')} aria-label={t('sys_search_permissions')} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ maxHeight: '28rem', overflow: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sys_col_permission')}</TableHead>
              <TableHead>{t('sys_col_version')}</TableHead>
              <TableHead>{t('sys_col_id')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((id) => {
              const { name, version } = permissionParts(id);
              return (
                <TableRow key={id} data-permission={id}>
                  <TableCell className={styles.name}>{name}</TableCell>
                  <TableCell className={styles.sub}>{version}</TableCell>
                  <TableCell className={styles.mono}>{id}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className={styles.sub}>{t('sys_shown_of', { shown: shown.length, total: ids.length })}</p>
    </>
  );
}

function EntitiesTable({ data }: { data: unknown }) {
  const { t } = useAdmin();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'' | 'type' | 'instance'>('');
  const rows = entityRows(data);
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => !kind || r.kind === kind)
    .filter((r) => !q || [r.id, r.title, r.description].some((s) => s.toLowerCase().includes(q)));
  return (
    <>
      <div className={styles.toolbar}>
        <Input className={styles.search} value={query} placeholder={t('sys_search_entities')} aria-label={t('sys_search_entities')} onChange={(e) => setQuery(e.target.value)} />
        {(['', 'type', 'instance'] as const).map((k) => (
          <Button key={k || 'all'} size="sm" variant={kind === k ? 'secondary' : 'ghost'} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k ? t(`sys_kind_${k}`) : t('everyone')}
          </Button>
        ))}
      </div>
      <div style={{ maxHeight: '28rem', overflow: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sys_col_entity')}</TableHead>
              <TableHead>{t('sys_col_kind')}</TableHead>
              <TableHead>{t('sys_col_id')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id} data-entity={r.id}>
                <TableCell>
                  <div className={styles.name}>{r.title || '—'}</div>
                  {r.description && <div className={styles.sub}>{r.description}</div>}
                </TableCell>
                <TableCell className={styles.sub}>{t(`sys_kind_${r.kind}`)}</TableCell>
                <TableCell className={styles.mono}>{r.id}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className={styles.sub}>{t('sys_shown_of', { shown: shown.length, total: rows.length })}</p>
    </>
  );
}
