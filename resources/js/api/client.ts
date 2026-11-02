/*
 * What every call of the API layer has in common:
 * - `ApiError { status, reason, errors? }`, built from the Problem Details of the REST API (RFC 9457, spec 6.1)
 * - `isGone(error)`: whether a failed read means the thing is gone for the reader (404, or 403 for lost access)
 * - `Page<T>`, the envelope of every list (cursor pagination)
 */

import { hasTranslation, t } from '@/lib/i18n';

export interface ApiErrorInit {
  status: number;
  /** A stable code such as `transition_not_allowed`; the text of the message is for people. */
  reason: string;
  /** A sentence in the language of the person (`detail` of the problem document); a 404 brings none. */
  detail?: string;
  /** Field errors by path, e.g. `title` or `values.customer`. */
  errors?: Record<string, string[]>;
  /** Further members of the problem document, e.g. `current` (the stored state) of a conflict. */
  extensions?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly errors?: Record<string, string[]>;
  readonly extensions: Record<string, unknown>;

  constructor({ status, reason, detail, errors, extensions }: ApiErrorInit) {
    super(detail ?? reasonText(reason));
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.errors = errors;
    this.extensions = extensions ?? {};
  }

  /** On a 409 conflict: the state stored on the server (`page_conflict`: the page, `description_conflict`: the item). */
  get current(): unknown {
    return this.extensions.current;
  }
}

/**
 * The thing is gone for this reader: deleted, or in a project they no longer see (404, or 403 for lost access). A
 * detail then says so instead of keeping what it loaded before, a reference reads "hidden". Any other failure (a 5xx,
 * no answer) keeps what is on screen: it is not lost, the server only failed to answer (13c).
 */
export function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

/** A short text for a reason code, e.g. for the line of a toast that lists what a bulk edit refused. */
export function reasonText(reason: string): string {
  const key = `problem.reason.${reason}`;

  return hasTranslation(key) ? t(key) : t('problem.reason_unknown', { reason });
}

/** The envelope of every list. `total` counts all matches, not only this page. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export interface PageArgs {
  cursor?: string | null;
  /** 1 to 100; 100 when omitted. */
  per_page?: number;
}

export const MAX_PER_PAGE = 100;
