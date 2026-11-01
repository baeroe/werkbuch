/*
 * The mapping of states (spec 4.5): when a project switches its workflow, or a workflow loses states, the items in those
 * states need a new one. The server asks for a target for every state that items use (`AssignWorkflow`: 422 at
 * `mapping.<id>`, `SaveWorkflow`: 409 `state_in_use`). Pure functions only: the rows the dialog shows with a proposal
 * each, what the mapping does to the items, and whether every row has its target.
 */

import { isClosedCategory } from '@/domain/workflow';
import type { State, StateUsage } from '@/types';

/** A state that items use, how many, and the state that takes them over (`null`: none chosen yet). */
export interface MappingRow {
  state: State;
  items: number;
  target: string | null;
}

/**
 * What a mapping does to the items beyond their new state: closed ones that land in an open state open again and lose
 * their resolution (`reopened`), open ones that land in a closed state get the default resolution of its category
 * (`closed`), closed ones that move from Completed to Canceled or back get the default of the other one (`resolution`).
 */
export interface MappingEffect {
  kind: 'reopened' | 'closed' | 'resolution';
  items: number;
}

const byPosition = (a: State, b: State) => a.position - b.position;

const sameName = (a: State, b: State) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/** The proposal for a state: the state of the same name, otherwise the first of the same category, otherwise none. */
function proposal(state: State, to: readonly State[]): string | null {
  return (to.find((candidate) => sameName(candidate, state)) ?? to.find((candidate) => candidate.category === state.category))?.id ?? null;
}

/**
 * One row per state of `from` that items use, in the order of `from`, each with its proposal among `to` (in their
 * order). A count for a state `from` does not have is left out: no row could name it.
 */
export function rowsFor(usage: readonly StateUsage[], from: readonly State[], to: readonly State[]): MappingRow[] {
  const counts = new Map(usage.map((entry) => [entry.state_id, entry.items]));
  const targets = [...to].sort(byPosition);
  return [...from]
    .sort(byPosition)
    .filter((state) => (counts.get(state.id) ?? 0) > 0)
    .map((state) => ({ state, items: counts.get(state.id)!, target: proposal(state, targets) }));
}

/** The effects of the rows that have a target, in the order of `MappingEffect['kind']`, only those that happen. */
export function effectsOf(rows: readonly MappingRow[], to: readonly State[]): MappingEffect[] {
  const counts: Record<MappingEffect['kind'], number> = { reopened: 0, closed: 0, resolution: 0 };
  for (const row of rows) {
    const target = to.find((state) => state.id === row.target);
    if (!target) continue;
    const before = row.state.category;
    const after = target.category;
    if (isClosedCategory(before) && !isClosedCategory(after)) counts.reopened += row.items;
    else if (!isClosedCategory(before) && isClosedCategory(after)) counts.closed += row.items;
    else if (isClosedCategory(before) && before !== after) counts.resolution += row.items;
  }
  return (['reopened', 'closed', 'resolution'] as const).filter((kind) => counts[kind] > 0).map((kind) => ({ kind, items: counts[kind] }));
}

/** Whether every row has its target: only then can the mapping be sent. */
export function complete(rows: readonly MappingRow[]): boolean {
  return rows.every((row) => row.target !== null);
}

/** The mapping as the API takes it: state id → target, for every row with a target. */
export function mappingOf(rows: readonly MappingRow[]): Record<string, string> {
  return Object.fromEntries(rows.flatMap((row) => (row.target === null ? [] : [[row.state.id, row.target]])));
}

/** The counts of both, by state: those the server named in a refusal take the place of older ones. */
export function mergeUsage(usage: readonly StateUsage[], newer: readonly StateUsage[]): StateUsage[] {
  const merged = new Map(usage.map((entry) => [entry.state_id, entry]));
  for (const entry of newer) merged.set(entry.state_id, { state_id: entry.state_id, items: entry.items });
  return [...merged.values()];
}
