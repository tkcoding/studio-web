import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { properties } = vi.hoisted(() => ({ properties: new Map<string, unknown>() }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useSharedProperty: (id: string) => properties.get(id),
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  readSharedAuthSession: () => ({ getSession: async () => ({ kind: 'bearer', token: 'tok' }) }),
}));
vi.mock('../../i18n', () => ({
  useAssistantTranslations: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(',')}` : key),
    loading: false,
  }),
}));

import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
} from '@constructor-studio/mfe-shared';
import { AssistantPanel } from './AssistantPanel';

const bridge = {} as ChildMfeBridge;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (...texts: string[]) =>
  new Response(
    texts.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`).join('') +
      'data: [DONE]\n\n',
    { status: 200 }
  );

const config = { model: 'claude-sonnet-5-5', provider: 'anthropic', developer_message_settings: 'system', reason: null };

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    properties.set(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION, { id: 'o-1', name: 'Acme' });
    properties.set(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE, { id: 'w-1', name: 'Web' });
  });

  afterEach(() => {
    cleanup();
    properties.clear();
  });

  it('rests as a rail and asks nothing until it is opened', () => {
    const fetchImpl = vi.fn();
    render(<AssistantPanel bridge={bridge} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(document.querySelector('[data-assistant="rail"]')).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('opened, reads the workspace’s client settings and offers the first question', async () => {
    const fetchImpl = vi.fn(async () => json(config));
    render(<AssistantPanel bridge={bridge} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    openPanel();
    expect(await screen.findByText(/first_question/)).toBeTruthy();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/cf/studio-llm/v1/workspaces/w-1/client-config');
    expect(screen.getByText(/claude-sonnet-5-5/)).toBeTruthy();
    expect(screen.getByText('context:Web')).toBeTruthy();
    expect(window.localStorage.getItem('studio.assistant.open')).toBe('1');
  });

  it('without a key, says where to add one in the server’s words, and offers no composer', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ model: null, provider: null, developer_message_settings: 'system', reason: 'Add a key to your profile.' })
    );
    render(<AssistantPanel bridge={bridge} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    openPanel();
    expect(await screen.findByText('Add a key to your profile.')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('streams an answer to a question and keeps the thread', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith('client-config') ? json(config) : sse('Open ', 'Specs.')));
    render(<AssistantPanel bridge={bridge} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    openPanel();
    await screen.findByText(/first_question/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Where do I start?' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(await screen.findByText('Open Specs.')).toBeTruthy();
    expect(screen.getByText('Where do I start?')).toBeTruthy();
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/cf/studio-llm/v1/workspaces/w-1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('organization "Acme"');
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'Where do I start?' });
  });

  it('shows a refusal in the server’s words, and Try again asks the same question', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('client-config')) return json(config);
      calls += 1;
      return calls === 1 ? json({ error: { message: 'anthropic could not be reached.' } }, 502) : sse('Fine now.');
    });
    render(<AssistantPanel bridge={bridge} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    openPanel();
    fireEvent.click(await screen.findByText(/first_question/));
    expect(await screen.findByText(/anthropic could not be reached\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'try_again' }));
    expect(await screen.findByText('Fine now.')).toBeTruthy();
    // The question is in the thread once, not twice.
    expect(screen.getAllByText('first_question')).toHaveLength(1);
  });

  it('a settings read that fails says so, not an endless spinner', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network');
    });
    render(<AssistantPanel bridge={bridge} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    openPanel();
    await waitFor(() => expect(document.querySelector('[data-assistant-config="failed"]')?.textContent).toBe('unavailable'));
  });
});
