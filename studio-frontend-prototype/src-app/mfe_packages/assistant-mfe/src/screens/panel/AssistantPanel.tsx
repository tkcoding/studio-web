/**
 * Studio AI — the assistant docked to the right edge of the shell (the old
 * prototype's `studio-ai.tsx`), as the built-in kit `assistant`.
 *
 * The shell gives the kit its sidebar slot only while the kit is installed
 * where the person is (`layout/KitDock.tsx`); this screen does not ask again.
 * It draws its own footprint: a 48px rail at rest, a 368px column open, so it
 * takes room from the screen rather than covering it, as the prototype's dock
 * did. Whether it is open is kept in this browser.
 *
 * It answers through studio-llm-proxy on the person's own key (`model/chat.ts`).
 * Before the first question it reads the client settings: a person without a
 * key is told where to add one — the server's own sentence — instead of a
 * composer whose every question fails.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { useSharedProperty } from '@gears-frontx/react';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  readSharedAuthSession,
  useHostChrome,
} from '@constructor-studio/mfe-shared';
import {
  ChatError,
  llmPath,
  refusalMessage,
  requestMessages,
  streamChat,
  systemPrompt,
  type ClientConfig,
  type Turn,
} from '../../model/chat';
import { useAssistantTranslations } from '../../i18n';
import styles from './AssistantPanel.module.css';

const OPEN_KEY = 'studio.assistant.open';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function keepOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Not kept: the rail comes back closed next time.
  }
}

/** The person's bearer, from the shell's session (the panel streams with plain fetch). */
async function currentToken(): Promise<string | null> {
  const session = await readSharedAuthSession()?.getSession();
  return session?.kind === 'bearer' ? session.token : null;
}

type ConfigState =
  | { state: 'loading' }
  | { state: 'ready'; config: ClientConfig }
  | { state: 'failed'; message: string | null };

/** A settings answer, with the workspace it was read for (`''` for none). */
type ConfigRead = Exclude<ConfigState, { state: 'loading' }> & { for: string };

const named = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
    ? (value as { name: string }).name
    : null;
const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : null;

export interface AssistantPanelProps {
  bridge: ChildMfeBridge;
  /** For tests: the transport. */
  fetchImpl?: typeof fetch;
}

export const AssistantPanel: React.FC<AssistantPanelProps> = ({ bridge, fetchImpl }) => {
  const { t, loading } = useAssistantTranslations();
  const { containerRef, dataTheme } = useHostChrome();
  const organization = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION, { bridge });
  const workspace = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE, { bridge });
  const project = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, { bridge });
  const section = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_SECTION, { bridge });
  const workspaceId = idOf(workspace);

  const [open, setOpen] = useState(readOpen);
  const [configRead, setConfigRead] = useState<ConfigRead | null>(null);
  // An answer for another workspace is not this one's: loading until it comes.
  const config: ConfigState = useMemo(
    () => (configRead && configRead.for === (workspaceId ?? '') ? configRead : { state: 'loading' }),
    [configRead, workspaceId]
  );
  const [thread, setThread] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const abort = useRef<AbortController | null>(null);
  const transport = fetchImpl ?? fetch;

  const toggle = (next: boolean) => {
    setOpen(next);
    keepOpen(next);
  };

  // The settings are read when the panel opens, and again in another workspace
  // (whose AI connections may give a key the person lacks).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const key = workspaceId ?? '';
    void (async () => {
      try {
        const token = await currentToken();
        const res = await transport(llmPath('client-config', workspaceId), {
          headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const body: unknown = await res.json().catch(() => undefined);
        if (!alive) return;
        if (!res.ok) setConfigRead({ state: 'failed', message: refusalMessage(body), for: key });
        else setConfigRead({ state: 'ready', config: body as ClientConfig, for: key });
      } catch {
        if (alive) setConfigRead({ state: 'failed', message: null, for: key });
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, workspaceId, transport]);

  useEffect(() => () => abort.current?.abort(), []);

  // The answer as it streams, for a Stop that keeps it.
  const answerRef = useRef<string | null>(null);
  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  const ask = useCallback(
    async (text: string, history: Turn[]) => {
      const content = text.trim();
      if (!content || busy || config.state !== 'ready' || !config.config.model) return;
      const asked: Turn[] = [...history, { role: 'user', content }];
      setThread(asked);
      setBusy(true);
      setError(null);
      setAnswer('');
      const controller = new AbortController();
      abort.current = controller;
      try {
        const system = systemPrompt({
          organization: named(organization),
          workspace: named(workspace),
          projectId: typeof project === 'string' ? project : null,
          section: typeof section === 'string' ? section : null,
        });
        const full = await streamChat({
          fetchImpl: transport,
          token: await currentToken(),
          path: llmPath('chat/completions', workspaceId),
          messages: requestMessages(system, asked, config.config.developer_message_settings),
          onText: setAnswer,
          signal: controller.signal,
        });
        setThread([...asked, { role: 'assistant', content: full }]);
        setAnswer(null);
      } catch (cause) {
        if (controller.signal.aborted) {
          // Stopped by the person: keep what came, as their answer.
          setThread((current) => (answerRef.current ? [...current, { role: 'assistant', content: answerRef.current }] : current));
          setAnswer(null);
        } else {
          setAnswer(null);
          setError(cause instanceof ChatError && cause.serverMessage ? cause.serverMessage : t('unavailable'));
        }
      } finally {
        abort.current = null;
        setBusy(false);
      }
    },
    [busy, config, organization, workspace, project, section, workspaceId, transport, t]
  );

  const send = (text: string) => {
    setDraft('');
    void ask(text, thread);
  };

  /** The last question again, after a failure. */
  const retry = () => {
    const last = thread[thread.length - 1];
    if (last?.role !== 'user') return;
    void ask(last.content, thread.slice(0, -1));
  };

  if (!open) {
    return (
      <div ref={containerRef} data-theme={dataTheme} className={styles.root}>
        <aside className={`${styles.dock} ${styles.collapsed}`} aria-label={t('title')} data-assistant="rail">
          <button
            type="button"
            className={styles.railOpen}
            aria-label={t('open')}
            aria-expanded={false}
            title={t('title')}
            onClick={() => toggle(true)}
          >
            <span className={styles.mark} aria-hidden="true">
              ✦
            </span>
          </button>
        </aside>
      </div>
    );
  }

  const noKey = config.state === 'ready' && !config.config.model;
  const canAsk = config.state === 'ready' && !!config.config.model && !busy;

  return (
    <div ref={containerRef} data-theme={dataTheme} className={styles.root}>
      <aside className={styles.dock} aria-label={t('title')} data-assistant="open">
        <div className={styles.head}>
          <span className={styles.mark} aria-hidden="true">
            ✦
          </span>
          <span className={styles.title}>{t('title')}</span>
          {thread.length > 0 && !busy && (
            <button
              type="button"
              className={styles.ghost}
              data-assistant-new
              onClick={() => {
                setThread([]);
                setError(null);
              }}
            >
              {t('new')}
            </button>
          )}
          <button
            type="button"
            className={styles.ghost}
            aria-label={t('collapse')}
            aria-expanded
            title={t('collapse')}
            onClick={() => toggle(false)}
          >
            ›
          </button>
        </div>

        <div className={styles.ctx}>
          <div className={styles.ctxLabel}>
            {t('context', { place: named(workspace) ?? named(organization) ?? t('portal') })}
            {config.state === 'ready' && config.config.model && (
              <span data-assistant-model> · {config.config.model}</span>
            )}
          </div>

          {loading || config.state === 'loading' ? (
            <p className={styles.muted} role="status">
              {t('loading')}
            </p>
          ) : config.state === 'failed' ? (
            <p className={styles.error} role="alert" data-assistant-config="failed">
              {config.message ?? t('unavailable')}
            </p>
          ) : noKey ? (
            <p className={styles.notice} data-assistant-config="no-key">
              {config.config.reason ?? t('no_key')}
            </p>
          ) : thread.length === 0 ? (
            <button type="button" className={styles.chip} data-assistant-suggestion onClick={() => send(t('first_question'))}>
              ✦ {t('first_question')}
            </button>
          ) : (
            <ol className={styles.thread} aria-live="polite">
              {thread.map((turn, index) => (
                <li key={index} className={turn.role === 'user' ? styles.question : styles.answer} data-turn={turn.role}>
                  {turn.content}
                </li>
              ))}
              {answer !== null && (
                <li className={styles.answer} data-turn="streaming">
                  {answer || '…'}
                </li>
              )}
            </ol>
          )}
          {error && (
            <div className={styles.error} role="alert" data-assistant-error>
              {error}{' '}
              <button type="button" className={styles.link} onClick={retry}>
                {t('try_again')}
              </button>
            </div>
          )}
        </div>

        <form
          className={styles.input}
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!canAsk}
          />
          {busy ? (
            <button type="button" className={styles.send} aria-label={t('stop')} title={t('stop')} onClick={() => abort.current?.abort()}>
              ■
            </button>
          ) : (
            <button type="submit" className={styles.send} disabled={!canAsk || !draft.trim()} aria-label={t('send')} title={t('send')}>
              ↑
            </button>
          )}
        </form>
      </aside>
    </div>
  );
};

AssistantPanel.displayName = 'AssistantPanel';
