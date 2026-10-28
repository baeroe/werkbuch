/*
 * Switching a project to another workflow (spec 4.5): every status the project's items are in needs a status of the
 * new workflow. The API takes a complete mapping (old state id → new state id); this module proposes one and says what
 * it does to the items, so the dialog can show both before anything happens.
 */

import { isClosedCategory, statesInOrder } from '@/domain/workflow';
import type { State, StateCategory, Workflow } from '@/types';

/** Where a state goes when the new workflow has none of its kind: the nearest kinds, in order. */
const NEIGHBOURS: Record<StateCategory, StateCategory[]> = {
  backlog: ['backlog', 'unstarted', 'started'],
  unstarted: ['unstarted', 'backlog', 'started'],
  started: ['started', 'unstarted', 'backlog'],
  completed: ['completed'],
  // a canceled item stays closed
  canceled: ['canceled', 'completed'],
};

const sameName = (a: State, b: State) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/** The state of `to` that best takes over the items of `state`, or the start state when nothing fits. */
function bestMatch(state: State, to: Workflow): State {
  const candidates = statesInOrder(to);
  for (const category of NEIGHBOURS[state.category]) {
    const ofKind = candidates.filter((candidate) => candidate.category === category);
    if (ofKind.length === 0) continue;
    // within the kind: the namesake, then the one with the same shape (Pending and Kundenfreigabe both wait), then the first
    return (
      (category === state.category && (ofKind.find((candidate) => sameName(candidate, state)) ?? ofKind.find((candidate) => candidate.icon === state.icon))) ||
      ofKind[0]
    );
  }
  return candidates.find((candidate) => candidate.id === to.initial_state_id) ?? candidates[0];
}

/** A complete mapping from the states of `from` to those of `to`, as the dialog preselects it. */
export function suggestMapping(from: Workflow, to: Workflow): Record<string, string> {
  return Object.fromEntries(statesInOrder(from).map((state) => [state.id, bestMatch(state, to).id]));
}

/** How many items sit in each state. */
export function countByState(items: readonly { state_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.state_id, (counts.get(item.state_id) ?? 0) + 1);
  return counts;
}

export interface MappingEffects {
  /** All items that are rewritten. */
  items: number;
  /** Closed items that land in an open state: they lose their resolution. */
  reopened: number;
  /** Open items that land in a closed state: they get the default resolution of the category. */
  closed: number;
}

/** What a mapping does to the items it is applied to (`counts`: items per state of the old workflow). */
export function mappingEffects(from: Workflow, to: Workflow, mapping: Record<string, string>, counts: ReadonlyMap<string, number>): MappingEffects {
  const effects: MappingEffects = { items: 0, reopened: 0, closed: 0 };
  for (const [stateId, count] of counts) {
    const before = from.states.find((state) => state.id === stateId);
    const after = to.states.find((state) => state.id === mapping[stateId]);
    effects.items += count;
    if (!before || !after) continue;
    const wasClosed = isClosedCategory(before.category);
    const isClosed = isClosedCategory(after.category);
    if (wasClosed && !isClosed) effects.reopened += count;
    if (!wasClosed && isClosed) effects.closed += count;
  }
  return effects;
}
