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

/** Who holds the toasts open: the pointer over them or the keyboard focus in them (WCAG 2.2.1). */
export type ToastHold = 'pointer' | 'focus';

let toasts: readonly Toast[] = [];
let sequence = 0;
const holds = new Set<ToastHold>();
const listeners = new Set<() => void>();
/** Remaining time per toast; a timer only runs while nothing holds the toasts. */
const timers = new Map<number, { remaining: number; started: number; handle: ReturnType<typeof setTimeout> | null }>();

const emit = () => listeners.forEach((listener) => listener());

function stopTimer(id: number) {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
}

function startTimer(id: number) {
  const timer = timers.get(id);
  if (!timer) return;
  timer.started = Date.now();
  timer.handle = setTimeout(() => dismissToast(id), timer.remaining);
}

function remove(id: number): Toast | undefined {
  const item = toasts.find((entry) => entry.id === id);
  if (!item) return undefined;
  stopTimer(id);
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
  return item;
}

/** Shows a toast and returns its id. Only the newest three stay; older ones expire. */
export function toast({ duration = DEFAULT_DURATION, tone = 'neutral', ...options }: ToastOptions): number {
  const id = ++sequence;
  const pushedOut = toasts.slice(0, Math.max(0, toasts.length - (MAX_VISIBLE - 1)));
  pushedOut.forEach((item) => stopTimer(item.id));
  toasts = [...toasts.slice(pushedOut.length), { ...options, id, duration, tone }];
  timers.set(id, { remaining: duration, started: 0, handle: null });
  if (holds.size === 0) startTimer(id);
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
  const item = remove(id);
  item?.action?.onClick();
  // the action's button had the focus and is gone now; browsers send no blur for removed elements
  if (item) resumeToasts('focus');
}

export function pauseToasts(hold: ToastHold): void {
  const wasRunning = holds.size === 0;
  holds.add(hold);
  if (!wasRunning) return;
  for (const timer of timers.values()) {
    if (!timer.handle) continue;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
  }
  emit();
}

export function resumeToasts(hold: ToastHold): void {
  if (!holds.delete(hold) || holds.size > 0) return;
  for (const id of timers.keys()) startTimer(id);
  emit();
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

/** Whether something holds the toasts open, so the Toaster can pause the time line. */
export function useToastsPaused(): boolean {
  return useSyncExternalStore(subscribe, toastsPaused, toastsPaused);
}

function toastsPaused(): boolean {
  return holds.size > 0;
}
