/*
 * Progress of an item with children (spec 4.8): the closed children out of all children.
 */

import type { StateCategory, WorkItem } from '@/types';
import { isClosedCategory } from './workflow';

/** Completed and canceled children both count as done. */
export function childProgress(
  children: readonly WorkItem[],
  stateCategory: (stateId: string) => StateCategory,
): { done: number; total: number } {
  const done = children.filter((child) => isClosedCategory(stateCategory(child.state_id))).length;
  return { done, total: children.length };
}
