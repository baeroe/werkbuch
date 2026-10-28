/*
 * Helpers for the tests of the fake API: start from the seed as a given person, and read the error of a failing call.
 */

import { ApiError } from '@/api/client';
import { resetDb } from '@/api/db';
import { useSession } from '@/store/session';

/** Storage emptied, seed data loaded, Mara signed in, no simulated outage. */
export function resetApi(): void {
  localStorage.clear();
  resetDb();
  useSession.setState({ userId: 'u_mara' });
}

/** Signs in as somebody else (the profile menu's "Als … ansehen"). */
export const asUser = (userId: string) => useSession.setState({ userId });

/** The `ApiError` a call fails with; fails the test when the call succeeds or fails otherwise. */
export async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}
