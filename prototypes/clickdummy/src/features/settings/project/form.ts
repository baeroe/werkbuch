/*
 * What the forms of the settings screens have in common: edits layered over the data of the server, the field errors
 * of a 422 (shown at the field, spec 6.1), the cause of a failed load, and the shortcut that saves.
 */

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { useShortcut } from '@/lib/shortcuts/useShortcut';

/** The first message per field of a 422, keyed by path (`identifier`, `settings.days`). Empty for any other error. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 422 || !error.errors) return {};
  return Object.fromEntries(Object.entries(error.errors).flatMap(([path, messages]) => (messages[0] ? [[path, messages[0]]] : [])));
}

/** The cause of a failed load in German, for the error state of a section. */
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Der Server hat nicht geantwortet.';
}

/** Puts the focus on the first field a 422 marked, so the person lands on what needs fixing. */
export function focusFirstInvalid(form: HTMLElement | null): void {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

/**
 * A row is going away (removed, and waiting out its undo time): the focus goes to the next row, or the one before, so a
 * person on the keyboard does not fall back to the top of the page. Call it before the row is hidden.
 */
export function focusNeighbour(row: Element | null | undefined): void {
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
  if (!neighbour) return;
  requestAnimationFrame(() => neighbour.querySelector<HTMLElement>('button:not([disabled]), [role="combobox"]:not([disabled]), a[href]')?.focus());
}

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
  /** "Speichern" was pressed with nothing to save: true for a few seconds, so the form can say so. */
  quiet: boolean;
  tellNothingToSave: () => void;
}

/**
 * Edits layered over server data. Fields nobody touched follow the server (a live update shows), edited ones stay
 * until `reset` (after saving, or "Zurücksetzen").
 */
export function useDraft<T extends object>(source: T): Draft<T> {
  const [edits, setEdits] = useState<Partial<T>>({});
  const [quiet, setQuiet] = useState(false);
  const value = useMemo(() => ({ ...source, ...edits }), [source, edits]);
  const changed = useMemo(() => (Object.keys(edits) as (keyof T)[]).filter((key) => !same(edits[key], source[key])), [source, edits]);
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
  useShortcut(
    { id: 'settings.save', keys: 'mod+enter', scope: 'detail', label: 'Einstellungen speichern', group: 'Einstellungen', run: () => form.current?.requestSubmit(), when: () => active },
    [active],
  );
}
