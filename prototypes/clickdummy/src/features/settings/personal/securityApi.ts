/*
 * The password and the second factor have no endpoint in the prototype's fake API. These stand in for them with the
 * same manners as the rest: they take a moment (none in tests), fail with a 503 while `api:fail` is set, and refuse a
 * code that is not six digits with a 422 that names the field. Task 13 can move them into `src/api` and `src/hooks`.
 */

import { useMutation } from '@tanstack/react-query';
import { ApiError, maybeFail } from '@/api/client';
import { isAuthCode } from './twoFactorCodes';

async function request(): Promise<void> {
  if (import.meta.env.MODE !== 'test') await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 300));
  maybeFail();
}

/** Changes the password. Any current password is accepted. */
export async function changePassword(): Promise<void> {
  await request();
}

/** Checks the first code of the authenticator app: any six digits are right. */
export async function confirmTwoFactor(code: string): Promise<void> {
  await request();
  if (!isAuthCode(code)) {
    throw new ApiError({ status: 422, reason: 'validation_failed', detail: 'Die Eingabe ist nicht gültig.', errors: { code: ['Der Code besteht aus 6 Ziffern.'] } });
  }
}

export async function disableTwoFactor(): Promise<void> {
  await request();
}

export const useChangePassword = () => useMutation({ mutationFn: changePassword });
export const useConfirmTwoFactor = () => useMutation({ mutationFn: confirmTwoFactor });
export const useDisableTwoFactor = () => useMutation({ mutationFn: disableTwoFactor });
