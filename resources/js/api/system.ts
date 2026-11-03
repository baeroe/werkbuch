/*
 * The system page (spec 5.2, org admins only): queues, failed jobs, search, mail and live. Retrying and the test mail
 * answer without `data` (`{retried}`, `{sent_to}`); without a mail server the test mail is a 409 `mail_not_configured`,
 * a mail server that refuses it a 503 `mail_failed`.
 */

import type { SystemStatus } from '@/types';
import { get, one, post } from './http';

export function getSystemStatus(): Promise<SystemStatus> {
  return one(get<{ data: SystemStatus }>('/system'));
}

/** Puts the failed jobs named (their UUIDs), or every one without ids, back into their queue. Answers how many went. */
export function retryFailedJobs(ids?: readonly string[]): Promise<{ retried: number }> {
  return post<{ retried: number }>('/system/failed-jobs/retry', ids === undefined ? {} : { ids });
}

/** Sends a test mail to the signed-in admin; answers the address. */
export function sendTestMail(): Promise<{ sent_to: string }> {
  return post<{ sent_to: string }>('/system/test-mail');
}
