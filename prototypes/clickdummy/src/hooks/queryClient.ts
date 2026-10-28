/*
 * The query client of the app. Data come from the fake API and change only through mutations and live events, which
 * invalidate what they touch, so a short stale time is fine and a failed call is not repeated on its own: an error
 * shows at once with its "Erneut versuchen".
 *
 * Who is signed in decides what everybody sees (visible projects, inbox, favorites): when the person changes, the
 * whole cache is reset.
 */

import { QueryClient } from '@tanstack/react-query';
import { useSession } from '@/store/session';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

useSession.subscribe((state, previous) => {
  if (state.userId !== previous.userId) void queryClient.resetQueries();
});
