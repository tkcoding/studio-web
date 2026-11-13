/** `check` (a detector's verdict on a document) or `comment` (what a person said). */
export type ActivityEventKind = 'check' | 'comment';

/** One thing that happened to a project (`ActivityEventDto`, studio-artifact-ingest). */
export interface ActivityEvent {
  id: string;
  kind: ActivityEventKind;
  /** What happened, in the product's words. */
  event: string;
  /** What it happened to: a document, or the issue a comment is on. */
  subject: string;
  /** Who or what did it; a detector is a "who" here. */
  by: string;
  /** RFC 3339, or null. An undated row sorts last, not first. */
  recorded?: string | null;
  /** The detector's own word for how it went, when there is one. */
  severity?: string | null;
}

/** `GET /studio-artifact-ingest/v1/activity` (`ActivityFeedListDto`). */
export interface ActivityFeed {
  items: ActivityEvent[];
  total: number;
}

/** `GET /studio-domain-model/v1/types`: the part this kit reads. */
export interface DomainTypesResponse {
  ontology: { entities?: unknown[]; buckets?: unknown[] };
  can_edit_model: boolean;
}

/** One object of `POST /studio-domain-model/v1/query`. */
export interface DomainObject {
  id: string;
  entity?: string;
  value: Record<string, unknown>;
}

/** `POST /studio-domain-model/v1/query` (`QueryObjectsResponse`), the part this kit reads. */
export interface DomainQueryResult {
  items: DomainObject[];
  total: number;
  complete: boolean;
  warnings: string[];
  groups?: { key: unknown[]; count: number }[] | null;
}

export type DomainQuery = Record<string, unknown>;

export interface DomainMutation {
  validate?: 'strict' | 'warn' | 'off';
  operations: Record<string, unknown>[];
}
