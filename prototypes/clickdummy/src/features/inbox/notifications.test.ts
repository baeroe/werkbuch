import { describe, expect, it } from 'vitest';
import type { Notification } from '@/types';
import { changedFields, groupNotifications, timeAgo } from './notifications';

function notification(id: string, fields: Partial<Notification> = {}): Notification {
  return {
    id,
    user_id: 'u_mara',
    event_id: null,
    event: 'comment',
    project_id: 'p_web',
    work_item_id: 'wi_web_42',
    actor_id: 'u_ida',
    data: {},
    read_at: null,
    mailed_at: null,
    created_at: '2026-10-28T07:00:00.000Z',
    ...fields,
  };
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

  it('answers no groups for no notifications', () => {
    expect(groupNotifications([])).toEqual([]);
  });
});

describe('timeAgo', () => {
  const at = new Date('2026-10-28T09:00:00.000Z'); // 10:00 in Berlin
  const ago = (iso: string) => timeAgo(iso, at, 'Europe/Berlin');

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
  });
});

describe('changedFields', () => {
  const propertyLabel = (key: string) => ({ customer: 'Kunde', effort: 'Aufwand (h)' })[key];

  it('names the fields the way the item shows them and joins them with "und"', () => {
    expect(changedFields(['priority'], propertyLabel)).toBe('Priorität');
    expect(changedFields(['title', 'due_date'], propertyLabel)).toBe('Titel und Due-Date');
    expect(changedFields(['label_ids', 'start_date', 'parent_id'], propertyLabel)).toBe('Labels, Start-Date und Eltern-Item');
  });

  it('takes the label of a property for values.<key>', () => {
    expect(changedFields(['values.customer'], propertyLabel)).toBe('Kunde');
  });

  it('says "Felder" for what it does not know and for nothing at all', () => {
    expect(changedFields(['values.gone'], propertyLabel)).toBe('Felder');
    expect(changedFields([], propertyLabel)).toBe('Felder');
  });

  it('names each field once', () => {
    expect(changedFields(['values.customer', 'values.customer', 'priority'], propertyLabel)).toBe('Kunde und Priorität');
  });
});
