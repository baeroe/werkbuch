/*
 * "Retry" after an outage. Everything on screen failed at once (the list, the sidebar, the rights), so a retry fetches
 * every failed query again, not only the caller's own: one click brings the whole screen back. It is no reset: what
 * loaded stays as it is.
 */

import { QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { useCallback, useContext } from 'react';

/** Fetches every active query in error state again, except those already on their way (the caller's own retry). */
export function refetchFailed(client: QueryClient): Promise<void> {
  return client.refetchQueries({
    type: 'active',
    predicate: (query) => query.state.status === 'error' && query.state.fetchStatus === 'idle',
  });
}

/** `refetchFailed` for the query client of the app; does nothing outside a `QueryClientProvider`. */
export function useRefetchFailed(): () => void {
  const client = useContext(QueryClientContext);

  return useCallback(() => {
    if (client) void refetchFailed(client);
  }, [client]);
}
