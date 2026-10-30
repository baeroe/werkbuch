/*
 * The error toast of a failed change, one policy for the whole app (Ruling R12):
 * - a conflict that carries the stored state (409 with `current`) shows nothing: the caller shows its conflict banner
 * - any other refusal shows its cause, without a retry, which would only be refused again
 * - only errors worth repeating (the server failed with 5xx, or did not answer at all) offer "Try again"
 *
 * The optimistic item mutations use it, and so does `runWithUndo`. Screens call it for their own calls, one answer per
 * call: `settle(save.mutateAsync(vars), { onError: (error) => notifyError(title, error, retry) })`.
 */

import { ApiError } from '@/api/client';
import { toast } from '@/components/ui/toast';
import { t } from '@/lib/i18n';

/** Whether repeating can help: the server failed (5xx) or did not answer. A refusal (4xx) would be refused again. */
export function isTransient(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** The cause in the language of the page: the API's own sentence, or what not getting an answer means (the browser's text is English). */
function causeOf(error: unknown): string {
  return error instanceof ApiError ? error.message : t('errors.no_answer');
}

export function notifyError(title: string, error: unknown, retry?: () => void): void {
  if (error instanceof ApiError && error.status === 409 && error.current !== undefined) return;
  toast({
    title,
    description: causeOf(error),
    tone: 'error',
    action: retry && isTransient(error) ? { label: t('common.retry'), onClick: retry } : undefined,
  });
}
