/**
 * A read of objects refused because their domain type is not in use where
 * the caller is (ADR-0070 §4): the kit that brings it left it **dormant**
 * (`DOMAIN_TYPE_DORMANT`, a failed precondition naming the kit), or it is
 * **not installed** here (`DOMAIN_TYPE_NOT_INSTALLED:<kit>`, a not-found).
 * studio-backend `domain_model/rest.rs` `access_problem`.
 *
 * A screen showing such a type says "not installed here" and offers no
 * writes, instead of printing the refusal as a failure: the model a screen
 * read a moment ago may still list the type while the objects route already
 * refuses it.
 */

import { parseProblemDetails } from './problemDetails';

export interface TypeAbsence {
  reason: 'dormant' | 'not_installed';
  /** The kit that brings the type, when the refusal names it. */
  kit: string | null;
}

const DORMANT = 'DOMAIN_TYPE_DORMANT';
const NOT_INSTALLED = 'DOMAIN_TYPE_NOT_INSTALLED';
const KIT_AFTER = new RegExp(`${NOT_INSTALLED}:\\s*([a-z0-9][a-z0-9-]*)`);

function bodyText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return typeof error === 'string' ? error : '';
  const parts: string[] = [];
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') parts.push(message);
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (data !== undefined) {
    try {
      parts.push(typeof data === 'string' ? data : JSON.stringify(data));
    } catch {
      // A body that does not serialize says nothing here.
    }
  }
  return parts.join('\n');
}

/** Why the type of a refused read is not in use here, or null for any other failure. */
export function typeAbsence(error: unknown): TypeAbsence | null {
  const dormant = parseProblemDetails(error).violations.find((v) => v.type === DORMANT);
  if (dormant) return { reason: 'dormant', kit: typeof dormant.subject === 'string' ? dormant.subject : null };
  const text = bodyText(error);
  if (text.includes(DORMANT)) return { reason: 'dormant', kit: null };
  if (text.includes(NOT_INSTALLED)) return { reason: 'not_installed', kit: KIT_AFTER.exec(text)?.[1] ?? null };
  return null;
}
