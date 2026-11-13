// From the prototype's `SystemView` (`App.tsx`), `system-tables.tsx` and `notifications.tsx`: the pure parts —
// counting a raw list whichever key a gear wraps it under, the gears as rows, the registered permissions read off
// the entities by id pattern, the GTS entities as rows, which providers carry a message, and the ready-made test
// messages. Titles and texts of the examples are in i18n (`sys_example_<key>_*`).

/** A gear as `gear-orchestrator` reports it. */
export interface GearRow {
  name: string;
  capabilities?: string[];
  dependencies?: string[];
  deployment_mode?: string;
  instances?: unknown[];
}

/** A read that failed, kept beside the ones that did not (`{ error }`, as the prototype's `grab`). */
export interface ReadFailure {
  error: string;
}

export function isReadFailure(value: unknown): value is ReadFailure {
  return !!value && typeof value === 'object' && typeof (value as ReadFailure).error === 'string';
}

const LIST_KEYS = ['items', 'gears', 'nodes', 'data', 'entities'];

/** The list inside a raw answer: the answer itself, or the array under a key gears commonly wrap it in. */
export function listOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of LIST_KEYS) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

/** How many a raw answer lists, or null when it is not a list. */
export function countOf(value: unknown): number | null {
  return listOf(value)?.length ?? null;
}

/** The gears, from either a bare array or `{ gears: [...] }`. */
export function gearsOf(value: unknown): GearRow[] {
  return (listOf(value) ?? []).filter(
    (g): g is GearRow => !!g && typeof g === 'object' && typeof (g as GearRow).name === 'string'
  );
}

const PERMISSION = /gts\.cf\.toolkit\.authz\.permission\.v1~[a-zA-Z0-9_.]+\.v\d+/g;

/**
 * Every `gts.cf.toolkit.authz.permission.v1~…` id registered, sorted and once each. Read by id pattern from the
 * whole answer, so the list survives a change in the entities' shape.
 */
export function permissionsIn(entities: unknown): string[] {
  if (entities == null || isReadFailure(entities)) return [];
  return [...new Set(JSON.stringify(entities).match(PERMISSION) ?? [])].sort();
}

/** A permission id split for reading: the gear's namespace and the action, `…~cf.studio.people.view.v1`. */
export function permissionParts(id: string): { name: string; version: string } {
  const tail = id.split('~')[1] ?? id;
  const m = /^(.*)\.(v\d+)$/.exec(tail);
  return m ? { name: m[1], version: m[2] } : { name: tail, version: '' };
}

/** One registered GTS entity, as rows show it. */
export interface EntityRow {
  id: string;
  kind: 'type' | 'instance';
  title: string;
  description: string;
}

/** The entities, each with its id, whether it is a type (`…~` at the end) or an instance, and its title. */
export function entityRows(value: unknown): EntityRow[] {
  return (listOf(value) ?? [])
    .map((raw) => {
      const e = (raw ?? {}) as { gts_id?: unknown; id?: unknown; content?: { title?: unknown; description?: unknown } };
      const id = typeof e.gts_id === 'string' ? e.gts_id : typeof e.id === 'string' ? e.id : '';
      const title = typeof e.content?.title === 'string' ? e.content.title : '';
      const description = typeof e.content?.description === 'string' ? e.content.description : '';
      return { id, kind: id.endsWith('~') ? 'type' : 'instance', title, description } as EntityRow;
    })
    .filter((row) => row.id !== '')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Providers whose connections can carry a message. */
export const NOTIFY_PROVIDERS = [
  'slack',
  'slack_webhook',
  'zulip',
  'zulip_webhook',
  'discord',
  'discord_webhook',
] as const;

export function isNotificationProvider(provider: string | undefined): boolean {
  return !!provider && (NOTIFY_PROVIDERS as readonly string[]).includes(provider);
}

/** A webhook's channel is fixed in its URL, so there is nothing to pick. */
export function fixedTarget(provider: string | undefined, declared: boolean | undefined): boolean {
  return declared ?? (provider?.endsWith('_webhook') ?? false);
}

/** Zulip needs a topic on every message (it supplies a default when empty). */
export function asksTopic(provider: string | undefined, declared: boolean | undefined): boolean {
  return declared ?? (provider?.startsWith('zulip') ?? false);
}

export type NotifyLevel = 'info' | 'warn' | 'error';

/** The ready-made messages, so a test starts from something real; the words are `sys_example_<key>_*`. */
export const EXAMPLES: { key: string; level: NotifyLevel; link: (origin: string) => string }[] = [
  { key: 'import', level: 'info', link: (origin) => `${origin}/` },
  { key: 'gate', level: 'warn', link: (origin) => `${origin}/` },
  { key: 'run', level: 'error', link: (origin) => `${origin}/organization/tasks` },
  { key: 'release', level: 'info', link: (origin) => `${origin}/` },
];

/** What a message form sends: trimmed, and empty fields left out. */
export function messageBody(draft: { title: string; text: string; link: string; topic: string }): {
  title?: string;
  text: string;
  link?: string;
  topic?: string;
} {
  return {
    title: draft.title.trim() || undefined,
    text: draft.text.trim(),
    link: draft.link.trim() || undefined,
    topic: draft.topic.trim() || undefined,
  };
}
