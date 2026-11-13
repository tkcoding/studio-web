/**
 * The one reader of the gears' refusals.
 */

export interface Violation {
  type?: unknown;
  subject?: unknown;
  description?: unknown;
}

/** The problem document itself, with nothing guessed. */
export interface ProblemDetails {
  detail: string | null;
  message: string | null;
  violations: readonly Violation[];
}

const EMPTY: ProblemDetails = { detail: null, message: null, violations: [] };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function responseData(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as { response?: { data?: unknown } }).response?.data;
}

export function parseProblemDetails(error: unknown): ProblemDetails {
  const data = responseData(error);

  // A bare string body is the whole explanation the gear offered.
  if (typeof data === 'string') return { ...EMPTY, detail: text(data) };
  if (typeof data !== 'object' || data === null) return EMPTY;

  const record = data as { detail?: unknown; message?: unknown; context?: unknown };
  const context = record.context;
  const list =
    typeof context === 'object' && context !== null
      ? (context as { violations?: unknown }).violations
      : undefined;

  return {
    detail: text(record.detail),
    message: text(record.message),
    violations: Array.isArray(list) ? (list as Violation[]) : [],
  };
}

/**
 * The machine-readable reason a gear refused with (`context.reason` of a
 * `permission_denied`, such as `PLATFORM_ADMIN_REQUIRED`), or null when it gave
 * none. What a screen branches on to say who may do this.
 */
export function refusalReason(error: unknown): string | null {
  const data = responseData(error);
  if (typeof data !== 'object' || data === null) return null;
  const context = (data as { context?: unknown }).context;
  if (typeof context !== 'object' || context === null) return null;
  return text((context as { reason?: unknown }).reason);
}

/** The violation the caller knows how to act on, or null if the gear sent none. */
export function violationOfType(error: unknown, type: string): Violation | null {
  return parseProblemDetails(error).violations.find((entry) => entry.type === type) ?? null;
}

/**
 * The refusal in the gear's own words, or null when it said nothing readable.
 */
export function refusalText(error: unknown): string | null {
  const problem = parseProblemDetails(error);
  if (problem.detail) return problem.detail;
  if (problem.message) return problem.message;
  return typeof error === 'object' && error !== null
    ? text((error as { message?: unknown }).message)
    : null;
}

export type Refusal =
  | { readonly kind: 'i18n'; readonly key: string }
  | { readonly kind: 'provider'; readonly text: string };

export function refusalFrom(error: unknown, fallbackKey: string): Refusal {
  const said = refusalText(error);
  return said ? { kind: 'provider', text: said } : { kind: 'i18n', key: fallbackKey };
}
