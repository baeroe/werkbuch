/*
 * The follow-up questions of the item commands (palette and shortcuts), which have no picker of their own on screen:
 * the resolution of a move to Completed or Canceled, and the type change dialog. A command asks (`askResolution`,
 * `askTypeChange`); `ItemDialogsHost`, mounted once in the shell, shows the question. The dialogs load with the first
 * question, so the shell's own bundle stays small.
 */

import { lazy, Suspense, useSyncExternalStore } from 'react';
import type { State, StateCategory, WorkItem, WorkItemType } from '@/types';

const ResolutionPrompt = lazy(() => import('./ResolutionPrompt').then((module) => ({ default: module.ResolutionPrompt })));
const TypeChangeDialog = lazy(() => import('./TypePicker').then((module) => ({ default: module.TypeChangeDialog })));

type ResolutionRequest = {
  kind: 'resolution';
  /** "WEB-47" or "3 Items". */
  subject: string;
  target: State;
  from?: { category: StateCategory; resolutionId: string | null };
  onConfirm: (resolutionId: string | null) => void;
};
type TypeRequest = { kind: 'type'; item: WorkItem; target: WorkItemType };

/** The question asked last, and whether it is shown (it stays while it fades out). */
let state: { request: ResolutionRequest | TypeRequest | null; open: boolean } = { request: null, open: false };
const listeners = new Set<() => void>();

function set(next: typeof state) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function askResolution(request: Omit<ResolutionRequest, 'kind'>): void {
  set({ request: { kind: 'resolution', ...request }, open: true });
}

export function askTypeChange(item: WorkItem, target: WorkItemType): void {
  set({ request: { kind: 'type', item, target }, open: true });
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
      {request.kind === 'resolution' ? (
        <ResolutionPrompt open={open} onOpenChange={close} subject={request.subject} target={request.target} from={request.from} onConfirm={request.onConfirm} />
      ) : (
        <TypeChangeDialog key={request.item.id} item={request.item} target={request.target} open={open} onOpenChange={close} />
      )}
    </Suspense>
  );
}
