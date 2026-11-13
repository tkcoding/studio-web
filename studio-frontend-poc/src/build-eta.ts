// How long a domain-model build should take, before and while it runs.
// The backend reads up to four documents at once and says beforehand what a
// build would read (GET /spec-model/build-estimate); while it runs, its state
// carries started_at and done/total, which give the ETA here.

import type { SpecModelBuild } from "./spec-model";

/** What a build would read now, and about how long it would take. */
export interface SpecModelBuildEstimate {
  documents: number;
  total_documents: number;
  characters: number;
  input_tokens: number;
  seconds: number;
  seconds_per_document: number;
  /** Measured on the project's earlier builds, or a default. */
  measured: boolean;
  parallel: number;
}

/** "under a minute", "about 1 min", "about 4 min", "about 1 h 20 min". */
export function aboutDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 45) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `about ${h} h` : `about ${h} h ${m} min`;
}

/** "27 documents, about 4 min", or that nothing needs reading. */
export function estimateLabel(e: SpecModelBuildEstimate): string {
  if (e.documents === 0) return "Nothing to read: every document is read at its revision";
  const docs = `${e.documents} document${e.documents === 1 ? "" : "s"}`;
  return `${docs}, ${aboutDuration(e.seconds)}`;
}

/** "about 52k input tokens" for a title; the count is characters over four. */
export function tokensLabel(tokens: number): string {
  if (tokens < 1000) return `about ${tokens} input tokens`;
  return `about ${Math.round(tokens / 1000)}k input tokens`;
}

/** Seconds left reading the documents, or null when the build is not
 *  reading (stopped, or on to the judge). Before the first document is done
 *  it is the estimate made at the start less the time gone; after, the pace
 *  so far times what is left. */
export function etaSeconds(build: SpecModelBuild, nowMs: number): number | null {
  if (!build.running || build.documents === 0 || build.done >= build.documents) return null;
  const started = build.started_at ? Date.parse(build.started_at) : NaN;
  if (Number.isNaN(started)) return build.estimated_seconds ?? null;
  const elapsed = Math.max(0, (nowMs - started) / 1000);
  if (build.done === 0) {
    if (build.estimated_seconds == null) return null;
    return Math.max(0, build.estimated_seconds - elapsed);
  }
  return (elapsed / build.done) * (build.documents - build.done);
}

/** How far the reading is, 0..1. */
export function readFraction(build: SpecModelBuild): number {
  if (build.documents === 0) return build.running ? 0 : 1;
  return Math.min(1, build.done / build.documents);
}

/** "about 3 min left", or "" when there is no ETA to give. */
export function etaLabel(build: SpecModelBuild, nowMs: number): string {
  const left = etaSeconds(build, nowMs);
  if (left === null) return "";
  return left < 45 ? "less than a minute left" : `${aboutDuration(left)} left`;
}
