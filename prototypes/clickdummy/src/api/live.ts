/*
 * Live updates (spec 7.2, Reverb): an in-memory bus. Changes of the signed-in person are not announced (the client
 * applies its own changes); only what others do arrives here. `simulateRemoteChange` is that "other": Ida changes
 * the status or the priority of an open WEB item. While the connection is off nothing is delivered; when it comes
 * back, subscribers are asked to load again (`live.reconnected`).
 */

import { allowedTargets, isClosedCategory } from '@/domain/workflow';
import { makeCtx, currentUserId } from './client';
import { getDb, rollbackDb, saveDb } from './db';
import { moveItem, patchItem, PRIORITIES } from './itemRules';
import { findProject, workflowCategory, workflowOf } from './lookup';

export interface LiveEvent {
  type: string;
  item_id?: string;
  actor_id: string;
}

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let connected = true;

/** Calls `callback` for every live event until the returned function is called. */
export function subscribeLive(callback: Listener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function emit(event: LiveEvent): void {
  if (!connected) return;
  [...listeners].forEach((listener) => listener(event));
}

export function isLiveConnected(): boolean {
  return connected;
}

/** For `useSyncExternalStore`: called when the connection goes off or on. */
export function subscribeLiveStatus(callback: () => void): () => void {
  statusListeners.add(callback);
  return () => {
    statusListeners.delete(callback);
  };
}

/** Switches the connection off or on ("Live-Verbindung trennen"). Coming back asks the subscribers to reload. */
export function setLiveConnected(on: boolean): void {
  if (connected === on) return;
  connected = on;
  statusListeners.forEach((listener) => listener());
  if (on) emit({ type: 'live.reconnected', actor_id: 'system' });
}

const pick = <T>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)];

/**
 * Ida changes the status or the priority of an open WEB item, as if she worked in another window. The change is
 * stored and logged like any other and reaches the subscribers; items the signed-in person watches are preferred,
 * so that the inbox shows something new. Answers the event, or null when there is nothing to change.
 */
export async function simulateRemoteChange(): Promise<LiveEvent | null> {
  const db = getDb();
  const ida = db.users.find((user) => user.id === 'u_ida');
  const project = findProject(db, 'WEB');
  if (!ida || !project) return null;

  const ctx = makeCtx(db, ida);
  const open = db.items.filter(
    (item) => item.project_id === project.id && item.archived_at === null && !isClosedCategory(workflowCategory(workflowOf(db, project), item.state_id)),
  );
  const watched = open.filter((item) => item.subscriber_ids.includes(currentUserId()));
  const item = pick(watched.length > 0 ? watched : open);
  if (!item) return null;

  try {
    const targets = allowedTargets(workflowOf(db, project), item.state_id).filter((state) => !isClosedCategory(state.category));
    let type = 'work_item.updated';
    if (targets.length > 0 && Math.random() < 0.5) {
      moveItem(ctx, ida, item, pick(targets).id);
      type = 'work_item.state_changed';
    } else {
      patchItem(ctx, ida, item, { priority: pick(PRIORITIES.filter((priority) => priority !== item.priority)) });
    }
    saveDb();
    const event: LiveEvent = { type, item_id: item.id, actor_id: ida.id };
    emit(event);
    return event;
  } catch (error) {
    rollbackDb();
    throw error;
  }
}
