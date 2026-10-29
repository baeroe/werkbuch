/*
 * What can happen to a work item, independent of who asks: create, patch, move to a state, archive. The API
 * functions check the permission and call these with the acting account; templates, automations and the live
 * simulation call them as the default bot or as Ida.
 *
 * All of them validate first and change second, so a refused change leaves the item as it was (the API wrapper
 * undoes anything else). Every change is written to the event log, which is the history of the item.
 */

import { canHaveChildren, canHaveParent } from '@/domain/hierarchy';
import { rankBetween } from '@/domain/rank';
import { resolutionAfterTransition } from '@/domain/resolution';
import { parseDate } from '@/domain/tz';
import { canTransition, isClosedCategory, statesInOrder } from '@/domain/workflow';
import { mentionedIds, plainText } from '@/lib/richtext';
import type { Priority, PropertyValue, RichText, User, WorkItem, WorkItemType } from '@/types';
import { canBeAssigned } from './access';
import { linkAttachments, richValues } from './attachments';
import { ApiError, clone, conflict, FieldErrors, invalid, reasonText, sameJson, type Ctx } from './client';
import type { Db } from './db';
import { addSubscriber, notifyPeople, recordEvent } from './events';
import { projectOf, stateOf, userName, workflowOf } from './lookup';
import { checkValues } from './values';

export const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

const MAX_TITLE = 255;
/** Closing a child can close its parent, which can close the grandparent: this far at most (spec 4.13). */
const MAX_PARENT_CHAIN = 5;

export interface CreateWorkItemInput {
  project_id: string;
  type_id: string;
  title: string;
  description?: RichText | null;
  /** Another state than the start state is only allowed when the workflow allows the move from the start state. */
  state_id?: string;
  assignee_id?: string | null;
  priority?: Priority;
  label_ids?: string[];
  start_date?: string | null;
  due_date?: string | null;
  parent_id?: string | null;
  values?: Record<string, PropertyValue>;
  template_id?: string | null;
  /** Uploads made for the item before it was saved; they get this item as their owner. */
  attachment_ids?: string[];
}

export interface WorkItemPatch {
  title?: string;
  description?: RichText | null;
  /** A move to another state; checked against the workflow like `transitionWorkItem`. */
  state_id?: string;
  resolution_id?: string | null;
  assignee_id?: string | null;
  priority?: Priority;
  label_ids?: string[];
  start_date?: string | null;
  due_date?: string | null;
  parent_id?: string | null;
  /** Only the properties named here change; an empty value removes one. */
  values?: Record<string, PropertyValue>;
  /** The manual order (a fractional-indexing key). */
  rank?: string;
}

export function defaultBot(db: Db): User {
  const bot = db.users.find((user) => user.is_default_bot);
  if (!bot) throw new Error('The default bot is missing');
  return bot;
}

const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

/* -------------------------------------------------------------------- checks */

function checkTitle(errors: FieldErrors, title: string): string {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (trimmed === '') errors.add('title', 'Der Titel darf nicht leer sein.');
  else if (trimmed.length > MAX_TITLE) errors.add('title', `Der Titel darf höchstens ${MAX_TITLE} Zeichen haben.`);
  return trimmed;
}

function checkDate(errors: FieldErrors, field: 'start_date' | 'due_date', value: string | null): void {
  if (value !== null && !parseDate(value)) errors.add(field, 'Das Datum ist ungültig (JJJJ-MM-TT).');
}

/** Start and due date must be real days and the start must not lie after the due date. */
function checkDates(errors: FieldErrors, start: string | null, due: string | null, touched: { start: boolean; due: boolean }): void {
  if (touched.start) checkDate(errors, 'start_date', start);
  if (touched.due) checkDate(errors, 'due_date', due);
  if ((touched.start || touched.due) && start && due && parseDate(start) && parseDate(due) && start > due) {
    errors.add('due_date', 'Das Start-Date liegt nach dem Due-Date.');
  }
}

function checkLabels(db: Db, errors: FieldErrors, labelIds: readonly string[]): void {
  if (!labelIds.every((id) => db.labels.some((label) => label.id === id))) errors.add('label_ids', 'Mindestens ein Label gibt es nicht.');
}

/**
 * The parent must be another item of the same project and no descendant of the item (no cycles). Which types may be
 * parent and child is `assertTwoLevels`, after the field checks.
 */
function checkParent(db: Db, errors: FieldErrors, projectId: string, parentId: string, itemId: string | null): void {
  const parent = db.items.find((item) => item.id === parentId);
  if (!parent) return void errors.add('parent_id', 'Das Eltern-Item gibt es nicht.');
  if (parent.project_id !== projectId) return void errors.add('parent_id', 'Das Eltern-Item muss im selben Projekt liegen.');
  for (let cursor: WorkItem | undefined = parent, steps = 0; cursor && steps < 1000; steps += 1) {
    if (cursor.id === itemId) return void errors.add('parent_id', 'Ein Item kann nicht sein eigenes Kind (oder Enkel) als Eltern-Item haben.');
    cursor = cursor.parent_id ? db.items.find((item) => item.id === cursor?.parent_id) : undefined;
  }
}

/**
 * Two levels (`domain/hierarchy`, correction round 2026-10-29): an epic gets no parent, and only an epic takes children.
 * A 422 at `parent_id` with a reason of its own, so a bulk edit names it per item. Runs after the field checks.
 */
function assertTwoLevels(db: Db, type: WorkItemType, parentId: string): void {
  const refuse = (reason: 'epic_has_no_parent' | 'parent_not_epic') =>
    new ApiError({ status: 422, reason, detail: reasonText(reason), errors: { parent_id: [reasonText(reason)] } });
  if (!canHaveParent(type)) throw refuse('epic_has_no_parent');
  const parent = db.items.find((item) => item.id === parentId);
  if (parent && !canHaveChildren(db.types.find((entry) => entry.id === parent.type_id))) throw refuse('parent_not_epic');
}

function checkAssignee(db: Db, errors: FieldErrors, projectId: string, assigneeId: string): void {
  const project = db.projects.find((entry) => entry.id === projectId)!;
  if (!canBeAssigned(db, db.users.find((user) => user.id === assigneeId), project)) {
    errors.add('assignee_id', 'Nur aktive Mitglieder des Projekts und Org-Admins können Items übernehmen.');
  }
}

/** A resolution to choose must exist and be in use; the same 422 for a move and an update. */
function checkResolution(db: Db, errors: FieldErrors, resolutionId: string): void {
  const resolution = db.resolutions.find((entry) => entry.id === resolutionId);
  if (!resolution) errors.add('resolution_id', 'Diese Resolution gibt es nicht.');
  else if (resolution.archived_at !== null) errors.add('resolution_id', 'Diese Resolution ist archiviert. Wähle eine andere.');
}

/** Throws 422 for a state the workflow does not have and 409 for a move it does not allow. */
export function assertTransition(db: Db, item: WorkItem, toStateId: string): void {
  const workflow = workflowOf(db, projectOf(db, item));
  const target = stateOf(workflow, toStateId);
  if (!target) throw invalid({ state_id: ['Diesen Status gibt es im Workflow nicht.'] });
  if (!canTransition(workflow, item.state_id, toStateId)) {
    const from = stateOf(workflow, item.state_id);
    throw conflict('transition_not_allowed', `Von „${from?.name}“ nach „${target.name}“ ist im Workflow „${workflow.name}“ nicht erlaubt.`);
  }
}

/* ----------------------------------------------------------------- mentions */

const excerptOf = (doc: RichText | null | undefined) => plainText(doc).slice(0, 160);

/** Tells people who were just mentioned, makes them watch the item and wakes webhooks of mentioned bots. */
export function handleMentions(ctx: Ctx, actor: User, item: WorkItem, ids: readonly string[], doc: RichText | null, commentId?: string): void {
  for (const id of ids) {
    const user = ctx.db.users.find((entry) => entry.id === id);
    if (!user) continue;
    addSubscriber(ctx.db, item, id, true);
    if (user.type === 'bot') {
      recordEvent(ctx, {
        type: 'bot.mentioned',
        actor_id: actor.id,
        subject: { type: 'work_item', id: item.id },
        project_id: item.project_id,
        changes: commentId ? { comment_id: { old: null, new: commentId } } : {},
        bot_id: user.id,
      });
    }
  }
  const people = ids.filter((id) => ctx.db.users.find((entry) => entry.id === id)?.type === 'person');
  if (people.length > 0) {
    notifyPeople(ctx, {
      event: 'mentioned',
      item,
      actor_id: actor.id,
      event_id: null,
      data: { excerpt: excerptOf(doc), ...(commentId ? { comment_id: commentId } : {}) },
      recipients: people,
    });
  }
}

/* -------------------------------------------------------------------- create */

/** Creates an item (the caller has checked the permission). Numbers count up per project and are never reused. */
export function createItem(ctx: Ctx, actor: User, input: CreateWorkItemInput): WorkItem {
  const { db, stamp } = ctx;
  const project = db.projects.find((entry) => entry.id === input.project_id);
  if (!project) throw invalid({ project_id: ['Das Projekt gibt es nicht.'] });
  const errors = new FieldErrors();

  const type = db.types.find((entry) => entry.id === input.type_id);
  if (!type || !project.enabled_type_ids.includes(type.id)) errors.add('type_id', 'Dieser Typ ist im Projekt nicht aktiviert.');
  else if (type.archived_at !== null) errors.add('type_id', 'Dieser Typ ist archiviert, es lassen sich keine neuen Items anlegen.');

  const title = checkTitle(errors, input.title);
  const priority = input.priority ?? 'none';
  if (!PRIORITIES.includes(priority)) errors.add('priority', 'Diese Priorität gibt es nicht.');
  const labelIds = unique(input.label_ids ?? []);
  checkLabels(db, errors, labelIds);
  const start = input.start_date ?? null;
  const due = input.due_date ?? null;
  checkDates(errors, start, due, { start: true, due: true });
  const assigneeId = input.assignee_id ?? null;
  if (assigneeId !== null) checkAssignee(db, errors, project.id, assigneeId);
  if (input.parent_id) checkParent(db, errors, project.id, input.parent_id, null);
  let values: Record<string, PropertyValue> = {};
  if (type) {
    try {
      values = checkValues(db, project, type, input.values ?? {}, {}, 'create');
    } catch (error) {
      errors.absorb(error);
    }
  }
  errors.throwIfAny();
  if (input.parent_id) assertTwoLevels(db, type!, input.parent_id);

  // another state than the start state is a move from the start state
  const workflow = workflowOf(db, project);
  const initial = stateOf(workflow, workflow.initial_state_id)!;
  const target = input.state_id ? stateOf(workflow, input.state_id) : initial;
  if (!target) throw invalid({ state_id: ['Diesen Status gibt es im Workflow nicht.'] });
  if (!canTransition(workflow, initial.id, target.id)) {
    throw conflict('transition_not_allowed', `Ein neues Item startet in „${initial.name}“. Von dort nach „${target.name}“ ist im Workflow „${workflow.name}“ nicht erlaubt.`);
  }

  const projectItems = db.items.filter((entry) => entry.project_id === project.id);
  const lastNumber = Math.max(db.counters[project.id] ?? 0, ...projectItems.map((entry) => entry.number));
  const lastRank = projectItems.reduce<string | null>((max, entry) => (max === null || entry.rank > max ? entry.rank : max), null);
  const number = lastNumber + 1;
  db.counters[project.id] = number;

  // the item is created in the start state; another state is a move from there, with all a move does (below)
  const item: WorkItem = {
    id: `wi_${project.identifier.toLowerCase()}_${number}`,
    project_id: project.id,
    number,
    key: `${project.identifier}-${number}`,
    type_id: type!.id,
    title,
    description: input.description ? clone(input.description) : null,
    description_version: 1,
    state_id: initial.id,
    resolution_id: resolutionAfterTransition(initial.category, initial.category, null, null, db.resolutions),
    assignee_id: assigneeId,
    priority,
    label_ids: labelIds,
    start_date: start,
    due_date: due,
    parent_id: input.parent_id ?? null,
    rank: rankBetween(lastRank, null),
    values,
    created_by: actor.id,
    created_at: stamp,
    updated_at: stamp,
    started_at: initial.category === 'started' ? stamp : null,
    closed_at: isClosedCategory(initial.category) ? stamp : null,
    archived_at: null,
    template_id: input.template_id ?? null,
    subscriber_ids: [],
  };
  db.items.push(item);

  addSubscriber(db, item, actor.id);
  addSubscriber(db, item, assigneeId, true);
  for (const id of input.attachment_ids ?? []) {
    const attachment = db.attachments.find((entry) => entry.id === id);
    if (attachment && attachment.owner === null && attachment.project_id === project.id) attachment.owner = { type: 'work_item', id: item.id };
  }
  linkAttachments(db, project.id, [item.description, ...richValues(values)], { type: 'work_item', id: item.id });

  const event = recordEvent(ctx, {
    type: 'work_item.created',
    actor_id: actor.id,
    subject: { type: 'work_item', id: item.id },
    project_id: project.id,
    changes: { title: { old: null, new: title } },
  });
  notifyPeople(ctx, { event: 'item_created', item, actor_id: actor.id, event_id: event.id, recipients: [project.lead_id] });
  if (assigneeId !== null) {
    notifyPeople(ctx, { event: 'assigned', item, actor_id: actor.id, event_id: event.id, recipients: [assigneeId] });
    const assignee = db.users.find((user) => user.id === assigneeId);
    if (assignee?.type === 'bot') {
      recordEvent(ctx, { type: 'bot.assigned', actor_id: actor.id, subject: { type: 'work_item', id: item.id }, project_id: project.id, bot_id: assignee.id });
    }
  }
  if (item.description) handleMentions(ctx, actor, item, mentionedIds(item.description), item.description);
  // the history shows the move, and the automations of a move run: assignee on start, closing the parent
  if (target.id !== initial.id) moveItem(ctx, actor, item, target.id, null);
  return item;
}

/* --------------------------------------------------------------------- move */

/** Does the work of `assign_on_start`: a person who starts an item nobody has is its assignee from then on. */
function assignOnStart(ctx: Ctx, actor: User, item: WorkItem): void {
  const { db } = ctx;
  if (actor.type !== 'person' || item.assignee_id !== null) return;
  const enabled = db.automations.some((entry) => entry.project_id === item.project_id && entry.key === 'assign_on_start' && entry.enabled);
  if (!enabled) return;

  item.assignee_id = actor.id;
  addSubscriber(db, item, actor.id, true);
  const event = recordEvent(ctx, {
    type: 'work_item.assigned',
    actor_id: defaultBot(db).id,
    subject: { type: 'work_item', id: item.id },
    project_id: item.project_id,
    changes: { assignee_id: { old: null, new: actor.id } },
    reason: 'Automatisierung: Assignee beim Start',
  });
  // the person who started the item is not told about their own action
  notifyPeople(ctx, { event: 'assigned', item, actor_id: actor.id, event_id: event.id });
}

/** Does the work of `close_parent`: when the last open child closes, the parent follows (spec 4.13). */
function closeParent(ctx: Ctx, child: WorkItem, depth: number): void {
  const { db } = ctx;
  if (depth >= MAX_PARENT_CHAIN || child.parent_id === null) return;
  const parent = db.items.find((entry) => entry.id === child.parent_id);
  if (!parent || parent.archived_at !== null) return;
  const enabled = db.automations.some((entry) => entry.project_id === parent.project_id && entry.key === 'close_parent' && entry.enabled);
  if (!enabled) return;

  const workflow = workflowOf(db, projectOf(db, parent));
  const categoryOf = (item: WorkItem) => stateOf(workflowOf(db, projectOf(db, item)), item.state_id)!.category;
  if (isClosedCategory(categoryOf(parent))) return;
  const children = db.items.filter((entry) => entry.parent_id === parent.id);
  if (!children.every((entry) => isClosedCategory(categoryOf(entry))) || !children.some((entry) => categoryOf(entry) === 'completed')) return;

  const target = statesInOrder(workflow).find((state) => state.category === 'completed' && canTransition(workflow, parent.state_id, state.id));
  if (!target) return; // no way to Done from where the parent stands: it stays open
  moveItem(ctx, defaultBot(db), parent, target.id, null, { reason: 'Automatisierung: Eltern schließen', depth: depth + 1 });
}

export interface MoveOptions {
  reason?: string | null;
  /** How many parents the closing has already travelled up. */
  depth?: number;
}

/**
 * Moves an item to a state the workflow allows: sets or clears the resolution, `started_at` and `closed_at`, writes
 * the history and runs the automations (assignee on start, close the parent). Staying in the state is a no-op unless
 * a resolution is chosen for a closed item. Returns whether anything changed.
 */
export function moveItem(ctx: Ctx, actor: User, item: WorkItem, toStateId: string, chosenResolution: string | null = null, options: MoveOptions = {}): boolean {
  const { db, stamp } = ctx;
  if (item.archived_at !== null) throw conflict('archived', `${item.key} ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.`);
  assertTransition(db, item, toStateId);
  if (chosenResolution !== null) {
    const errors = new FieldErrors();
    checkResolution(db, errors, chosenResolution);
    errors.throwIfAny();
  }

  const workflow = workflowOf(db, projectOf(db, item));
  const from = stateOf(workflow, item.state_id)!;
  const target = stateOf(workflow, toStateId)!;
  const resolution = resolutionAfterTransition(from.category, target.category, item.resolution_id, chosenResolution, db.resolutions);
  const sameState = target.id === from.id;
  if (sameState && resolution === item.resolution_id) return false;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (!sameState) changes.state_id = { old: from.id, new: target.id };
  if (resolution !== item.resolution_id) changes.resolution_id = { old: item.resolution_id, new: resolution };

  item.state_id = target.id;
  item.resolution_id = resolution;
  if (target.category === 'started' && item.started_at === null) item.started_at = stamp;
  if (!isClosedCategory(target.category)) item.closed_at = null;
  else if (!isClosedCategory(from.category) || from.category !== target.category) item.closed_at = stamp;
  item.updated_at = stamp;

  const event = recordEvent(ctx, {
    type: sameState ? 'work_item.updated' : 'work_item.state_changed',
    actor_id: actor.id,
    subject: { type: 'work_item', id: item.id },
    project_id: item.project_id,
    changes,
    reason: options.reason,
  });
  if (sameState) return true;

  notifyPeople(ctx, { event: 'state_changed', item, actor_id: actor.id, event_id: event.id, data: { from_state_id: from.id, to_state_id: target.id } });
  if (target.category === 'started' && from.category !== 'started') assignOnStart(ctx, actor, item);
  if (isClosedCategory(target.category)) closeParent(ctx, item, options.depth ?? 0);
  return true;
}

/* -------------------------------------------------------------------- patch */

/** What `checkPatch` found: the title and values as they will be stored, and whether the description changes. */
interface CheckedPatch {
  title: string | undefined;
  values: Record<string, PropertyValue> | undefined;
  descriptionChanged: boolean;
}

/**
 * Checks a patch against an item and changes nothing: field errors give a 422, a changed description a 409
 * `description_conflict` (when the caller says which version it edited), a move the workflow forbids a 409
 * `transition_not_allowed`. That an item is archived is left to the caller: a bulk edit checks the patch of an archived
 * item before it restores it, so a refused patch leaves the item archived.
 */
export function checkPatch(db: Db, item: WorkItem, patch: WorkItemPatch, options: { base_description_version?: number } = {}): CheckedPatch {
  const project = projectOf(db, item);
  const type = db.types.find((entry) => entry.id === item.type_id)!;
  const errors = new FieldErrors();

  const title = patch.title === undefined ? undefined : checkTitle(errors, patch.title);
  const start = patch.start_date === undefined ? item.start_date : patch.start_date;
  const due = patch.due_date === undefined ? item.due_date : patch.due_date;
  checkDates(errors, start, due, { start: patch.start_date !== undefined, due: patch.due_date !== undefined });
  if (patch.priority !== undefined && !PRIORITIES.includes(patch.priority)) errors.add('priority', 'Diese Priorität gibt es nicht.');
  if (patch.label_ids !== undefined) checkLabels(db, errors, patch.label_ids);
  if (patch.assignee_id && patch.assignee_id !== item.assignee_id) checkAssignee(db, errors, project.id, patch.assignee_id);
  if (patch.parent_id && patch.parent_id !== item.parent_id) checkParent(db, errors, project.id, patch.parent_id, item.id);
  if (patch.resolution_id) checkResolution(db, errors, patch.resolution_id);
  if (patch.rank !== undefined && (typeof patch.rank !== 'string' || patch.rank === '')) errors.add('rank', 'Der Rang ist ungültig.');
  let values: Record<string, PropertyValue> | undefined;
  if (patch.values) {
    try {
      values = checkValues(db, project, type, patch.values, item.values, 'update');
    } catch (error) {
      errors.absorb(error);
    }
  }
  errors.throwIfAny();
  if (patch.parent_id && patch.parent_id !== item.parent_id) assertTwoLevels(db, type, patch.parent_id);

  if (patch.state_id !== undefined) assertTransition(db, item, patch.state_id);
  const descriptionChanged = patch.description !== undefined && !sameJson(patch.description, item.description);
  if (descriptionChanged && options.base_description_version !== undefined && options.base_description_version !== item.description_version) {
    const lastEdit = [...db.events].reverse().find((entry) => entry.subject.id === item.id && 'description' in entry.changes);
    const who = lastEdit ? userName(db, lastEdit.actor_id) : 'Jemand';
    throw conflict('description_conflict', `${who} hat die Beschreibung inzwischen geändert.`, { current: item });
  }
  return { title, values, descriptionChanged };
}

/**
 * Changes fields of an item. Everything is checked before anything changes (`checkPatch`); an archived item is
 * read-only (409 `archived`).
 */
export function patchItem(
  ctx: Ctx,
  actor: User,
  item: WorkItem,
  patch: WorkItemPatch,
  options: { base_description_version?: number; reason?: string | null } = {},
): void {
  const { db, stamp } = ctx;
  if (item.archived_at !== null) throw conflict('archived', `${item.key} ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.`);
  const { title, values, descriptionChanged } = checkPatch(db, item, patch, options);

  // checks passed: change
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const record = (field: string, before: unknown, after: unknown) => {
    if (!sameJson(before, after)) changes[field] = { old: clone(before ?? null), new: clone(after ?? null) };
  };

  if (title !== undefined) {
    record('title', item.title, title);
    item.title = title;
  }
  if (patch.priority !== undefined) {
    record('priority', item.priority, patch.priority);
    item.priority = patch.priority;
  }
  if (patch.label_ids !== undefined) {
    const labels = unique(patch.label_ids);
    if (!sameJson([...labels].sort(), [...item.label_ids].sort())) record('label_ids', item.label_ids, labels);
    item.label_ids = labels;
  }
  if (patch.start_date !== undefined) {
    record('start_date', item.start_date, patch.start_date);
    item.start_date = patch.start_date;
  }
  if (patch.due_date !== undefined) {
    record('due_date', item.due_date, patch.due_date);
    item.due_date = patch.due_date;
  }
  if (patch.parent_id !== undefined) {
    record('parent_id', item.parent_id, patch.parent_id);
    item.parent_id = patch.parent_id;
  }
  if (values) {
    for (const key of new Set([...Object.keys(item.values), ...Object.keys(values)])) record(`values.${key}`, item.values[key], values[key]);
    item.values = values;
  }
  const previousDescription = item.description;
  if (descriptionChanged) {
    record('description', item.description, patch.description);
    item.description = patch.description ? clone(patch.description) : null;
    item.description_version += 1;
  }
  if (patch.rank !== undefined) item.rank = patch.rank; // the order is not history
  if (descriptionChanged || values) linkAttachments(db, item.project_id, [descriptionChanged ? item.description : null, ...richValues(values)], { type: 'work_item', id: item.id });

  if (Object.keys(changes).length > 0) {
    item.updated_at = stamp;
    const event = recordEvent(ctx, {
      type: 'work_item.updated',
      actor_id: actor.id,
      subject: { type: 'work_item', id: item.id },
      project_id: item.project_id,
      changes,
      reason: options.reason,
    });
    notifyPeople(ctx, { event: 'item_changed', item, actor_id: actor.id, event_id: event.id, data: { fields: Object.keys(changes) } });
  }

  if (descriptionChanged) {
    const before = new Set(mentionedIds(previousDescription));
    handleMentions(ctx, actor, item, mentionedIds(item.description).filter((id) => !before.has(id)), item.description);
  }

  if (patch.assignee_id !== undefined && patch.assignee_id !== item.assignee_id) {
    const previous = item.assignee_id;
    item.assignee_id = patch.assignee_id;
    item.updated_at = stamp;
    addSubscriber(db, item, patch.assignee_id, true);
    const event = recordEvent(ctx, {
      type: 'work_item.assigned',
      actor_id: actor.id,
      subject: { type: 'work_item', id: item.id },
      project_id: item.project_id,
      changes: { assignee_id: { old: previous, new: patch.assignee_id } },
      reason: options.reason,
    });
    if (patch.assignee_id !== null) {
      notifyPeople(ctx, { event: 'assigned', item, actor_id: actor.id, event_id: event.id });
      const assignee = db.users.find((user) => user.id === patch.assignee_id);
      if (assignee?.type === 'bot') {
        recordEvent(ctx, { type: 'bot.assigned', actor_id: actor.id, subject: { type: 'work_item', id: item.id }, project_id: item.project_id, bot_id: assignee.id });
      }
    }
  }

  if (patch.state_id !== undefined || patch.resolution_id !== undefined) {
    moveItem(ctx, actor, item, patch.state_id ?? item.state_id, patch.resolution_id ?? null, { reason: options.reason });
  }
}

/* ------------------------------------------------------------------ archive */

export function archiveItem(ctx: Ctx, actor: User, item: WorkItem, reason?: string): void {
  const { db, stamp } = ctx;
  const workflow = workflowOf(db, projectOf(db, item));
  if (!isClosedCategory(stateOf(workflow, item.state_id)!.category)) {
    throw conflict('not_closed', 'Nur geschlossene Items (Completed oder Canceled) lassen sich archivieren.');
  }
  if (item.archived_at !== null) return;
  item.archived_at = stamp;
  recordEvent(ctx, {
    type: 'work_item.archived',
    actor_id: actor.id,
    subject: { type: 'work_item', id: item.id },
    project_id: item.project_id,
    changes: { archived_at: { old: null, new: stamp } },
    reason,
  });
}

export function restoreItem(ctx: Ctx, actor: User, item: WorkItem): void {
  if (item.archived_at === null) throw conflict('not_archived', `${item.key} ist nicht archiviert.`);
  const previous = item.archived_at;
  item.archived_at = null;
  item.updated_at = ctx.stamp;
  recordEvent(ctx, {
    type: 'work_item.restored',
    actor_id: actor.id,
    subject: { type: 'work_item', id: item.id },
    project_id: item.project_id,
    changes: { archived_at: { old: previous, new: null } },
  });
}
