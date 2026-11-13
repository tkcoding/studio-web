// What a document leaves out of the domain its project describes, and whom
// to ask about it (studio-documents `/spec-model/questions`, `/experts`;
// docs/spec-domain-model.md, "Questions while writing").

import type { SpecModelSide } from "./spec-model";

export interface DomainQuestion {
  entity: string;
  because_of: string[];
  facts: number;
  documents: string[];
  example?: SpecModelSide | null;
}

export interface TermDrift {
  used: string;
  project_name: string;
  line: number;
}

export interface DomainQuestions {
  items: DomainQuestion[];
  total: number;
  built: boolean;
}

export interface DomainExpert {
  person: string;
  commits: number;
  documents: string[];
  last_change?: string | null;
}

/** The question as its author reads it. */
export function questionSentence(q: DomainQuestion): string {
  if (q.because_of.length === 0) {
    return `The project relates this document to ${q.entity}. What does it do with ${q.entity}?`;
  }
  const about = q.because_of.length === 1 ? q.because_of[0] : `${q.because_of.slice(0, -1).join(", ")} and ${q.because_of[q.because_of.length - 1]}`;
  return `This document speaks of ${about}, which the project relates to ${q.entity}. What does it do with ${q.entity}?`;
}

/** "3 commits, last 2026-10-02". */
export function expertLine(e: DomainExpert): string {
  const n = `${e.commits} commit${e.commits === 1 ? "" : "s"}`;
  return e.last_change ? `${n}, last ${e.last_change.slice(0, 10)}` : n;
}
