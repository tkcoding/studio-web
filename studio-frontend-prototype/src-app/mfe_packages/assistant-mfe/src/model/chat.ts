/**
 * Studio AI's conversation, apart from React: what goes to studio-llm-proxy
 * and how its streamed answer is read back.
 *
 * The old prototype (`studio-ai.tsx`) asked mini-chat. This kit asks
 * studio-llm-proxy instead — Studio's one way out to a model provider, in every
 * build, on the person's own key (a workspace's AI connections count inside a
 * workspace) — through its OpenAI-compatible chat completions. The server picks
 * the model from the person's keys and rewrites it into the body, so the panel
 * never names one. The thread lives in the panel and is sent whole every turn:
 * nothing is stored on the server, as the prototype's single lazily created
 * chat was never listed again either.
 */

/** One turn of the thread. */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** Where the person is, as the shell publishes it. Everything optional. */
export interface PanelContext {
  organization?: string | null;
  workspace?: string | null;
  projectId?: string | null;
  section?: string | null;
}

/** `LlmClientConfigDto`: the model the caller gets, or why there is none. */
export interface ClientConfig {
  model?: string | null;
  provider?: string | null;
  /** user | system | developer | mergeWithFollowingUserMessage | skip */
  developer_message_settings: string;
  reason?: string | null;
}

export const LLM_BASE_URL = '/cf/studio-llm/v1';

/** The workspace's routes when one is in scope: its AI connections count too. */
export function llmPath(route: 'client-config' | 'chat/completions', workspaceId?: string | null): string {
  return workspaceId
    ? `${LLM_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/${route}`
    : `${LLM_BASE_URL}/${route}`;
}

/**
 * What the assistant is told about itself and where the person is. Read-only:
 * it answers about what the portal shows and does not act for the person, as
 * the prototype's said.
 */
export function systemPrompt(context: PanelContext): string {
  const where = [
    context.organization ? `organization "${context.organization}"` : null,
    context.workspace ? `workspace "${context.workspace}"` : null,
    context.projectId ? `project ${context.projectId}` : null,
    context.section ? `section "${context.section}"` : null,
  ].filter(Boolean);
  return [
    'You are Studio AI, the assistant inside the Constructor Studio portal.',
    'Studio turns a project\'s documents into a product built from gears: specs, a domain model, components, builds, environments and releases.',
    where.length > 0 ? `The person is looking at ${where.join(', ')}.` : 'The person has no organization open yet.',
    'You can only answer: you cannot see the screen\'s data or change anything in Studio. Say where in the portal to look when that helps. Be brief.',
  ].join(' ');
}

type WireMessage = { role: 'system' | 'developer' | 'user' | 'assistant'; content: string };

/**
 * The messages for one request, the system prompt placed the way the
 * provider takes it (`developer_message_settings`, the same setting the IDE's
 * chat follows).
 */
export function requestMessages(system: string, thread: readonly Turn[], settings: string): WireMessage[] {
  const turns: WireMessage[] = thread.map((turn) => ({ role: turn.role, content: turn.content }));
  switch (settings) {
    case 'skip':
      return turns;
    case 'user':
      return [{ role: 'user', content: system }, ...turns];
    case 'developer':
      return [{ role: 'developer', content: system }, ...turns];
    case 'mergeWithFollowingUserMessage': {
      const first = turns.findIndex((turn) => turn.role === 'user');
      if (first < 0) return [{ role: 'user', content: system }, ...turns];
      return turns.map((turn, index) =>
        index === first ? { ...turn, content: `${system}\n\n${turn.content}` } : turn
      );
    }
    default:
      return [{ role: 'system', content: system }, ...turns];
  }
}

/** What one read of the stream gave: the text added, whether it ended, and what is left to read. */
export interface StreamRead {
  text: string;
  done: boolean;
  rest: string;
}

/**
 * Reads the OpenAI chat-completions event stream: `data: {json}` lines, blank
 * lines between events, `data: [DONE]` at the end. A chunk with empty
 * `choices` (the usage the server asks for) adds nothing; an unreadable line is
 * skipped, not fatal. `rest` is an incomplete line to prepend to the next read.
 */
export function readStream(buffer: string): StreamRead {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  let text = '';
  let done = false;
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    try {
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] };
      text += chunk.choices?.[0]?.delta?.content ?? '';
    } catch {
      // Not a JSON event: nothing to add.
    }
  }
  return { text, done, rest };
}

/** The server's own words for a refusal (`{"error":{"message"}}`, or problem details), when it gave any. */
export function refusalMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as { error?: { message?: unknown } | string; detail?: unknown; title?: unknown };
  if (typeof value.error === 'object' && typeof value.error?.message === 'string') return value.error.message;
  if (typeof value.error === 'string') return value.error;
  if (typeof value.detail === 'string') return value.detail;
  if (typeof value.title === 'string') return value.title;
  return null;
}

/** A refused or failed request, with the status and the server's words. */
export class ChatError extends Error {
  constructor(
    readonly status: number,
    readonly serverMessage: string | null
  ) {
    super(serverMessage ?? `studio-llm answered ${status}`);
  }
}

export interface StreamChatOptions {
  fetchImpl?: typeof fetch;
  token: string | null;
  path: string;
  messages: WireMessage[];
  /** The whole answer so far, every time it grows. */
  onText: (full: string) => void;
  signal?: AbortSignal;
}

/** Asks for one streamed answer; resolves with the whole of it. */
export async function streamChat({
  fetchImpl = fetch,
  token,
  path,
  messages,
  onText,
  signal,
}: StreamChatOptions): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(path, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body: unknown = await res.json().catch(() => undefined);
    throw new ChatError(res.status, refusalMessage(body));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });
    const read = readStream(buffer);
    buffer = read.rest;
    if (read.text) {
      full += read.text;
      onText(full);
    }
    if (done || read.done) break;
  }
  return full;
}
