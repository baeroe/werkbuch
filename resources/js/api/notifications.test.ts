import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, maraInbox } from '@/test/fixtures';
import type { NotificationPreference } from '@/types';
import {
  deleteNotification,
  getPreferences,
  listNotifications,
  MARK_MAX,
  markAllRead,
  markRead,
  markUnread,
  NOTIFICATION_EVENTS,
  savePreferences,
} from './notifications';

let api: MockApi;

afterEach(() => api.restore());

const ids = (count: number) => Array.from({ length: count }, (_, index) => `n_${index}`);

describe('the inbox', () => {
  it('lists a page of the own notifications, sending its filters as 1 and 0', async () => {
    api = mockApi({ 'GET /api/v1/notifications': () => ({ body: { data: maraInbox.slice(0, 2), links: {}, meta: { next_cursor: 'c2', total: 14 } } }) });

    expect(await listNotifications()).toEqual({ items: maraInbox.slice(0, 2), next_cursor: 'c2', total: 14 });
    await listNotifications({ unread_only: true, mentions_only: false, cursor: 'c2', per_page: 1 });
    expect(api.calls.map((call) => call.url)).toEqual([
      '/api/v1/notifications',
      // Laravel's `boolean` takes 1 and 0, never "true"
      '/api/v1/notifications?unread_only=1&mentions_only=0&cursor=c2&per_page=1',
    ]);
  });

  it('marks notifications read and unread by id, and answers how many changed', async () => {
    api = mockApi({
      'POST /api/v1/notifications/read': () => ({ body: { updated: 2 } }),
      'POST /api/v1/notifications/unread': () => ({ body: { updated: 1 } }),
    });

    expect(await markRead(['n_01', 'n_03'])).toEqual({ updated: 2 });
    expect(await markUnread(['n_02'])).toEqual({ updated: 1 });
    expect(api.calls).toEqual([
      { method: 'POST', url: '/api/v1/notifications/read', body: { ids: ['n_01', 'n_03'] } },
      { method: 'POST', url: '/api/v1/notifications/unread', body: { ids: ['n_02'] } },
    ]);
  });

  it('marks more than the server takes in one call in blocks, and adds up what changed', async () => {
    api = mockApi({ 'POST /api/v1/notifications/read': (body) => ({ body: { updated: (body as { ids: string[] }).ids.length } }) });

    expect(await markRead(ids(MARK_MAX * 2 + 1))).toEqual({ updated: MARK_MAX * 2 + 1 });
    expect(api.calls.map((call) => (call.body as { ids: string[] }).ids.length)).toEqual([MARK_MAX, MARK_MAX, 1]);
  });

  it('asks nothing for no ids, like the clickdummy that marks none', async () => {
    api = mockApi({});

    expect(await markRead([])).toEqual({ updated: 0 });
    expect(await markUnread([])).toEqual({ updated: 0 });
    expect(api.calls).toEqual([]);
  });

  it('marks every unread notification read, or every unread mention (A291)', async () => {
    api = mockApi({ 'POST /api/v1/notifications/read': () => ({ body: { updated: 3 } }) });

    expect(await markAllRead()).toEqual({ updated: 3 });
    await markAllRead({ mentions_only: true });
    expect(api.calls.map((call) => call.body)).toEqual([{ all: true }, { all: true, mentions_only: true }]);
  });

  it('deletes a notification', async () => {
    api = mockApi({ 'DELETE /api/v1/notifications/n_01': () => ({ status: 204 }) });

    expect(await deleteNotification('n_01')).toBeUndefined();
    expect(api.calls).toEqual([{ method: 'DELETE', url: '/api/v1/notifications/n_01', body: undefined }]);
  });
});

describe('the notification settings', () => {
  const matrix: NotificationPreference[] = NOTIFICATION_EVENTS.flatMap((event) =>
    (['inbox', 'mail'] as const).map((channel) => ({ user_id: 'u_mara', event, channel, enabled: channel === 'inbox' })),
  );

  it('offers the kinds in the order of the clickdummy and the server', () => {
    expect(NOTIFICATION_EVENTS).toEqual([
      'assigned',
      'mentioned',
      'comment',
      'state_changed',
      'item_changed',
      'due',
      'item_created',
      'template_run_failed',
      'webhook_disabled',
    ]);
  });

  it('reads the whole matrix and saves choices, answering the matrix', async () => {
    const choice: NotificationPreference = { user_id: 'u_mara', event: 'state_changed', channel: 'mail', enabled: true };
    api = mockApi({
      'GET /api/v1/notification-preferences': () => ({ body: list(matrix) }),
      'PUT /api/v1/notification-preferences': () => ({ body: { data: matrix } }),
    });

    expect(await getPreferences()).toEqual(matrix);
    expect(await savePreferences([choice])).toEqual(matrix);
    expect(api.calls).toEqual([
      { method: 'GET', url: '/api/v1/notification-preferences', body: undefined },
      { method: 'PUT', url: '/api/v1/notification-preferences', body: { preferences: [choice] } },
    ]);
  });
});
