/*
 * The System page (spec 5.2, admins only) and the demo's own reset.
 */

import { DEFAULT_USER_ID, useSession } from '@/store/session';
import type { SystemStatus } from '@/types';
import { requireOrgAdmin } from './access';
import { conflict, read, write } from './client';
import { resetDb } from './db';

export function getSystemStatus(): Promise<SystemStatus> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Das System sehen nur Org-Admins.');
    return db.system;
  });
}

/** Puts the failed jobs back into the queue. Answers how many there were. */
export function retryFailedJobs(): Promise<{ retried: number }> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Jobs wiederholen nur Org-Admins.');
    const retried = db.system.failed_jobs.length;
    db.system.queued_jobs += retried;
    db.system.failed_jobs = [];
    return { retried };
  });
}

/** Sends a test mail to the signed-in admin. */
export function sendTestMail(): Promise<{ sent_to: string }> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Testmails senden nur Org-Admins.');
    if (!db.system.mail_configured) throw conflict('mail_not_configured', 'Es ist kein Mailserver eingerichtet.');
    return { sent_to: me.email ?? '' };
  });
}

/**
 * "Demo zurücksetzen": the seed data are back and Mara is signed in again. It works even while `api:fail` is set,
 * so that the demo can always be rescued.
 */
export async function resetDemo(): Promise<void> {
  resetDb();
  useSession.getState().setUserId(DEFAULT_USER_ID);
}
