/*
 * The follow-up questions of the item commands (palette and shortcuts), which have no picker of their own on screen:
 * the resolution of a move to Completed or Canceled, and the type change dialog. A command asks (`askResolution`,
 * `askTypeChange`); `ItemDialogsHost`, mounted once in the shell, shows the question. The dialogs load with the first
 * question, so the shell's own bundle stays small.
 *
 * When the question closes, the focus goes back where it was when the command ran: the element that had it, or, when
 * the command ran from the palette, the element that had it before the palette opened (the palette is gone by then).
 * Without such an element (the focus was on the page itself, or the element went away) it goes to the screen's focus
 * origin (`[data-focus-origin]`, the heading of the item page), else to its main area (`#main`), never to the body.
 */

import { lazy, Suspense, useSyncExternalStore, type RefObject } from 'react';
import { focusBackTo, focusOriginNow } from '@/lib/focusOrigin';
import type { ListedItem, State, StateCategory, WorkItemType } from '@/types';

const ResolutionPrompt = lazy(() => import('./ResolutionPrompt').then((module) => ({ default: module.ResolutionPrompt })));
const TypeChangeDialog = lazy(() => import('./TypePicker').then((module) => ({ default: module.TypeChangeDialog })));

type ResolutionRequest = {
  kind: 'resolution';
  /** "WEB-47" or "3 Items". */
  subject: string;
  target: State;
  from?: { category: StateCategory; resolutionId: string | null };
  onConfirm: (resolutionId: string | null) => void;
  /** The question closed without a choice (Cancel, Escape). */
  onCancel?: () => void;
};
type TypeRequest = { kind: 'type'; item: ListedItem; target: WorkItemType; hasChildren?: boolean };

/** The question asked last, and whether it is shown (it stays while it fades out). */
let state: { request: ResolutionRequest | TypeRequest | null; open: boolean } = { request: null, open: false };

/** Where the focus goes back to when the question closes (see the top of the file, `lib/focusOrigin.ts`). */
let origin: Element | null = null;

const remember = () => {
  origin = focusOriginNow();
};

/** Read when the question closes. */
const returnFocus: RefObject<HTMLElement | null> = {
  get current() {
    return focusBackTo(origin);
  },
};
const listeners = new Set<() => void>();

function set(next: typeof state) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Asks for the resolution of a move into `target`; `onConfirm` gets the choice, `onCancel` hears a close without one. */
export function askResolution(request: Omit<ResolutionRequest, 'kind'>): void {
  remember();
  let answered = false;
  set({
    request: {
      kind: 'resolution',
      ...request,
      onConfirm: (resolutionId) => {
        answered = true;
        request.onConfirm(resolutionId);
      },
      onCancel: () => {
        if (answered) return;
        answered = true;
        request.onCancel?.();
      },
    },
    open: true,
  });
}

/**
 * Asks how `item` changes to `target`: the values that go, the required ones of the new type, or why the two levels
 * refuse it. `hasChildren`: what the command knows about the item's children, so the dialog can refuse before the item
 * loads.
 */
export function askTypeChange(item: ListedItem, target: WorkItemType, hasChildren?: boolean): void {
  remember();
  set({ request: { kind: 'type', item, target, hasChildren }, open: true });
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
    if (next) return;
    set({ ...state, open: false });
    if (request?.kind === 'resolution') request.onCancel?.();
  };
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      {request.kind === 'resolution' ? (
        <ResolutionPrompt open={open} onOpenChange={close} subject={request.subject} target={request.target} from={request.from} onConfirm={request.onConfirm} finalFocus={returnFocus} />
      ) : (
        <TypeChangeDialog key={request.item.id} item={request.item} target={request.target} open={open} onOpenChange={close} hasChildren={request.hasChildren} finalFocus={returnFocus} />
      )}
    </Suspense>
  );
}
