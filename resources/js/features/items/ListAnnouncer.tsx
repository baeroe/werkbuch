/*
 * The one polite status region of an item list ("Mitteilungen der Liste", spec 5.1, WCAG 4.1.3): it says what changes
 * without the focus moving. A change of the selection ("WEB-47 ausgewählt, 3 von 21", "Auswahl aufgehoben") and the
 * result of a new filter, once its answer is there ("2 Items", "Kein Item passt zum Filter"); not the first load. And
 * that the list now differs from what is saved ("Ungespeicherte Änderungen: …"), once it starts to.
 */

import { useEffect, useRef, useState } from 'react';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { ListedItem } from '@/types';

const number = (count: number) => new Intl.NumberFormat(intlLocale()).format(count);

/**
 * What a change of the selection says, or null for no change. `total` counts every item of the list, also those of
 * pages not loaded yet; `items` are the loaded ones (an id they do not hold reads as "Ein Item").
 */
export function selectionMessage(before: readonly string[], after: readonly string[], items: readonly ListedItem[], total = items.length): string | null {
  const keyOf = (id: string) => items.find((item) => item.id === id)?.key ?? t('items.announce.some_item');
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  if (added.length === 0 && removed.length === 0) return null;
  const of = t('items.announce.of', { count: number(after.length), total: number(total) });
  if (after.length === 0) return t('items.announce.cleared');
  if (added.length === 1 && removed.length === 0) return t('items.announce.selected', { key: keyOf(added[0]!), of });
  if (removed.length === 1 && added.length === 0) return t('items.announce.deselected', { key: keyOf(removed[0]!), of });
  if (after.length === total && added.length > 0) return tn('items.announce.all', total);
  if (added.length > 0) return tn('items.announce.many_selected', added.length, { of });
  return tn('items.announce.many_deselected', removed.length, { of });
}

/** What a new result says: "2 Items", "Ein Item", "Kein Item passt zum Filter" (or "Keine Items" without a filter). */
export function resultMessage(count: number, filtered: boolean): string {
  if (count === 0) return filtered ? t('items.announce.result.none_filtered') : t('items.announce.result.none');
  return tn('items.announce.result.count', count);
}

interface ListAnnouncerProps {
  selection: readonly string[];
  /** The loaded items, for the keys of what is selected. */
  items: readonly ListedItem[];
  total: number;
  /** The filter and what else changes the result, as one key; a new key is announced once `ready` says so. */
  resultKey: string;
  /** The answer of the current result is there. */
  ready: boolean;
  /** The list has conditions of its own: an empty result says that the filter matches nothing. */
  filtered: boolean;
  /** The list differs from what is saved: said once when it starts to (the bar below the toolbar has no region of its own). */
  unsaved?: boolean;
}

export function ListAnnouncer({ selection, items, total, resultKey, ready, filtered, unsaved = false }: ListAnnouncerProps) {
  const [message, setMessage] = useState('');

  const wasUnsaved = useRef(unsaved);
  useEffect(() => {
    if (unsaved && !wasUnsaved.current) setMessage(t('items.announce.unsaved'));
    wasUnsaved.current = unsaved;
  }, [unsaved]);

  const previousSelection = useRef(selection);
  useEffect(() => {
    const before = previousSelection.current;
    previousSelection.current = selection;
    const said = before === selection ? null : selectionMessage(before, selection, items, total);
    if (said) setMessage(said);
  }, [selection, items, total]);

  // the result of a new filter, once its answer is there; the first answer is the list itself, nothing to announce
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (announced.current === null) announced.current = resultKey;
    if (announced.current === resultKey) return;
    announced.current = resultKey;
    setMessage(resultMessage(total, filtered));
  }, [ready, resultKey, total, filtered]);

  return (
    <div role="status" aria-label={t('items.announce.label')} className="sr-only">
      {message}
    </div>
  );
}
