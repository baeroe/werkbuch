import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { isLiveConnected, setLiveConnected, simulateRemoteChange, subscribeLive, subscribeLiveStatus } from '@/api/live';
import { useUiStore } from '@/store/ui';
import { qk } from './keys';

/** Whether live updates arrive; false after "Live-Verbindung trennen". */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribeLiveStatus, isLiveConnected, isLiveConnected);
}

/**
 * Mount once in the shell: a live event (somebody else changed something) makes the screens that show items, the
 * history, the inbox and the wiki load again, and highlights the changed item for two seconds.
 */
export function useLiveSync(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeLive((event) => {
        for (const queryKey of [qk.workItems.all, qk.activity.all, qk.notifications.all, qk.pages.all]) {
          void queryClient.invalidateQueries({ queryKey });
        }
        if (event.item_id) useUiStore.getState().flash(event.item_id);
      }),
    [queryClient],
  );
}

/** "Live-Ereignis simulieren": Ida changes the status or priority of an open WEB item; answers the live event. */
export function useSimulateRemoteChange() {
  return useMutation({ mutationFn: simulateRemoteChange });
}

/** "Live-Verbindung trennen / herstellen": switches the connection off or on. */
export function useSetLiveConnected(): (on: boolean) => void {
  return setLiveConnected;
}
