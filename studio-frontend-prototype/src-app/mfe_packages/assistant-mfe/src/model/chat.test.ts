import { describe, expect, it, vi } from 'vitest';
import {
  ChatError,
  llmPath,
  readStream,
  refusalMessage,
  requestMessages,
  streamChat,
  systemPrompt,
  type Turn,
} from './chat';

const sse = (...events: string[]) => events.map((e) => `data: ${e}\n\n`).join('');
const delta = (text: string) => JSON.stringify({ choices: [{ delta: { content: text } }] });

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('llmPath', () => {
  it('asks the workspace’s routes when a workspace is in scope, else the person’s', () => {
    expect(llmPath('client-config')).toBe('/cf/studio-llm/v1/client-config');
    expect(llmPath('chat/completions', 'w 1')).toBe('/cf/studio-llm/v1/workspaces/w%201/chat/completions');
  });
});

describe('systemPrompt', () => {
  it('says where the person is, and that it only answers', () => {
    const prompt = systemPrompt({ organization: 'Acme', workspace: 'Web', projectId: 'p-1', section: 'specs' });
    expect(prompt).toContain('organization "Acme"');
    expect(prompt).toContain('workspace "Web"');
    expect(prompt).toContain('project p-1');
    expect(prompt).toContain('section "specs"');
    expect(prompt).toContain('cannot see the screen');
  });

  it('says so when nothing is open', () => {
    expect(systemPrompt({})).toContain('no organization open');
  });
});

describe('requestMessages', () => {
  const thread: Turn[] = [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'Q2' },
  ];

  it('puts the system prompt first as the provider takes it', () => {
    expect(requestMessages('S', thread, 'system')[0]).toEqual({ role: 'system', content: 'S' });
    expect(requestMessages('S', thread, 'developer')[0]).toEqual({ role: 'developer', content: 'S' });
    expect(requestMessages('S', thread, 'user')[0]).toEqual({ role: 'user', content: 'S' });
    expect(requestMessages('S', thread, 'skip')).toHaveLength(3);
  });

  it('merges it into the first question when the provider wants that', () => {
    const merged = requestMessages('S', thread, 'mergeWithFollowingUserMessage');
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ role: 'user', content: 'S\n\nQ1' });
    expect(merged[2]).toEqual({ role: 'user', content: 'Q2' });
  });
});

describe('readStream', () => {
  it('adds the deltas, skips the usage chunk and stops at [DONE]', () => {
    const read = readStream(sse(delta('Hel'), delta('lo'), JSON.stringify({ choices: [], usage: {} }), '[DONE]'));
    expect(read).toEqual({ text: 'Hello', done: true, rest: '' });
  });

  it('keeps an incomplete line for the next read', () => {
    const first = readStream(`data: ${delta('a')}\ndata: {"choi`);
    expect(first.text).toBe('a');
    expect(first.rest).toBe('data: {"choi');
  });

  it('skips a line that is not JSON', () => {
    expect(readStream('data: nonsense\n').text).toBe('');
  });
});

describe('refusalMessage', () => {
  it('reads the OpenAI-shaped error and problem details', () => {
    expect(refusalMessage({ error: { message: 'No anthropic key for you' } })).toBe('No anthropic key for you');
    expect(refusalMessage({ detail: 'gone' })).toBe('gone');
    expect(refusalMessage('x')).toBeNull();
  });
});

describe('streamChat', () => {
  it('streams the answer with the bearer and resolves with the whole of it', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(streamOf([sse(delta('Hi')).slice(0, 10), sse(delta('Hi')).slice(10), sse(delta(' there'), '[DONE]')]))
    );
    const seen: string[] = [];
    const full = await streamChat({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: 't-1',
      path: '/cf/studio-llm/v1/chat/completions',
      messages: [{ role: 'user', content: 'Q' }],
      onText: (text) => seen.push(text),
    });
    expect(full).toBe('Hi there');
    expect(seen).toEqual(['Hi', 'Hi there']);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t-1');
    expect(JSON.parse(init.body as string)).toEqual({ messages: [{ role: 'user', content: 'Q' }], stream: true });
  });

  it('turns a refusal into a ChatError carrying the server’s words', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'No key' } }), { status: 403 })
    );
    const failure = streamChat({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: null,
      path: '/x',
      messages: [],
      onText: () => undefined,
    });
    await expect(failure).rejects.toBeInstanceOf(ChatError);
    await expect(failure).rejects.toMatchObject({ status: 403, serverMessage: 'No key' });
  });
});
