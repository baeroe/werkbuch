/*
 * The pure rules of the keyboard selection of an item layout (spec 5.3), ported from the clickdummy's
 * `features/items/selection/useSelection.ts`: x toggles one item, ⇧ ranges grow from an anchor, j/k step through the
 * order of the layout. `useSelection` binds them to the keys.
 */

/** The selection with the item added, or taken out when it was in. */
export function toggleId(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((entry) => entry !== id) : [...selection, id];
}

/** The ids from `from` to `to` in the order of the list, both included; just `to` when `from` is not in the list. */
export function rangeBetween(order: readonly string[], from: string | null, to: string): string[] {
  const end = order.indexOf(to);
  if (end < 0) return [];
  const start = from === null ? -1 : order.indexOf(from);
  if (start < 0) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** The selection with the range from the anchor to `to` added; each id once, in the order of the list. */
export function selectRange(selection: readonly string[], order: readonly string[], anchor: string | null, to: string): string[] {
  const chosen = new Set([...selection, ...rangeBetween(order, anchor, to)]);
  return [...order.filter((id) => chosen.has(id)), ...selection.filter((id) => !order.includes(id))];
}

/** The next item in a direction; from no cursor the first (or, going up, the last); at the ends it stays. */
export function nextInOrder(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index < 0) return step === 1 ? order[0]! : order[order.length - 1]!;
  return order[Math.min(order.length - 1, Math.max(0, index + step))]!;
}
