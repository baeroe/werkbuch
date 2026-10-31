/*
 * The follow-up questions of the item commands (palette and shortcuts), which have no picker of their own on screen:
 * the resolution of a move to Completed or Canceled, and the type change dialog. A command asks (`askResolution`,
 * `askTypeChange`); `ItemDialogsHost`, mounted once in the shell, shows the question. The dialogs load with the first
 * question, so the shell's own bundle stays small.
 *
 * When the question closes, the focus goes back where it was when the command ran: the element that had it, or, when
 * the command ran from the palette, the element that had it before the palette opened (the palette is gone by then).
 * Without such an element (the focus was on the page itself, or the element went away) it goes to the screen's main
 * area (`#main`, whose first focusable element Base UI then takes), never to the body.
 */

import { lazy, Suspense, useSyncExternalStore, type RefObject } from 'react';
import { useUiStore } from '@/store/ui';
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
type TypeRequest = { kind: 'type'; item: WorkItem; target: WorkItemType; hasChildren?: boolean };

/** The question asked last, and whether it is shown (it stays while it fades out). */
let state: { request: ResolutionRequest | TypeRequest | null; open: boolean } = { request: null, open: false };

/** What had the focus when the palette opened; a command chosen there asks after the palette took the focus. */
let beforePalette: Element | null = null;
useUiStore.subscribe((ui, previous) => {
  if (ui.paletteOpen && !previous.paletteOpen) beforePalette = document.activeElement;
});

/** Where the focus goes back to when the question closes (see the top of the file). */
let origin: Element | null = null;

const remember = () => {
  origin = useUiStore.getState().paletteOpen ? beforePalette : document.activeElement;
};

/** Read when the question closes: the origin while it is still on the page and not the page itself, else the main area. */
const returnFocus: RefObject<HTMLElement | null> = {
  get current() {
    const back = origin instanceof HTMLElement && origin.isConnected && origin !== document.body ? origin : null;
    return back ?? document.getElementById('main');
  },
};
const listeners = new Set<() => void>();

function set(next: typeof state) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Asks for the resolution of a move into `target`; `onConfirm` gets the choice, nothing happens on Cancel. */
export function askResolution(request: Omit<ResolutionRequest, 'kind'>): void {
  remember();
  set({ request: { kind: 'resolution', ...request }, open: true });
}

/**
 * Asks how `item` changes to `target`: the values that go, the required ones of the new type, or why the two levels
 * refuse it. `hasChildren`: what the command knows about the item's children, so the dialog can refuse before the item
 * loads.
 */
export function askTypeChange(item: WorkItem, target: WorkItemType, hasChildren?: boolean): void {
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
    if (!next) set({ ...state, open: false });
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
