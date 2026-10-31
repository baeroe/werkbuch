/*
 * The follow-up questions of the item commands (palette and shortcuts), which have no picker of their own on screen:
 * the resolution of a move to Completed or Canceled. A command asks (`askResolution`); `ItemDialogsHost`, mounted once
 * in the shell, shows the question. The dialog loads with the first question, so the shell's own bundle stays small.
 * The type change dialog (`askTypeChange`) joins it with the type picker.
 */

import { lazy, Suspense, useSyncExternalStore } from 'react';
import type { State, StateCategory } from '@/types';

const ResolutionPrompt = lazy(() => import('./ResolutionPrompt').then((module) => ({ default: module.ResolutionPrompt })));

type ResolutionRequest = {
  kind: 'resolution';
  /** "WEB-47" or "3 Items". */
  subject: string;
  target: State;
  from?: { category: StateCategory; resolutionId: string | null };
  onConfirm: (resolutionId: string | null) => void;
};

/** The question asked last, and whether it is shown (it stays while it fades out). */
let state: { request: ResolutionRequest | null; open: boolean } = { request: null, open: false };
const listeners = new Set<() => void>();

function set(next: typeof state) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Asks for the resolution of a move into `target`; `onConfirm` gets the choice, nothing happens on Cancel. */
export function askResolution(request: Omit<ResolutionRequest, 'kind'>): void {
  set({ request: { kind: 'resolution', ...request }, open: true });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;

export function ItemDialogsHost() {
  const { request, open } = useSyncExternalStore(subscribe, snapshot, snapshot);
  const close = (next: boolean) => {
    if (!next) set({ ...state, open: false });
  };
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <ResolutionPrompt open={open} onOpenChange={close} subject={request.subject} target={request.target} from={request.from} onConfirm={request.onConfirm} />
    </Suspense>
  );
}
