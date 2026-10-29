import { useSyncExternalStore } from 'react';

export type ToastTone = 'neutral' | 'success' | 'error';
export type ToastAction = { label: string; onClick: () => void };
type ToastBase = {
  title: string;
  description?: string;
  action?: ToastAction;
  /** Milliseconds until the toast closes on its own. */
  duration?: number;
};
/** A confirmation or a hint: it takes one of the three places. */
type NoticeOptions = ToastBase & {
  tone?: 'neutral' | 'success';
  /** The toast closed without its action (time up, closed, pushed out): e.g. run the deferred delete now. */
  onExpire?: () => void;
  /**
   * Never pushed out by newer toasts: it stays for its whole time unless it is closed or its action runs. Undo toasts
   * (`runWithUndo`) set it, so a deferred delete never runs early and "Rückgängig" stays within reach.
   */
  keep?: boolean;
};
/**
 * An error: marked with the danger colour, it stands below the others and never waits for a place. It carries no
 * deferred action and is never kept, so the same error again can refresh the one on screen and nothing is lost.
 */
type ErrorOptions = ToastBase & { tone: 'error'; onExpire?: never; keep?: never };
export type ToastOptions = NoticeOptions | ErrorOptions;
export type Toast = ToastBase & {
  id: number;
  duration: number;
  tone: ToastTone;
  keep: boolean;
  onExpire?: () => void;
  /** Counts the refreshes of an error toast; its time line starts anew with each (see `refreshSameError`). */
  round: number;
};

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 3;

let toasts: readonly Toast[] = [];
/**
 * Toasts that found no room: three were showing and none of them could be pushed out (all kept). They show, oldest
 * first, as soon as a toast closes; their time starts then. Error toasts never wait (see `takesPlace`).
 */
let waiting: Toast[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
/** Remaining time per toast; a timer only runs while no toast is held. */
const timers = new Map<number, { remaining: number; started: number; handle: ReturnType<typeof setTimeout> | null }>();
/**
 * Toasts under the pointer and toasts holding the keyboard focus pause all timers (WCAG 2.2.1). The holds are
 * kept per toast, so closing a toast releases its hold: browsers send no leave or blur for removed elements.
 */
const hovered = new Set<number>();
const focused = new Set<number>();
let paused = false;

const emit = () => listeners.forEach((listener) => listener());

function startTimer(id: number) {
  const timer = timers.get(id);
  if (!timer) return;
  if (timer.handle) clearTimeout(timer.handle);
  timer.started = Date.now();
  timer.handle = setTimeout(() => dismissToast(id), timer.remaining);
}

/** Pauses every timer while a toast is held and resumes them once none is. */
function syncPause() {
  const held = hovered.size > 0 || focused.size > 0;
  if (held === paused) return;
  paused = held;
  for (const [id, timer] of timers) {
    if (!paused) {
      startTimer(id);
    } else if (timer.handle) {
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
    }
  }
  emit();
}

/** Drops a toast's timer and its holds. */
function forget(id: number) {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
  hovered.delete(id);
  focused.delete(id);
}

/**
 * Whether a toast takes one of the three places. Errors do not: they have a region of their own below the others,
 * show at once, beyond the three, and are never pushed out, so no error goes unseen or unannounced.
 */
const takesPlace = (item: Toast) => item.tone !== 'error';

/**
 * The same error again (same title and description, e.g. a refused key pressed again and again) refreshes the one on
 * screen instead of stacking a second: the toast keeps its id and its place, so its element, a focus inside it and the
 * pause that focus holds all stay. It takes the newest action and starts its time anew. Errors carry no deferred
 * action (see `ErrorOptions`), so nothing runs or gets lost. Answers the id of the refreshed toast, or null.
 */
function refreshSameError(item: Toast): number | null {
  const same = toasts.find((entry) => entry.tone === 'error' && entry.title === item.title && entry.description === item.description);
  if (!same) return null;
  toasts = toasts.map((entry) => (entry === same ? { ...same, action: item.action, duration: item.duration, round: same.round + 1 } : entry));
  const timer = timers.get(same.id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.set(same.id, { remaining: item.duration, started: 0, handle: null });
  if (!paused) startTimer(same.id);
  return same.id;
}

/** Puts a toast on screen and starts its time (unless a held toast pauses all of them). */
function show(item: Toast): void {
  toasts = [...toasts, item];
  timers.set(item.id, { remaining: item.duration, started: 0, handle: null });
  if (!paused) startTimer(item.id);
}

/**
 * Gives the toasts that wait the room there is: a free place, or the place of the oldest toast that may be pushed out
 * (that one expires). Only a toast that was on screen before this pass may make room: one that just got its place has
 * not been seen yet. Answers the toasts it pushed out, whose `onExpire` the caller runs once the store is settled.
 */
function place(): Toast[] {
  const pushedOut: Toast[] = [];
  const shownBefore = new Set(toasts.map((entry) => entry.id));
  while (waiting.length > 0) {
    if (toasts.filter(takesPlace).length >= MAX_VISIBLE) {
      const oldest = toasts.find((entry) => takesPlace(entry) && !entry.keep && shownBefore.has(entry.id));
      if (!oldest) break;
      forget(oldest.id);
      toasts = toasts.filter((entry) => entry.id !== oldest.id);
      pushedOut.push(oldest);
    }
    show(waiting.shift()!);
  }
  return pushedOut;
}

function remove(id: number): Toast | undefined {
  const waited = waiting.find((entry) => entry.id === id);
  if (waited) {
    waiting = waiting.filter((entry) => entry.id !== id);
    return waited;
  }
  const item = toasts.find((entry) => entry.id === id);
  if (!item) return undefined;
  forget(id);
  toasts = toasts.filter((entry) => entry.id !== id);
  const pushedOut = place();
  emit();
  syncPause();
  pushedOut.forEach((entry) => entry.onExpire?.());
  return item;
}

/**
 * Shows a toast and returns its id. Three show at most: a new one pushes out the oldest that is not kept (it expires).
 * When all three are kept (undo toasts), the new one waits for the first of them to close. An error toast shows at
 * once and takes no place; the same error again refreshes the one on screen and answers its id.
 */
export function toast({ duration = DEFAULT_DURATION, tone = 'neutral', keep = false, ...options }: ToastOptions): number {
  const item: Toast = { ...options, id: sequence + 1, duration, tone, keep, round: 0 };
  if (!takesPlace(item)) {
    const refreshed = refreshSameError(item);
    if (refreshed !== null) {
      emit();
      return refreshed;
    }
  }
  sequence = item.id;
  if (takesPlace(item)) waiting = [...waiting, item];
  else show(item);
  const pushedOut = place();
  syncPause();
  emit();
  pushedOut.forEach((entry) => entry.onExpire?.());
  return item.id;
}

/** Closes a toast without its action, so onExpire runs. */
export function dismissToast(id: number): void {
  remove(id)?.onExpire?.();
}

/** Runs the toast's action (e.g. undo) and closes it; onExpire does not run. */
export function runToastAction(id: number): void {
  remove(id)?.action?.onClick();
}

/** The pointer entered or left a toast. Ids that are not shown (the gallery's specimens) are ignored. */
export function setToastHovered(id: number, over: boolean): void {
  if (!toasts.some((entry) => entry.id === id)) return;
  if (over) hovered.add(id);
  else hovered.delete(id);
  syncPause();
}

/** The keyboard focus moved into or out of a toast. */
export function setToastFocused(id: number, within: boolean): void {
  if (!toasts.some((entry) => entry.id === id)) return;
  if (within) focused.add(id);
  else focused.delete(id);
  syncPause();
}

export function currentToasts(): readonly Toast[] {
  return toasts;
}

/** The toasts waiting for a place, oldest first (`mod+z` reaches an undo toast there too). */
export function waitingToasts(): readonly Toast[] {
  return waiting;
}

/** Tests only: drops every toast, the waiting ones too, with their timers and holds; runs none of their callbacks. */
export function resetToasts(): void {
  [...timers.keys()].forEach(forget);
  toasts = [];
  waiting = [];
  hovered.clear();
  focused.clear();
  paused = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, currentToasts, currentToasts);
}

/** Whether a toast is held, so the Toaster can pause the time line. */
export function useToastsPaused(): boolean {
  return useSyncExternalStore(subscribe, toastsPaused, toastsPaused);
}

function toastsPaused(): boolean {
  return paused;
}
