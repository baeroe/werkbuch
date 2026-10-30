import { useSyncExternalStore } from 'react';
import { isLiveConnected, subscribeLiveStatus } from '@/api/live';

/** Whether live updates arrive. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribeLiveStatus, isLiveConnected, isLiveConnected);
}
