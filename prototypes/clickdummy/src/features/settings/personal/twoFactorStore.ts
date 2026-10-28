/*
 * Who has two-factor authentication on (spec 4.2), kept in the browser for as long as the page lives. The prototype's
 * server knows nothing about the second factor, and a reload starts the demo over, with nobody having set it up.
 */

import { create } from 'zustand';
import { RECOVERY_CODE_COUNT } from './twoFactorCodes';

export interface TwoFactorRecord {
  /** When it was switched on, an ISO timestamp. */
  enabled_at: string;
  recovery_codes_left: number;
}

interface TwoFactorState {
  byUser: Record<string, TwoFactorRecord>;
  enable: (userId: string, at: string) => void;
  disable: (userId: string) => void;
  /** A fresh set of recovery codes was issued: all of them are unused again. */
  renewCodes: (userId: string) => void;
}

export const useTwoFactor = create<TwoFactorState>()((set) => ({
  byUser: {},
  enable: (userId, at) => set((state) => ({ byUser: { ...state.byUser, [userId]: { enabled_at: at, recovery_codes_left: RECOVERY_CODE_COUNT } } })),
  disable: (userId) => set((state) => ({ byUser: Object.fromEntries(Object.entries(state.byUser).filter(([id]) => id !== userId)) })),
  renewCodes: (userId) =>
    set((state) => {
      const current = state.byUser[userId];
      return current ? { byUser: { ...state.byUser, [userId]: { ...current, recovery_codes_left: RECOVERY_CODE_COUNT } } } : state;
    }),
}));

/** The record of one person, or undefined while the second factor is off for them. */
export const useTwoFactorOf = (userId: string): TwoFactorRecord | undefined => useTwoFactor((state) => state.byUser[userId]);
