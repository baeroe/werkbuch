/*
 * Who is signed in. The demo starts as Mara Lindqvist (org admin); the profile menu ("Als … ansehen") switches the
 * person. The fake API reads the id from here as the server would read it from the session, and the choice survives a
 * reload under `werkbuch:session` (where the browser refuses storage, until the reload).
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/storage';

export const SESSION_KEY = 'werkbuch:session';
export const DEFAULT_USER_ID = 'u_mara';

interface SessionState {
  userId: string;
  setUserId: (userId: string) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      userId: DEFAULT_USER_ID,
      setUserId: (userId) => set({ userId }),
    }),
    {
      name: SESSION_KEY,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ userId: state.userId }),
    },
  ),
);
