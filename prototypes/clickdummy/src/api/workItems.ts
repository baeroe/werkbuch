/*
 * Work items (spec 4.8, REST `/api/v1/work-items`). The functions check the permission and call the rules in
 * `itemRules.ts`; reading goes through the filter engine and the scope of the projects a person sees.
 */

import { childProgress } from '@/domain/progress';
import { matchesFilter, sortItems } from '@/domain/filter';
import type {
  ActivityEntry,
  BulkResult,
  Filter,
  Project,
  PropertyValue,
  RelationChange,
  RelationEntry,
  SortSpec,
  User,
  WorkItem,
  WorkItemDetail,
  WorkItemMeta,
} from '@/types';
import { canSeeProject, requireRole, requireWritable, visibleProjectIds, visibleProjects } from './access';
import { ApiError, conflict, FieldErrors, invalid, notFound, paginate, read, write, type Page, type PageArgs } from './client';
import type { Db } from './db';
import { addSubscriber, recordEvent, removeSubscriber } from './events';
import {
  archiveItem,
  createItem,
  moveItem,
  patchItem,
  restoreItem,
  type CreateWorkItemInput,
  type WorkItemPatch,
} from './itemRules';
import { blockingSets, filterContext, findItem, parentIds, projectOf, propertiesOfType, stateOf, workflowOf } from './lookup';
import { checkValues } from './values';

export type { CreateWorkItemInput, WorkItemPatch } from './itemRules';

/** The item behind a key or id, if the person may see its project; 404 otherwise. */
export function requireItem(db: Db, me: User, ref: string): { item: WorkItem; project: Project } {
  const item = findItem(db, ref);
  const project = item ? projectOf(db, item) : undefined;
  if (!item || !project || !canSeeProject(db, me, project)) throw notFound('Das Item');
  return { item, project };
}

/* ------------------------------------------------------------------------ read */

export interface ListWorkItemsArgs extends PageArgs {
  /** A saved view: its filter and sort apply, and `filter` and `sort` narrow or override them. */
  view_id?: string;
  filter?: Filter;
  sort?: SortSpec;
  /** Also items that are archived and items of archived projects. */
  include_archived?: boolean;
}

const MANUAL_ORDER: SortSpec = { field: 'rank', direction: 'asc' };

/**
 * Items the signed-in account may see, filtered and sorted by the shared engine. Archived items are hidden unless
 * `include_archived` is set or the filter itself talks about `archived`.
 */
export function listWorkItems(args: ListWorkItemsArgs = {}): Promise<Page<WorkItem>> {
  return read(({ db, me }) => {
    const view = args.view_id ? db.views.find((entry) => entry.id === args.view_id) : undefined;
    if (args.view_id && !view) throw notFound('Die View');

    const filter: Filter = { version: 1, conditions: [...(view?.filter.conditions ?? []), ...(args.filter?.conditions ?? [])] };
    const sort = args.sort ?? view?.display.sort ?? MANUAL_ORDER;
    const archivedWanted = args.include_archived === true || filter.conditions.some((condition) => condition.field === 'archived');
    const ctx = filterContext(db, me);

    const scope = new Set(
      visibleProjects(db, me)
        .filter((project) => args.include_archived === true || project.archived_at === null)
        .map((project) => project.id),
    );
    const matching = db.items.filter(
      (item) => scope.has(item.project_id) && (archivedWanted || item.archived_at === null) && matchesFilter(item, filter, ctx),
    );
    return paginate(sortItems(matching, sort, ctx), args);
  });
}

/** One item with everything the detail view shows; `keyOrId` takes `WEB-47`, a former identifier or the id. */
export function getWorkItem(keyOrId: string): Promise<WorkItemDetail> {
  return read(({ db, me }) => {
    const { item, project } = requireItem(db, me, keyOrId);
    const workflow = workflowOf(db, project);
    const ctx = filterContext(db, me);

    const relations: RelationEntry[] = db.relations
      .filter((relation) => relation.source_id === item.id || relation.target_id === item.id)
      .map((relation) => {
        const outward = relation.source_id === item.id;
        const other = db.items.find((entry) => entry.id === (outward ? relation.target_id : relation.source_id));
        const direction = outward ? 'outward' : 'inward';
        if (other !== undefined && canSeeProject(db, me, projectOf(db, other))) return { relation, other, direction, hidden: false };
        // a hidden end stays hidden: neither the item nor its id (which spells its key) leaves the server
        return { relation: outward ? { ...relation, target_id: '' } : { ...relation, source_id: '' }, other: null, direction, hidden: true };
      });

    return {
      item,
      type: db.types.find((type) => type.id === item.type_id)!,
      state: stateOf(workflow, item.state_id)!,
      workflow,
      children: sortItems(
        db.items.filter((child) => child.parent_id === item.id),
        MANUAL_ORDER,
        ctx,
      ),
      relations,
      attachments: db.attachments.filter((attachment) => attachment.owner?.type === 'work_item' && attachment.owner.id === item.id),
      subscribed: item.subscriber_ids.includes(me.id),
    };
  });
}

/** Progress of epics and parents, and which items are blocked or block others, for all items of visible projects. */
export function getWorkItemMeta(): Promise<WorkItemMeta> {
  return read(({ db, me }) => {
    const scope = visibleProjectIds(db, me);
    const ctx = filterContext(db, me);
    const visible = db.items.filter((item) => scope.has(item.project_id));
    const parents = parentIds(db);
    const { blocked, blocking } = blockingSets(db);

    const progress: WorkItemMeta['progress'] = {};
    for (const parent of visible.filter((item) => parents.has(item.id))) {
      progress[parent.id] = childProgress(
        db.items.filter((child) => child.parent_id === parent.id),
        ctx.stateCategory,
      );
    }
    return {
      progress,
      blocked: visible.filter((item) => blocked.has(item.id)).map((item) => item.id),
      blocking: visible.filter((item) => blocking.has(item.id)).map((item) => item.id),
    };
  });
}

/**
 * What an event about a relation tells this reader about the other item: its current key when they may see it, only
 * "hidden" otherwise (also when the item is gone). Events store the id; nothing but this answer leaves the server.
 */
function relationChange(db: Db, me: User, stored: unknown): RelationChange | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const { label, item_id } = stored as { label?: string; item_id?: string };
  const other = db.items.find((entry) => entry.id === item_id);
  const text = typeof label === 'string' ? label : '';
  return other && canSeeProject(db, me, projectOf(db, other)) ? { label: text, item_id: other.id, key: other.key } : { label: text, hidden: true };
}

/** Comments and history of an item, oldest first. Relation events name the other item only if the reader may see it. */
export function listActivity(itemRef: string, args: PageArgs = {}): Promise<Page<ActivityEntry>> {
  return read(({ db, me }) => {
    const { item } = requireItem(db, me, itemRef);
    const entries: ActivityEntry[] = [
      ...db.comments
        .filter((comment) => comment.work_item_id === item.id)
        .map((comment): ActivityEntry => ({ kind: 'comment', id: comment.id, at: comment.created_at, comment })),
      // the comment itself shows in the list, so its `comment.created` event does not
      ...db.events
        .filter((event) => event.subject.type === 'work_item' && event.subject.id === item.id && event.type !== 'comment.created')
        .map((event): ActivityEntry => {
          const relation = event.changes.relation;
          const shown = relation
            ? { ...event, changes: { ...event.changes, relation: { old: relationChange(db, me, relation.old), new: relationChange(db, me, relation.new) } } }
            : event;
          return { kind: 'event', id: event.id, at: event.occurred_at, event: shown };
        }),
    ];
    const ordered = entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => (a.entry.at < b.entry.at ? -1 : a.entry.at > b.entry.at ? 1 : a.index - b.index))
      .map(({ entry }) => entry);
    return paginate(ordered, args);
  });
}

/* ---------------------------------------------------------------------- write */

export function createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
  return write((ctx) => {
    const project = ctx.db.projects.find((entry) => entry.id === input.project_id);
    if (!project) throw invalid({ project_id: ['Das Projekt gibt es nicht.'] });
    requireWritable(ctx.db, ctx.me, project, 'member', 'Items anlegen dürfen nur Member und Admins des Projekts.');
    return createItem(ctx, ctx.me, input);
  });
}

/**
 * Changes fields of an item. `base_description_version` is the version of the description the client edited: when
 * the description has moved on in the meantime the call fails with 409 `description_conflict` and the stored item.
 * A `state_id` in the patch is a move like `transitionWorkItem`.
 */
export function updateWorkItem(id: string, patch: WorkItemPatch, options: { base_description_version?: number } = {}): Promise<WorkItem> {
  return write((ctx) => {
    const { item, project } = requireItem(ctx.db, ctx.me, id);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Items ändern dürfen nur Member und Admins des Projekts.');
    patchItem(ctx, ctx.me, item, patch, options);
    return item;
  });
}

/** Moves an item to a state (409 `transition_not_allowed` when the workflow forbids it) and sets the resolution. */
export function transitionWorkItem(id: string, to_state_id: string, resolution_id?: string | null): Promise<WorkItem> {
  return write((ctx) => {
    const { item, project } = requireItem(ctx.db, ctx.me, id);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Den Status ändern dürfen nur Member und Admins des Projekts.');
    moveItem(ctx, ctx.me, item, to_state_id, resolution_id ?? null);
    return item;
  });
}

/** What a bulk edit can change; the rest of the patch is what `updateWorkItem` takes. */
export type BulkPatch = Pick<WorkItemPatch, 'state_id' | 'resolution_id' | 'assignee_id' | 'priority' | 'label_ids' | 'start_date' | 'due_date'> & {
  add_label_ids?: string[];
  remove_label_ids?: string[];
  /** `true` archives (closed items only), `false` restores. */
  archived?: boolean;
};

/**
 * Applies one change to many items. Each item follows its own rules: what they allow is changed, what they refuse
 * is reported with the reason (e.g. `transition_not_allowed`, `not_closed`, `forbidden`) and the rest goes on.
 */
export function bulkUpdateWorkItems(ids: string[], patch: BulkPatch): Promise<BulkResult> {
  return write((ctx) => {
    const { archived, add_label_ids, remove_label_ids, ...fields } = patch;
    const result: BulkResult = { updated: [], rejected: [] };

    for (const id of ids) {
      try {
        const { item, project } = requireItem(ctx.db, ctx.me, id);
        requireWritable(ctx.db, ctx.me, project, 'member');

        if (archived === false) restoreItem(ctx, ctx.me, item);
        const itemPatch: WorkItemPatch = { ...fields };
        if (add_label_ids || remove_label_ids) {
          const base = fields.label_ids ?? item.label_ids;
          itemPatch.label_ids = [...base, ...(add_label_ids ?? [])].filter((label) => !(remove_label_ids ?? []).includes(label));
        }
        if (Object.keys(itemPatch).length > 0) patchItem(ctx, ctx.me, item, itemPatch);
        if (archived === true) archiveItem(ctx, ctx.me, item);
        result.updated.push(item.id);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        result.rejected.push({ id, reason: error.reason });
      }
    }
    return result;
  });
}

/**
 * Gives the item another type. Values of properties the new type lacks are dropped (they stay in the history), and
 * the required properties of the new type must be filled: 422 `values.<key>` otherwise.
 */
export function changeWorkItemType(id: string, type_id: string, values: Record<string, PropertyValue> = {}): Promise<WorkItem> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const { item, project } = requireItem(db, me, id);
    requireWritable(db, me, project, 'member', 'Den Typ ändern dürfen nur Member und Admins des Projekts.');
    if (item.archived_at !== null) throw conflict('archived', `${item.key} ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.`);
    if (item.type_id === type_id) return item;

    const errors = new FieldErrors();
    const type = db.types.find((entry) => entry.id === type_id);
    if (!type || !project.enabled_type_ids.includes(type.id)) errors.add('type_id', 'Dieser Typ ist im Projekt nicht aktiviert.');
    else if (type.archived_at !== null) errors.add('type_id', 'Dieser Typ ist archiviert.');
    errors.throwIfAny();

    const kept = new Set(propertiesOfType(db, type!).map(({ property }) => property.key));
    const keptValues = Object.fromEntries(Object.entries(item.values).filter(([key]) => kept.has(key)));
    const merged = checkValues(db, project, type!, values, keptValues, 'create');

    const changes: Record<string, { old: unknown; new: unknown }> = { type_id: { old: item.type_id, new: type_id } };
    for (const [key, value] of Object.entries(item.values)) if (!kept.has(key)) changes[`values.${key}`] = { old: value, new: null };
    for (const key of Object.keys(merged)) if (!(key in item.values)) changes[`values.${key}`] = { old: null, new: merged[key] };

    item.type_id = type_id;
    item.values = merged;
    item.updated_at = stamp;
    recordEvent(ctx, { type: 'work_item.updated', actor_id: me.id, subject: { type: 'work_item', id: item.id }, project_id: project.id, changes });
    return item;
  });
}

/** Archives a closed item (409 `not_closed` otherwise). */
export function archiveWorkItem(id: string): Promise<WorkItem> {
  return write((ctx) => {
    const { item, project } = requireItem(ctx.db, ctx.me, id);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Archivieren dürfen nur Member und Admins des Projekts.');
    archiveItem(ctx, ctx.me, item);
    return item;
  });
}

export function restoreWorkItem(id: string): Promise<WorkItem> {
  return write((ctx) => {
    const { item, project } = requireItem(ctx.db, ctx.me, id);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Wiederherstellen dürfen nur Member und Admins des Projekts.');
    restoreItem(ctx, ctx.me, item);
    return item;
  });
}

/**
 * Deletes an item for good (project admins only): comments, attachments and relations go with it, children lose
 * their parent. The UI waits for the end of the undo toast before it calls this.
 */
export function deleteWorkItem(id: string): Promise<void> {
  return write((ctx) => {
    const { db, me } = ctx;
    const { item, project } = requireItem(db, me, id);
    requireWritable(db, me, project, 'admin', 'Items löschen dürfen nur Admins des Projekts.');

    db.items = db.items.filter((entry) => entry.id !== item.id);
    db.items.forEach((entry) => {
      if (entry.parent_id === item.id) entry.parent_id = null;
    });
    db.comments = db.comments.filter((comment) => comment.work_item_id !== item.id);
    db.attachments = db.attachments.filter((attachment) => !(attachment.owner?.type === 'work_item' && attachment.owner.id === item.id));
    db.relations = db.relations.filter((relation) => relation.source_id !== item.id && relation.target_id !== item.id);
    db.notifications = db.notifications.filter((notification) => notification.work_item_id !== item.id);
    db.events = db.events.filter((event) => event.subject.id !== item.id);
    db.templates.forEach((template) => {
      if (template.payload.parent_id === item.id) template.payload.parent_id = null;
    });
    delete db.unsubscribed[item.id];
    recordEvent(ctx, { type: 'work_item.deleted', actor_id: me.id, subject: { type: 'work_item', id: item.id }, project_id: project.id });
  });
}

/** Watch an item or stop watching it. Whoever stops is subscribed again only by a new mention or assignment. */
export function setSubscribed(id: string, on: boolean): Promise<WorkItem> {
  return write(({ db, me }) => {
    const { item, project } = requireItem(db, me, id);
    requireRole(db, me, project, 'viewer');
    if (on) addSubscriber(db, item, me.id, true);
    else removeSubscriber(db, item, me.id);
    return item;
  });
}
