import { describe, expect, it } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { makeNotification } from '@/test/fixtures';
import type { Notification } from '@/types';
import { changedFields, groupNotifications, opensElsewhere, timeAgo } from './notifications';
import { hrefOf } from './NotificationRow';

// Ported from the clickdummy's features/inbox/notifications.test.ts; the texts come from lang/*.json.

function notification(id: string, fields: Partial<Notification> = {}): Notification {
  return makeNotification({ id, event: 'comment', project_id: 'p_web', work_item_id: 'wi_web_42', created_at: '2026-10-28T07:00:00.000Z', ...fields });
}

describe('groupNotifications', () => {
  it('gathers the notifications of one item in one group, in the order of the newest, newest first inside', () => {
    // as the API sends them: newest first
    const list = [
      notification('n1', { work_item_id: 'wi_web_42' }),
      notification('n2', { work_item_id: 'wi_app_15' }),
      notification('n3', { work_item_id: 'wi_web_42' }),
      notification('n4', { work_item_id: 'wi_web_47' }),
    ];

    const groups = groupNotifications(list);

    expect(groups.map((group) => [group.itemId, group.notifications.map((entry) => entry.id)])).toEqual([
      ['wi_web_42', ['n1', 'n3']],
      ['wi_app_15', ['n2']],
      ['wi_web_47', ['n4']],
    ]);
  });

  it('puts what belongs to no item into a group of its project, or of the organisation', () => {
    const list = [
      notification('n1', { event: 'webhook_disabled', work_item_id: null, project_id: null }),
      notification('n2', { event: 'template_run_failed', work_item_id: null, project_id: 'p_ops' }),
      notification('n3', { event: 'template_run_failed', work_item_id: null, project_id: 'p_ops' }),
    ];

    const groups = groupNotifications(list);

    expect(groups.map((group) => [group.key, group.itemId, group.projectId, group.notifications.length])).toEqual([
      ['org', null, null, 1],
      ['project:p_ops', null, 'p_ops', 2],
    ]);
  });

  it('keeps the project of an item group, for the card of an item that is no longer available', () => {
    const [group] = groupNotifications([notification('n1', { work_item_id: 'wi_gone', project_id: 'p_ops', item: null })]);

    expect([group!.key, group!.itemId, group!.projectId]).toEqual(['item:wi_gone', 'wi_gone', 'p_ops']);
  });

  it('answers no groups for no notifications', () => {
    expect(groupNotifications([])).toEqual([]);
  });
});

describe('opensElsewhere', () => {
  const click = (keys: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>>) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...keys });

  it('takes a click with ⌘, Ctrl or ⇧ for a new tab or window', () => {
    expect(opensElsewhere(click({ metaKey: true }))).toBe(true);
    expect(opensElsewhere(click({ ctrlKey: true }))).toBe(true);
    expect(opensElsewhere(click({ shiftKey: true }))).toBe(true);
  });

  it('leaves a plain click and one with Alt (which saves the link) to the screen', () => {
    expect(opensElsewhere(click({}))).toBe(false);
    expect(opensElsewhere(click({ altKey: true }))).toBe(false);
    expect(opensElsewhere(click({ metaKey: true, altKey: true }))).toBe(false);
  });
});

describe('timeAgo', () => {
  const at = new Date('2026-10-28T09:00:00.000Z'); // 10:00 in Berlin
  const ago = (iso: string, timeZone = 'Europe/Berlin') => timeAgo(iso, at, timeZone);

  it('says "gerade eben" for the last minute', () => {
    expect(ago('2026-10-28T08:59:40.000Z')).toBe('gerade eben');
  });

  it('counts minutes and full hours of today', () => {
    expect(ago('2026-10-28T08:40:00.000Z')).toBe('vor 20 Min.');
    expect(ago('2026-10-28T06:00:00.000Z')).toBe('vor 3 Std.');
    // two and a half hours are not yet three
    expect(ago('2026-10-28T06:30:00.000Z')).toBe('vor 2 Std.');
  });

  it('names yesterday with the time of day in the time zone of the organisation', () => {
    // 15:10 UTC is 16:10 in Berlin
    expect(ago('2026-10-27T15:10:00.000Z')).toBe('gestern, 16:10');
  });

  it('gives the day for everything older', () => {
    expect(ago('2026-10-23T13:10:00.000Z')).toBe('23.10.');
  });

  it('reads the calendar day in the time zone, not in UTC', () => {
    // 23:30 UTC on the 26th is 00:30 on the 27th in Berlin: yesterday for a viewer at 10:00 on the 28th
    expect(ago('2026-10-26T23:30:00.000Z')).toBe('gestern, 00:30');
    // in New York it is still the evening of the 26th, two days before the 28th
    expect(ago('2026-10-26T23:30:00.000Z', 'America/New_York')).toBe('26.10.');
  });

  it('counts the hours of today across midnight of the organisation, not of UTC', () => {
    // 22:30 UTC on the 27th is 07:30 on the 28th in Tokyo, where it is 18:00 now: today, ten and a half hours ago
    expect(ago('2026-10-27T22:30:00.000Z', 'Asia/Tokyo')).toBe('vor 10 Std.');
  });

  it('speaks the language of the page', () => {
    initI18n({ locale: 'en', translations: en });

    expect(ago('2026-10-28T08:59:40.000Z')).toBe('just now');
    expect(ago('2026-10-28T08:40:00.000Z')).toBe('20 min ago');
    expect(ago('2026-10-27T15:10:00.000Z')).toBe('yesterday, 16:10');
    expect(ago('2026-10-23T13:10:00.000Z')).toBe('23/10');
  });
});

describe('changedFields', () => {
  const propertyLabel = (key: string) => ({ customer: 'Kunde', effort: 'Aufwand (h)' })[key];

  it('names the fields the way the item shows them and joins them with "und"', () => {
    expect(changedFields(['priority'], propertyLabel)).toBe('Priorität');
    expect(changedFields(['title', 'due_date'], propertyLabel)).toBe('Titel und Due-Date');
    expect(changedFields(['label_ids', 'start_date', 'parent_id'], propertyLabel)).toBe('Labels, Start-Date und Eltern-Item');
  });

  it('names the type, the resolution, the relations and the files, the other changes the API tells about', () => {
    expect(changedFields(['type_id', 'values.customer'], propertyLabel)).toBe('Typ und Kunde');
    expect(changedFields(['description', 'resolution_id'], propertyLabel)).toBe('Beschreibung und Resolution');
    expect(changedFields(['relation'], propertyLabel)).toBe('Relationen');
    expect(changedFields(['attachment'], propertyLabel)).toBe('Dateien');
  });

  it('takes the label of a property for values.<key>', () => {
    expect(changedFields(['values.customer'], propertyLabel)).toBe('Kunde');
  });

  it('says "Felder" for what it does not know and for nothing at all', () => {
    expect(changedFields(['values.gone', 'archived_at'], propertyLabel)).toBe('Felder');
    expect(changedFields([], propertyLabel)).toBe('Felder');
  });

  it('names each field once', () => {
    expect(changedFields(['values.customer', 'values.customer', 'priority'], propertyLabel)).toBe('Kunde und Priorität');
  });

  it('speaks the language of the page', () => {
    initI18n({ locale: 'en', translations: en });

    expect(changedFields(['title', 'due_date', 'values.customer'], propertyLabel)).toBe('title, due date and Kunde');
  });

  it('names every field in lower case mid-sentence in English, as "changed :fields" reads', () => {
    initI18n({ locale: 'en', translations: en });

    expect(changedFields(['priority', 'label_ids', 'start_date', 'assignee_id'], propertyLabel)).toBe('priority, labels, start date and assignee');
    expect(changedFields(['description', 'parent_id', 'type_id', 'resolution_id'], propertyLabel)).toBe('description, parent, type and resolution');
    expect(changedFields(['relation', 'attachment'], propertyLabel)).toBe('relations and files');
  });
});

describe('hrefOf', () => {
  it('leads a switched-off webhook to its log, without one to the webhooks of the settings', () => {
    expect(hrefOf(notification('n1', { event: 'webhook_disabled', work_item_id: null, project_id: null, data: { webhook_id: 'wh_crm' } }), undefined)).toBe(
      '/settings/webhooks?deliveries=wh_crm',
    );
    expect(hrefOf(notification('n2', { event: 'webhook_disabled', work_item_id: null, project_id: null, data: {} }), undefined)).toBe('/settings/webhooks');
  });

  it('leads a kind without an item it does not know to the settings, never to the webhooks (T14-M7)', () => {
    expect(hrefOf(notification('n1', { event: 'item_changed', work_item_id: null, project_id: null, data: {} }), undefined)).toBe('/settings');
  });
});
