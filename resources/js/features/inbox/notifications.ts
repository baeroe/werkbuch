/*
 * What the inbox works out from the notifications before it draws them (ported from the clickdummy's
 * features/inbox/notifications.ts): the groups (one per item), how long ago a notification happened, the names of the
 * fields an `item_changed` notification lists, and which clicks open a page elsewhere. The texts come from lang/*.json,
 * dates and lists from Intl in the language of the page.
 */

import { formatShortDay } from '@/components/fields/format';
import { cachedZone, diffDays } from '@/domain/tz';
import { intlLocale, t, type TranslationKey } from '@/lib/i18n';
import type { Notification } from '@/types';

/* ----------------------------------------------------------------------- groups */

export interface NotificationGroup {
  /** `item:<id>`, `project:<id>` for what belongs to a project but to no item, `org` for the rest. */
  key: string;
  itemId: string | null;
  /** The project of the group; for an item, the project of its notifications (the card of an item no longer there names it). */
  projectId: string | null;
  /** Newest first. */
  notifications: Notification[];
}

/**
 * Groups by item (spec 4.14). The groups are in the order of their newest notification and the notifications inside
 * keep their order, so a list the API sends newest first stays newest first. A notification without an item
 * (a failed template run, a switched-off webhook) goes into the group of its project, or of the organisation.
 */
export function groupNotifications(list: readonly Notification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const notification of list) {
    const itemId = notification.work_item_id;
    const projectId = notification.project_id;
    const key = itemId ? `item:${itemId}` : projectId ? `project:${projectId}` : 'org';
    const group = groups.get(key) ?? { key, itemId, projectId, notifications: [] };
    group.notifications.push(notification);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/* ---------------------------------------------------------------------- clicks */

/**
 * Whether the browser turns a click on a link into a new tab or window (⌘ or Ctrl, ⇧), which opens the notification
 * as well. Alt saves the link instead: nothing opens. Safari adds a ⇧-clicked link to the Reading List and opens
 * nothing either; it still counts as opened here, and u takes it back.
 */
export function opensElsewhere(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (event.metaKey || event.ctrlKey || event.shiftKey) && !event.altKey;
}

/* ------------------------------------------------------------------------ time */

const relatives = new Map<string, Intl.RelativeTimeFormat>();
const clocks = new Map<string, Intl.DateTimeFormat>();

function relativeFormat(): Intl.RelativeTimeFormat {
  const locale = intlLocale();
  let format = relatives.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    relatives.set(locale, format);
  }
  return format;
}

function clockOf(timeZone: string): Intl.DateTimeFormat {
  const key = `${intlLocale()}:${timeZone}`;
  let format = clocks.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
    clocks.set(key, format);
  }
  return format;
}

/**
 * How long ago, the way a list says it: "gerade eben", "vor 20 Min.", "vor 3 Std.", "gestern, 16:10", then the day
 * ("23.10."). Days are the calendar days of the organisation's time zone, not of UTC.
 */
export function timeAgo(iso: string, at: Date, timeZone: string): string {
  const then = new Date(iso);
  const seconds = Math.floor((at.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return t('inbox.time.now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relativeFormat().format(-minutes, 'minute');

  const zone = cachedZone(timeZone);
  const days = diffDays(zone.date(then), zone.date(at));
  if (days <= 0) return relativeFormat().format(-Math.floor(minutes / 60), 'hour');
  if (days === 1) return t('inbox.time.yesterday', { time: clockOf(timeZone).format(then) });
  return formatShortDay(zone.date(then));
}

/* ---------------------------------------------------------------------- fields */

/** The fields an `item_changed` notification can list (`EventFacts::fieldsOf`), by the names the item shows them with. */
const FIELD_NAMES: Record<string, TranslationKey> = {
  title: 'inbox.field.title',
  description: 'inbox.field.description',
  priority: 'items.fields.row.priority',
  label_ids: 'items.fields.row.labels',
  start_date: 'items.fields.row.start_date',
  due_date: 'items.fields.row.due_date',
  assignee_id: 'items.fields.row.assignee',
  parent_id: 'inbox.field.parent_id',
  type_id: 'inbox.field.type_id',
  resolution_id: 'inbox.field.resolution_id',
  relation: 'inbox.field.relation',
  attachment: 'inbox.field.attachment',
};

/**
 * The fields of an `item_changed` notification as one phrase: "Priorität", "Titel und Due-Date". `values.<key>` is a
 * property and takes its label; what is unknown, or nothing at all, is "Felder".
 */
export function changedFields(fields: readonly string[], propertyLabel: (key: string) => string | undefined): string {
  const names = fields.flatMap((field) => {
    const known = Object.hasOwn(FIELD_NAMES, field) ? t(FIELD_NAMES[field]!) : undefined;
    const name = field.startsWith('values.') ? propertyLabel(field.slice('values.'.length)) : known;
    return name ? [name] : [];
  });
  const unique = [...new Set(names)];
  return unique.length > 0 ? new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' }).format(unique) : t('inbox.field.fallback');
}
