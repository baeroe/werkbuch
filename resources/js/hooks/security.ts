import { useQuery } from '@tanstack/react-query';
import { changePassword, confirmTwoFactor, disableTwoFactor, enableTwoFactor, getTwoFactor, regenerateRecoveryCodes } from '@/api/security';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** Whether the own second factor is on, and how many recovery codes are left. */
export function useTwoFactor() {
  return useQuery({ queryKey: qk.twoFactor.all, queryFn: getTwoFactor });
}

export function useChangePassword() {
  return useApiMutation(changePassword, []);
}

/** Answers the secret and the QR code: a secret shown once, so the answer leaves the cache with its dialog. */
export function useEnableTwoFactor() {
  return useApiMutation(enableTwoFactor, [qk.twoFactor.all], { gcTime: 0 });
}

/** Answers the recovery codes, shown once like the secret. */
export function useConfirmTwoFactor() {
  return useApiMutation(confirmTwoFactor, [qk.twoFactor.all], { gcTime: 0 });
}

export function useDisableTwoFactor() {
  return useApiMutation(disableTwoFactor, [qk.twoFactor.all]);
}

export function useRegenerateRecoveryCodes() {
  return useApiMutation(regenerateRecoveryCodes, [qk.twoFactor.all], { gcTime: 0 });
}
