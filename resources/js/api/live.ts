/*
 * Live updates (spec 7.2, Reverb). The real connection comes with Phase 8; until then the stub reports "connected" and
 * delivers no events, so the screens that listen are in place already.
 */

export interface LiveEvent {
  type: string;
  item_id?: string;
  actor_id: string;
}

/** Calls `callback` for every live event until the returned function is called. Nothing arrives before Phase 8. */
export function subscribeLive(callback: (event: LiveEvent) => void): () => void {
  void callback;

  return () => {};
}

export function isLiveConnected(): boolean {
  return true;
}

/** For `useSyncExternalStore`: called when the connection goes off or on. It never does before Phase 8. */
export function subscribeLiveStatus(callback: () => void): () => void {
  void callback;

  return () => {};
}
