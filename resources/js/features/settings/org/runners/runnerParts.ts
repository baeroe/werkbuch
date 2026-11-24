/*
 * Building blocks of the runner screen (WEBU-27, port of the clickdummy's runParts): the system of a runner in words,
 * the kind and the status of a run as words, a time of day in the organisation's zone, the minutes a code has left and
 * a clock that ticks while something waits on it.
 */

import { useEffect, useState } from 'react';
import { intlLocale, t, type TranslationKey } from '@/lib/i18n';
import type { Runner, RunStatus, RunType } from '@/types';

/** Names of products and chips, in every language the same. */
const SYSTEMS: Record<Runner['os'], string> = { darwin: 'macOS', linux: 'Linux' };
const ARCHS: Record<Runner['arch'], string> = { arm64: 'Apple Silicon (arm64)', amd64: 'Intel (amd64)' };

/** "macOS, Apple Silicon (arm64)"; a Linux machine on amd64 is x86-64, no Intel. */
export const systemOf = (runner: Pick<Runner, 'os' | 'arch'>): string =>
  `${SYSTEMS[runner.os]}, ${runner.os === 'linux' && runner.arch === 'amd64' ? 'x86-64 (amd64)' : ARCHS[runner.arch]}`;

const TYPE_KEYS: Record<RunType, TranslationKey> = {
  task: 'settings.runners.run.type.task',
  correction: 'settings.runners.run.type.correction',
  conflict: 'settings.runners.run.type.conflict',
  review: 'settings.runners.run.type.review',
  comment: 'settings.runners.run.type.comment',
};

const STATUS_KEYS: Record<RunStatus, TranslationKey> = {
  queued: 'settings.runners.run.status.queued',
  waiting: 'settings.runners.run.status.waiting',
  running: 'settings.runners.run.status.running',
  canceling: 'settings.runners.run.status.canceling',
  succeeded: 'settings.runners.run.status.succeeded',
  failed: 'settings.runners.run.status.failed',
  canceled: 'settings.runners.run.status.canceled',
  timed_out: 'settings.runners.run.status.timed_out',
  lost: 'settings.runners.run.status.lost',
};

/** "Umsetzen", "Review": what a run does. */
export const runName = (type: RunType): string => t(TYPE_KEYS[type]);

/** "Läuft", "Wird abgebrochen". */
export const statusLabel = (status: RunStatus): string => t(STATUS_KEYS[status]);

const clocks = new Map<string, Intl.DateTimeFormat>();

/** "09:41": the time of day of an instant in the zone. */
export function clockTime(iso: string, timeZone: string): string {
  const key = `${intlLocale()}:${timeZone}`;
  let found = clocks.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone });
    clocks.set(key, found);
  }
  return found.format(new Date(iso));
}

/** "9:41": what is left of a code, in minutes and seconds, never below zero. */
export function remaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Now, drawn anew every second while `active` (the time a code has left). */
export function useNow(active: boolean): number {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setAt(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? at : Date.now();
}

const numbers = new Map<string, Intl.NumberFormat>();

function numberFormat(style: 'gb' | 'percent'): Intl.NumberFormat {
  const key = `${intlLocale()}:${style}`;
  let found = numbers.get(key);
  if (!found) {
    found = new Intl.NumberFormat(intlLocale(), style === 'percent' ? { style: 'percent', maximumFractionDigits: 0 } : { maximumFractionDigits: 1 });
    numbers.set(key, found);
  }
  return found;
}

/** "15,5": gigabytes with at most one decimal. */
export const gigabytes = (value: number): string => numberFormat('gb').format(value);

/** "42 %" (German) or "42%" (English): a share given in percent. */
export const percent = (value: number): string => numberFormat('percent').format(value / 100);

/**
 * Gives `target()` the focus for the next frames: a dialog that just closed (or a focus guard of an open one) moves a
 * lost focus a moment later, so the focus is taken again until it stays. `onlyIf` says whether it may be taken (the
 * person did not go elsewhere). Returns what stops it.
 */
export function holdFocus(target: () => HTMLElement | null | undefined, onlyIf: () => boolean = () => true, frames = 20): () => void {
  let tries = 0;
  let frame = 0;
  const take = () => {
    const element = target();
    if (element?.isConnected && document.activeElement !== element && onlyIf()) element.focus();
    if ((tries += 1) < frames) frame = requestAnimationFrame(take);
  };
  frame = requestAnimationFrame(take);
  return () => cancelAnimationFrame(frame);
}
