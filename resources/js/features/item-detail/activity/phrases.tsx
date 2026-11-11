/*
 * What an event of the history reads as, after "<Name> hat" (spec 4.10: who, when and old → new for every field):
 * one phrase per changed field, in a fixed order (`FIELD_ORDER`), e.g. "die Priorität von High auf Urgent geändert".
 * - Names come from the catalogs as they are now; what is gone since reads as such ("ein gelöschtes Label", "einen
 *   früheren Typ"). A state names itself from the event's snapshot (`states`, so a renamed or removed state keeps its
 *   name), older events without one from the current workflow, else "einen früheren Status".
 * - A property names itself by its label, a deleted one by its key.
 * - A related item the reader may not see is "verborgenes Item", without key (the server sends nothing of it, P19).
 * - The reason of a change (`meta.reason`) reads as `items.activity.reason.<code>`; a code without text as itself. An
 *   item made from a template names it instead ("Aus Vorlage „:name“", `lineReason`).
 * - A comment's edit reads "einen Kommentar bearbeitet" (its earlier version shows under the line, `earlierVersions`),
 *   its deletion names whose comment it was; several edits of one comment in one line read once. A file of the item's
 *   file list reads by its name: "die Datei „angebot.pdf“ angehängt".
 */

import { Fragment, type ReactNode } from 'react';
import { formatDay, formatPropertyValue } from '@/components/fields/format';
import { ItemKey } from '@/components/items/ItemKey';
import { PRIORITIES, priorityName } from '@/components/ui/PriorityIcon';
import { useWorkItem } from '@/hooks/workItems';
import { hasTranslation, intlLocale, t, tn, tx, type TranslationKey } from '@/lib/i18n';
import type { ItemEvent, Priority, Property, PropertyValue, RelationChange, RichText, User, WorkItemDetail } from '@/types';
import { isGone } from '../shared';

/** What the phrases read their names from. */
export interface PhraseContext {
  detail: WorkItemDetail;
  users: Map<string, User>;
  labelName: (id: string) => string;
  resolutionName: (id: string) => string;
  typeName: (id: string) => string;
  propertyOf: (key: string) => Property | undefined;
  /** The states of the move being read, as the event recorded them (`ItemEvent.states`). */
  states?: ItemEvent['states'];
}

/* ------------------------------------------------------------------------ text */

/** "A", "A und B", "A, B und C" in the language of the page. */
export function joined(parts: readonly ReactNode[]): ReactNode {
  const list = new Intl.ListFormat(intlLocale(), { type: 'conjunction' });
  return list
    .formatToParts(parts.map((_, index) => String(index)))
    .map((part, index) => <Fragment key={index}>{part.type === 'element' ? parts[Number(part.value)] : part.value}</Fragment>);
}

/** Why it happened: the text of a known reason, any other code as it came. */
export function reasonText(code: string): string {
  const key = `items.activity.reason.${code}`;
  return hasTranslation(key) ? t(key) : code;
}

/**
 * What stands under a line: the template an item was made from (`ItemEvent.template`, by a run or by hand), else the
 * reason of the line; nothing without either.
 */
export function lineReason(line: { reason: string | null; events: readonly ItemEvent[] }): string | null {
  const template = line.events.find((event) => event.template)?.template;
  if (template) return t('items.activity.from_template', { name: template.name });
  return line.reason ? reasonText(line.reason) : null;
}

/** A value in a history line. */
function V({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}

/**
 * Another item of the same project by id (a parent): its key, "ein gelöschtes Item" once it is gone, and "ein Item"
 * when it could not be loaded (a 5xx): the line stays readable instead of "…" for good.
 */
function ItemRef({ id, detail }: { id: string; detail: WorkItemDetail }) {
  const known = detail.item.parent?.id === id ? detail.item.parent : null;
  const loaded = useWorkItem(known ? null : id);
  const key = known?.key ?? loaded.data?.item.key;
  if (key) return <ItemKey value={key} className="text-ink" />;
  if (loaded.error) return <V>{isGone(loaded.error) ? t('items.activity.unknown.item') : t('items.activity.unknown.item_unloaded')}</V>;
  return <V>…</V>;
}

/* --------------------------------------------------------------------- phrases */

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
const userName = (ctx: PhraseContext, id: unknown) =>
  typeof id === 'string' ? (ctx.users.get(id)?.name ?? t('items.fields.property.unknown_person')) : t('items.fields.property.nobody_text');
const stateName = (ctx: PhraseContext, side: 'old' | 'new', id: unknown) =>
  ctx.states?.[side].name ?? ctx.detail.workflow.states.find((state) => state.id === id)?.name ?? t('items.activity.unknown.state');
const priority = (value: unknown) => (PRIORITIES.includes(value as Priority) ? priorityName(value as Priority) : String(value));

/** A change from nothing, to nothing, or from one value to another: the three phrases of a field. */
function setChangedRemoved(
  change: { old: unknown; new: unknown },
  keys: { set: TranslationKey; changed: TranslationKey; removed: TranslationKey },
  show: (value: unknown) => ReactNode,
): ReactNode {
  if (isEmpty(change.old)) return tx(keys.set, { new: <V>{show(change.new)}</V> });
  if (isEmpty(change.new)) return tx(keys.removed, { old: <V>{show(change.old)}</V> });
  return tx(keys.changed, { old: <V>{show(change.old)}</V>, new: <V>{show(change.new)}</V> });
}

/** The labels a change added or removed: "das Label Frontend hinzugefügt", "die Labels A und B entfernt". */
function labelPhrases(change: { old: unknown; new: unknown }, ctx: PhraseContext): ReactNode | null {
  const was = (change.old as string[] | null) ?? [];
  const now = (change.new as string[] | null) ?? [];
  const list = (ids: string[], base: 'added' | 'removed') =>
    tx(`items.activity.field.labels.${base}.${ids.length === 1 ? 'one' : 'other'}`, { labels: joined(ids.map((id) => <V key={id}>{ctx.labelName(id)}</V>)) });
  const added = now.filter((id) => !was.includes(id));
  const removed = was.filter((id) => !now.includes(id));
  const parts = [...(added.length ? [list(added, 'added')] : []), ...(removed.length ? [list(removed, 'removed')] : [])];
  return parts.length ? joined(parts) : null;
}

const ULID = /^[0-9a-hjkmnp-tv-z]{26}$/i;

/**
 * A value of a property that is gone: text and numbers as they were; the ids of options or people say nothing
 * anymore and read as "ein Wert" or "2 Werte".
 */
function rawValue(value: unknown): string {
  const list = Array.isArray(value) ? value : [value];
  if (list.length > 0 && list.every((entry) => typeof entry === 'string' && ULID.test(entry))) return tn('items.activity.unknown.values', list.length);
  return list.map(String).join(', ');
}

/** A property value as it reads; a deleted property shows the raw value (ids as their number). */
function valuePhrase(key: string, change: { old: unknown; new: unknown }, ctx: PhraseContext): ReactNode {
  const property = ctx.propertyOf(key);
  const label = <V>{property?.label ?? key}</V>;
  if (property?.field_type === 'rich_text') return tx('items.activity.field.value.edited', { property: label });
  const show = (value: unknown) => (property ? formatPropertyValue(property, value as PropertyValue, (id) => userName(ctx, id)) : rawValue(value));
  if (isEmpty(change.old)) return tx('items.activity.field.value.set', { property: label, new: <V>{show(change.new)}</V> });
  if (isEmpty(change.new)) return tx('items.activity.field.value.cleared', { property: label });
  return tx('items.activity.field.value.changed', { property: label, old: <V>{show(change.old)}</V>, new: <V>{show(change.new)}</V> });
}

/** What one changed field reads as: "die Priorität von High auf Urgent geändert"; `null` for what is no history (`rank`). */
export function fieldPhrase(field: string, change: { old: unknown; new: unknown }, ctx: PhraseContext): ReactNode | null {
  switch (field) {
    case 'state_id':
      return tx('items.activity.field.state', { old: <V>{stateName(ctx, 'old', change.old)}</V>, new: <V>{stateName(ctx, 'new', change.new)}</V> });
    case 'resolution_id':
      return setChangedRemoved(
        change,
        { set: 'items.activity.field.resolution.set', changed: 'items.activity.field.resolution.changed', removed: 'items.activity.field.resolution.removed' },
        (id) => ctx.resolutionName(String(id)),
      );
    case 'assignee_id':
      return setChangedRemoved(
        change,
        { set: 'items.activity.field.assignee.set', changed: 'items.activity.field.assignee.changed', removed: 'items.activity.field.assignee.removed' },
        (id) => userName(ctx, id),
      );
    case 'title':
      return tx('items.activity.field.title', { old: <V>{String(change.old)}</V>, new: <V>{String(change.new)}</V> });
    case 'priority':
      return tx('items.activity.field.priority', { old: <V>{priority(change.old)}</V>, new: <V>{priority(change.new)}</V> });
    case 'label_ids':
      return labelPhrases(change, ctx);
    case 'start_date':
      return setChangedRemoved(
        change,
        { set: 'items.activity.field.start_date.set', changed: 'items.activity.field.start_date.moved', removed: 'items.activity.field.start_date.removed' },
        (day) => formatDay(String(day)),
      );
    case 'due_date':
      return setChangedRemoved(
        change,
        { set: 'items.activity.field.due_date.set', changed: 'items.activity.field.due_date.moved', removed: 'items.activity.field.due_date.removed' },
        (day) => formatDay(String(day)),
      );
    case 'parent_id':
      if (isEmpty(change.old)) return tx('items.activity.field.parent.set', { new: <ItemRef id={String(change.new)} detail={ctx.detail} /> });
      if (isEmpty(change.new)) return tx('items.activity.field.parent.removed', { old: <ItemRef id={String(change.old)} detail={ctx.detail} /> });
      return tx('items.activity.field.parent.changed', {
        old: <ItemRef id={String(change.old)} detail={ctx.detail} />,
        new: <ItemRef id={String(change.new)} detail={ctx.detail} />,
      });
    case 'type_id':
      return tx('items.activity.field.type', { old: <V>{ctx.typeName(String(change.old))}</V>, new: <V>{ctx.typeName(String(change.new))}</V> });
    case 'description':
      return t('items.activity.field.description');
    case 'attachments': {
      const file = (change.new ?? change.old) as { filename?: string } | null;
      return tx(change.new ? 'items.activity.field.attachment.added' : 'items.activity.field.attachment.removed', { name: <V>{file?.filename ?? ''}</V> });
    }
    case 'archived_at':
      return t(change.new ? 'items.activity.archived' : 'items.activity.restored');
    default:
      return field.startsWith('values.') ? valuePhrase(field.slice('values.'.length), change, ctx) : null;
  }
}

/** The order of the phrases within an event; property values follow in the order of their keys. */
export const FIELD_ORDER = [
  'state_id',
  'resolution_id',
  'assignee_id',
  'title',
  'priority',
  'label_ids',
  'start_date',
  'due_date',
  'parent_id',
  'type_id',
  'description',
  'attachments',
  'archived_at',
];

const fieldRank = (field: string) => {
  const index = FIELD_ORDER.indexOf(field);
  return index === -1 ? FIELD_ORDER.length : index;
};

/** What one event reads as, after "<Name> hat": one phrase per change. */
export function phrasesOf(event: ItemEvent, ctx: PhraseContext): ReactNode[] {
  switch (event.type) {
    case 'work_item.created':
      return [t('items.activity.created')];
    case 'work_item.archived':
      return [t('items.activity.archived')];
    case 'work_item.restored':
      return [t('items.activity.restored')];
    case 'work_item.relation_added':
    case 'work_item.relation_removed': {
      const added = event.type === 'work_item.relation_added';
      const relation = event.changes?.relation;
      const change = (added ? relation?.new : relation?.old) as RelationChange | null | undefined;
      const other = change?.key ? <ItemKey value={change.key} className="text-ink" /> : <V>{t('items.detail.relations.hidden')}</V>;
      const label = <V>{change?.label ?? t('items.detail.relations.related')}</V>;
      return [tx(added ? 'items.activity.relation.added' : 'items.activity.relation.removed', { label, item: other })];
    }
    case 'comment.updated':
      return [t('items.activity.field.comment_updated')];
    case 'comment.deleted':
      return [
        event.comment_author_id === event.actor_id
          ? t('items.activity.field.comment_deleted_own')
          : tx('items.activity.field.comment_deleted', { author: <V>{userName(ctx, event.comment_author_id)}</V> }),
      ];
    default: {
      const own: PhraseContext = { ...ctx, states: event.states };
      const parts = Object.entries(event.changes ?? {})
        .sort(([a], [b]) => fieldRank(a) - fieldRank(b))
        .flatMap(([field, change]) => {
          const phrase = fieldPhrase(field, change, own);
          return phrase === null ? [] : [phrase];
        });
      return parts.length > 0 ? parts : [t('items.activity.changed')];
    }
  }
}

/** The edits of one comment in one line read once: the second edit of a comment says nothing new. */
function isRepeatedEdit(event: ItemEvent, index: number, events: readonly ItemEvent[]): boolean {
  return event.type === 'comment.updated' && events.slice(0, index).some((earlier) => earlier.type === 'comment.updated' && earlier.comment_id === event.comment_id);
}

/** What the events of one line read as, after "<Name> hat". */
export function linePhrases(events: readonly ItemEvent[], ctx: PhraseContext): ReactNode[] {
  return events.flatMap((event, index) => (isRepeatedEdit(event, index, events) ? [] : phrasesOf(event, ctx)));
}

/**
 * The texts the comments edited in a line had before it, one per comment: the old text of its first edit there. An
 * edit of a comment that was deleted since carries no text (K15), so it has none.
 */
export function earlierVersions(events: readonly ItemEvent[]): { commentId: string; body: RichText }[] {
  return events.flatMap((event, index) => {
    const old = event.changes?.body?.old as RichText | null | undefined;
    if (event.type !== 'comment.updated' || !old || isRepeatedEdit(event, index, events)) return [];
    return [{ commentId: event.comment_id ?? event.id, body: old }];
  });
}
