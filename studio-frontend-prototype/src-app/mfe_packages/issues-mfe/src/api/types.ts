/**
 * What the Issues kit reads and writes, as the backend answers it. The
 * request shapes the moved model modules take (`SpecModelEntityEdit`,
 * `SpecModelSentence`, `SpecModelWrite`) are the
 * prototype's (`src/api.ts` at 00828880), unchanged; the queue's row and the
 * readiness are the server's own (studio-documents, `GET /project-domain-model/issues`
 * and `GET /project-domain-model/readiness`), and so are the documentation's
 * thin places (`GET /project-domain-model/doc-quality`).
 */

import type { SpecModel, SpecModelFact, SpecModelSide } from '../model/spec-model';

/** One entity of the project domain model as a person edited it: its section of docs/domain-model.md. */
export interface SpecModelEntityEdit {
  name: string;
  definition?: string | null;
  fields: { name: string; meaning: string }[];
  relations: { verb: string; target: string }[];
}

/** A sentence proposed for one of the project's documents, after the passage at `line`. */
export interface SpecModelSentence {
  path: string;
  revision: string;
  line: number;
  sentence: string;
  /** What it makes better: the pull request's title. */
  why?: string | null;
}

/** Where a save or a proposal went: the branch, and the pull request when one was opened. */
export interface SpecModelWrite {
  path: string;
  branch: string;
  commit_sha: string;
  pr_url?: string | null;
}


/** A fact as the server returns it: with the key its review is stored under. */
export type ServedFact = SpecModelFact & { fact_key: string };

/** `GET /studio-documents/v1/project-domain-model`. */
export type ServedSpecModel = Omit<SpecModel, 'facts'> & { facts: ServedFact[] };

export type IssueGroup = 'blocks' | 'look' | 'decided';

export type IssueAction = 'propose_fix' | 'confirm' | 'dismiss' | 'trace' | 'create_issue';

/** One thing a project has to decide before it builds from its documents. */
export interface SpecModelIssueRow {
  /** `f:<fingerprint>`, or `q:`, `a:`, `n:` and a requirement's id. */
  key: string;
  kind: 'finding' | 'question' | 'assumption' | 'nobasis';
  /** `Problem`, `Possible conflict`, `Open question`, `Assumption` or `No basis`. */
  label: string;
  group: IssueGroup;
  tone: 'bad' | 'warn';
  concern: boolean;
  title: string;
  hint: string;
  sides: SpecModelSide[];
  fingerprint?: string | null;
  rule?: string | null;
  decision?: 'confirmed' | 'dismissed' | null;
  edit?: { path: string; replace: string; with: string } | null;
  decide: string[];
  requirement_id?: string | null;
  issue_url?: string | null;
  actions: IssueAction[];
  done: boolean;
}

export interface SpecModelIssueRowList {
  items: SpecModelIssueRow[];
  total: number;
  by_group: Partial<Record<IssueGroup, number>>;
}

export type DocQualityKind = 'onlyadr' | 'nodefinition' | 'onesided' | 'norelation' | 'twonames';

export type DocQualityAction = 'save_entity' | 'same_thing' | 'propose_sentence' | 'create_issue';

/** One side of a "two names" row: a glossary entry. */
export interface DocQualityTerm {
  key: string;
  name: string;
  facts: number;
}

/** One way to make the documentation better, ready to save
 *  (`GET /studio-documents/v1/project-domain-model/doc-quality`). */
export interface DocQualityRow {
  /** `oa:`, `nd:`, `os:`, `nr:` or `tn:` and what it is about. */
  key: string;
  kind: DocQualityKind;
  /** The server's English name for the kind. */
  label: string;
  title: string;
  hint: string;
  sides: SpecModelSide[];
  /** The entity's section as it would be saved. */
  edit?: SpecModelEntityEdit | null;
  /** The key of the entity `edit` saves. */
  entity?: string | null;
  /** For two names: the second is to be read as the first. */
  pair?: { a: DocQualityTerm; b: DocQualityTerm; why: string; suffix?: string | null; level?: string | null } | null;
  /** For no relation: the sentence for the document, and the relation it states. */
  sentence?: (SpecModelSentence & { why: string; name: string; verb: string; target: string }) | null;
  issue_url?: string | null;
  actions: DocQualityAction[];
}

export interface DocQualityRowList {
  items: DocQualityRow[];
  total: number;
  by_kind: Partial<Record<DocQualityKind, number>>;
}

/** `GET /studio-documents/v1/project-domain-model/readiness`. */
export interface SpecModelReadiness {
  total: number;
  cited: number;
  reasoned: number;
  open: number;
  blocking: number;
  ready: boolean;
}

/** A member's word on a fact, or a decision kept by key (`iss:<row key>` for an opened issue). */
export interface SpecModelReview {
  fact_key: string;
  state: string;
  path: string;
  revision: string;
  note?: string | null;
  decided_by: string;
  decided_at: string;
}

export interface ReviewWrite {
  fact_key: string;
  state: string;
  path: string;
  revision: string;
  note?: string | null;
}

export interface OrgMember {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
}

export interface PersonAlias {
  kind: string;
  external_id: string;
  /** suggested | claimed | confirmed */
  confidence: string;
}

export interface MemberIdentities {
  user_id: string;
  aliases: PersonAlias[];
}

export interface NewIssue {
  title: string;
  body: string;
  assignees: string[];
}
