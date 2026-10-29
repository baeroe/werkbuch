/*
 * Resolutions (spec 4.7): the reason an item was closed. Set on the way into Completed or Canceled, cleared on the
 * way back out.
 */

import type { Resolution, StateCategory } from '@/types';
import { isClosedCategory } from './workflow';

/**
 * The resolution an item has after a transition.
 * - Into an open category: none.
 * - Into a closed category: the chosen one, if it exists and is not archived; otherwise the one the item already has
 *   when it stays in the same category; otherwise the default of the category (none when there is no default).
 */
export function resolutionAfterTransition(
  fromCat: StateCategory,
  toCat: StateCategory,
  current: string | null,
  chosen: string | null,
  resolutions: Resolution[],
): string | null {
  if (!isClosedCategory(toCat)) return null;

  if (chosen !== null && resolutions.some((r) => r.id === chosen && r.archived_at === null)) return chosen;
  if (fromCat === toCat && current !== null) return current;

  const defaults = resolutions
    .filter((r) => r.default_for === toCat && r.archived_at === null)
    .sort((a, b) => a.position - b.position);
  return defaults[0]?.id ?? null;
}
