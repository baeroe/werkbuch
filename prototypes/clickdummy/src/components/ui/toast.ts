import { useSyncExternalStore } from 'react';

export type ToastTone = 'neutral' | 'success' | 'error';
export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = {
  title: string;
  description?: string;
  action?: ToastAction;
  /** The toast closed without its action (time up, closed, pushed out): e.g. run the deferred delete now. */
  onExpire?: () => void;
  /** Milliseconds until the toast closes on its own. */
  duration?: number;
  /** error: announced at once (role=alert) and marked with the danger colour. */
  tone?: ToastTone;
};
export type Toast = Omit<ToastOptions, 'duration' | 'tone'> & { id: number; duration: number; tone: ToastTone };

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 3;

let toasts: readonly Toast[] = [];
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

function remove(id: number): Toast | undefined {
  const item = toasts.find((entry) => entry.id === id);
  if (!item) return undefined;
  forget(id);
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
  syncPause();
  return item;
}

/** Shows a toast and returns its id. Only the newest three stay; older ones expire. */
export function toast({ duration = DEFAULT_DURATION, tone = 'neutral', ...options }: ToastOptions): number {
  const id = ++sequence;
  const pushedOut = toasts.slice(0, Math.max(0, toasts.length - (MAX_VISIBLE - 1)));
  pushedOut.forEach((item) => forget(item.id));
  toasts = [...toasts.slice(pushedOut.length), { ...options, id, duration, tone }];
  syncPause();
  timers.set(id, { remaining: duration, started: 0, handle: null });
  if (!paused) startTimer(id);
  emit();
  pushedOut.forEach((item) => item.onExpire?.());
  return id;
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
