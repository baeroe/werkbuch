/*
 * The query client of the app. Data change only through mutations and live events, which invalidate what they touch,
 * so a short stale time is fine and a failed call is not repeated on its own: an error shows at once with its retry.
 *
 * Who is signed in decides what everybody sees (visible projects, inbox, favorites): when the person changes, the
 * whole cache is cleared.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

/**
 * Clears the cache when the person behind the page changes (sign-in, sign-out, another account). `clear()`, not
 * `resetQueries()`: those switches always pass a page without the shell (sign-in, invitation), so no observer of the old
 * account is left that a reset would have to load again; the cleared queries load anew for the next person.
 */
export function resetForUser(previousId: string | null, nextId: string | null): void {
  if (previousId !== nextId) {
    queryClient.clear();
  }
}
