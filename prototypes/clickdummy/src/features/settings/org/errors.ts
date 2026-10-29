/*
 * What a refused call tells a form: the message for a field (a 422 lists them by path), the sentence for everything
 * else. Screens show the first inline and the rest as a notice, so no refusal disappears into a toast nobody reads.
 */

import { ApiError } from '@/api/client';

/** The first message the server gave for one of the fields (`key`, `settings`, `options` …). */
export function fieldMessage(error: unknown, ...paths: string[]): string | undefined {
  if (!(error instanceof ApiError) || !error.errors) return undefined;
  for (const path of paths) {
    const message = error.errors[path]?.[0];
    if (message) return message;
  }
  return undefined;
}

/** Field messages for paths the form has no place for; they would be lost otherwise. */
export function unplacedMessages(error: unknown, placed: readonly string[]): string[] {
  if (!(error instanceof ApiError) || !error.errors) return [];
  return Object.entries(error.errors)
    .filter(([path]) => !placed.includes(path))
    .flatMap(([, messages]) => messages);
}

/** The cause in German: the API's sentence, or what no answer at all means (the browser's text is English). */
export function causeOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Der Server hat nicht geantwortet.';
}

/** Whether a refusal is the 409 with this reason, e.g. `last_admin`. */
export function hasReason(error: unknown, reason: string): error is ApiError {
  return error instanceof ApiError && error.reason === reason;
}

/**
 * What a form shows as a notice: the server's sentence when there is no field it belongs to, otherwise nothing,
 * because the field shows it.
 */
export function noticeOf(error: unknown, placed: readonly string[]): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 422) {
    const rest = unplacedMessages(error, placed);
    return rest.length > 0 ? rest.join(' ') : null;
  }
  return causeOf(error);
}
