/*
 * The webhook events of spec 6.3 as the form offers them: the groups and their events in the order of the server's
 * catalog (`EventType::webhook()`; events.test.ts holds the two together), and how a stored name reads to a person.
 * `group.*` stands for a whole group, including events added to it later.
 */

import { t, type TranslationKey } from '@/lib/i18n';

export interface EventGroup {
  /** The part before the dot: `work_item`. */
  group: string;
  /** The part after it, in the server's order: `state_changed`. */
  events: readonly string[];
}

export const EVENT_GROUPS: readonly EventGroup[] = [
  { group: 'project', events: ['created', 'updated', 'archived', 'restored', 'deleted', 'member_added', 'member_removed'] },
  { group: 'work_item', events: ['created', 'updated', 'state_changed', 'assigned', 'archived', 'restored', 'deleted', 'relation_added', 'relation_removed'] },
  { group: 'comment', events: ['created', 'updated', 'deleted'] },
  { group: 'page', events: ['created', 'updated', 'moved', 'deleted'] },
  { group: 'bot', events: ['mentioned', 'assigned'] },
  { group: 'template', events: ['run_failed'] },
];

const findGroup = (name: string) => EVENT_GROUPS.find((entry) => entry.group === name);

/** "Work Items": the name of a group. */
export function groupLabel(group: string): string {
  return t(`settings.webhooks.group.${group}` as TranslationKey);
}

/** What a stored event name such as `work_item.*` or `bot.assigned` reads like to a person; unknown ones as stored. */
export function eventLabel(name: string): string {
  // the test ping is no event of the catalog; it only shows up in the log of deliveries
  if (name === 'ping') return t('webhooks.event.ping');
  const [groupName, event] = name.split('.');
  const group = findGroup(groupName);
  if (!group) return name;
  if (event === '*') return t('settings.webhooks.all_events', { group: groupLabel(group.group) });
  return group.events.includes(event) ? t(`webhooks.event.${group.group}_${event}` as TranslationKey) : name;
}
