/*
 * What the forms of the settings screens have in common: edits layered over the data of the server, what a refused call
 * tells a form (the 422 field errors at their fields, spec 6.1, and the sentence for everything else), the cause of a
 * failed load, the focus when a row goes away, and the shortcut that saves.
 */

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { t } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';

/* ---------------------------------------------------------------------- refusals */

/** The first message per field of a 422, keyed by path (`identifier`, `settings.days`). Empty for any other error. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 422 || !error.errors) return {};
  return Object.fromEntries(Object.entries(error.errors).flatMap(([path, messages]) => (messages[0] ? [[path, messages[0]]] : [])));
}

/** The first message the server gave for one of the fields (`key`, `settings`, `options` …). */
export function fieldMessage(error: unknown, ...paths: string[]): string | undefined {
  if (!(error instanceof ApiError) || !error.errors) return undefined;
  for (const path of paths) {
    const message = error.errors[path]?.[0];
    if (message) return message;
  }
  return undefined;
}

/** Field messages for paths the form has no place for; they would be lost otherwise. */
export function unplacedMessages(error: unknown, placed: readonly string[]): string[] {
  if (!(error instanceof ApiError) || !error.errors) return [];
  return Object.entries(error.errors)
    .filter(([path]) => !placed.includes(path))
    .flatMap(([, messages]) => messages);
}

/** The cause of a failed call in the language of the page: the API's sentence, or what no answer at all means. */
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : t('errors.no_answer');
}

/** Whether a refusal is the 409 with this reason, e.g. `last_admin`. */
export function hasReason(error: unknown, reason: string): error is ApiError {
  return error instanceof ApiError && error.reason === reason;
}

/**
 * What a form shows as a notice: the server's sentence when there is no field it belongs to, otherwise nothing, because
 * the field shows it.
 */
export function noticeOf(error: unknown, placed: readonly string[]): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 422) {
    const rest = unplacedMessages(error, placed);
    return rest.length > 0 ? rest.join(' ') : null;
  }
  return errorText(error);
}

/* ------------------------------------------------------------------------- focus */

/** Puts the focus on the first field a 422 marked, so the person lands on what needs fixing. */
export function focusFirstInvalid(form: HTMLElement | null): void {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

const FOCUSABLE = 'button:not([disabled]):not([aria-disabled="true"]), [role="combobox"]:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), [tabindex="0"]';

/**
 * A row is going away (removed, and waiting out its undo time): the focus goes to the next row, or to the one before
 * when this is the last, and to `fallback` when it was the only one: the page itself by default, the control below the
 * list inside a dialog (the page lies behind it). So a person on the keyboard does not fall back to the top. Call it
 * with the row before it is hidden; `null` (the focus was not in a row) moves nothing.
 */
export function focusNeighbour(row: Element | null | undefined, fallback?: HTMLElement | null): void {
  if (!row) return;
  const neighbour = row.nextElementSibling ?? row.previousElementSibling;
  // after the next paint, when the row is out of the DOM and the target is where it will stay
  requestAnimationFrame(() => {
    const target = neighbour?.querySelector<HTMLElement>(FOCUSABLE) ?? fallback ?? document.getElementById('main');
    if (target?.isConnected) target.focus();
  });
}

/* ------------------------------------------------------------------------ drafts */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface Draft<T> {
  /** The data of the server with the edits on top. */
  value: T;
  /** The fields whose edit differs from the server's data. */
  changed: (keyof T)[];
  dirty: boolean;
  set: (patch: Partial<T>) => void;
  /** Drops all edits: the form shows the server's data again. */
  reset: () => void;
  /** "Save" was pressed with nothing to save: true for a few seconds, so the form can say so. */
  quiet: boolean;
  tellNothingToSave: () => void;
}

/**
 * Edits layered over server data. Fields nobody touched follow the server (a live update shows), edited ones stay until
 * `reset` (after saving, or "Reset"). A screen that shows another record mounts the form under another `key`.
 */
export function useDraft<T extends object>(source: T): Draft<T> {
  const [edits, setEdits] = useState<Partial<T>>({});
  const [quiet, setQuiet] = useState(false);
  const value = useMemo(() => ({ ...source, ...edits }), [source, edits]);
  const changed = useMemo(() => (Object.keys(edits) as (keyof T)[]).filter((field) => !same(edits[field], source[field])), [source, edits]);
  const dirty = changed.length > 0;
  const set = useCallback((patch: Partial<T>) => setEdits((current) => ({ ...current, ...patch })), []);
  const reset = useCallback(() => setEdits({}), []);
  const tellNothingToSave = useCallback(() => setQuiet(true), []);

  // the note goes away by itself, and as soon as there is something to save
  useEffect(() => {
    if (!quiet) return;
    const timer = setTimeout(() => setQuiet(false), 3000);
    return () => clearTimeout(timer);
  }, [quiet]);
  useEffect(() => {
    if (dirty) setQuiet(false);
  }, [dirty]);

  return { value, changed, dirty, set, reset, quiet, tellNothingToSave };
}

export interface FieldErrorState {
  /** The message per field path, to hand to the `error` of the field. */
  errors: Record<string, string>;
  /** Shows the errors of a 422 and moves the focus to the first field that has one. */
  show: (errors: Record<string, string>) => void;
  /** An error goes away when its field is edited. */
  clear: (...paths: string[]) => void;
  clearAll: () => void;
}

/** The field errors of one form. `form` is the element that holds the fields, for the focus. */
export function useFieldErrors(form: RefObject<HTMLElement | null>): FieldErrorState {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const show = useCallback(
    (next: Record<string, string>) => {
      setErrors(next);
      // after the fields have drawn their error
      setTimeout(() => focusFirstInvalid(form.current), 0);
    },
    [form],
  );
  const clear = useCallback(
    (...paths: string[]) =>
      setErrors((current) => (paths.some((path) => path in current) ? Object.fromEntries(Object.entries(current).filter(([path]) => !paths.includes(path))) : current)),
    [],
  );
  const clearAll = useCallback(() => setErrors({}), []);
  return { errors, show, clear, clearAll };
}

/** ⌘↵ saves the form that is on the page, from inside a field too. */
export function useSaveShortcut(form: RefObject<HTMLFormElement | null>, active: boolean): void {
  useShortcut('settings.save', () => form.current?.requestSubmit(), { when: () => active });
}
