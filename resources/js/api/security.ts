/*
 * The own password and second factor (spec 4.2), only from the session of the interface (`/me/*`). The setup of the
 * second factor has two steps: `enableTwoFactor` hands out the secret, `confirmTwoFactor` switches it on with the
 * first code of the app and answers the recovery codes.
 */

import type { TwoFactorSetup, TwoFactorStatus } from '@/types';
import { del, get, post, put } from './http';

export interface ChangePasswordInput {
  current_password: string;
  password: string;
  password_confirmation: string;
}

/** Changes the password; this session stays, every other one ends. */
export function changePassword(input: ChangePasswordInput): Promise<void> {
  return put<void>('/me/password', input);
}

export function getTwoFactor(): Promise<TwoFactorStatus> {
  return get<TwoFactorStatus>('/me/two-factor');
}

/** Starts the setup (again): a new secret, not yet switched on. */
export function enableTwoFactor(): Promise<TwoFactorSetup> {
  return post<TwoFactorSetup>('/me/two-factor');
}

export function confirmTwoFactor(code: string): Promise<{ recovery_codes: string[] }> {
  return post<{ recovery_codes: string[] }>('/me/two-factor/confirm', { code });
}

/** Switches the second factor off, or drops a setup that was never confirmed. */
export function disableTwoFactor(): Promise<void> {
  return del<void>('/me/two-factor');
}

/** Drops a setup that was never confirmed; one confirmed meanwhile stays on. */
export function discardTwoFactorSetup(): Promise<void> {
  return del<void>('/me/two-factor?unconfirmed=1');
}

/** New recovery codes; the old ones stop working. */
export function regenerateRecoveryCodes(): Promise<{ recovery_codes: string[] }> {
  return post<{ recovery_codes: string[] }>('/me/two-factor/recovery-codes');
}
