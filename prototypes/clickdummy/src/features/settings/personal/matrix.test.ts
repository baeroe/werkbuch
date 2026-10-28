import { beforeEach, describe, expect, it } from 'vitest';
import { getPreferences } from '@/api/notifications';
import type { NotificationChannel, NotificationEvent } from '@/types';
import { asUser, resetApi } from '@/test/api';
import { cellKey, changedPreferences, defaultEnabled, toChoices } from './matrix';

beforeEach(resetApi);

const EVENTS: NotificationEvent[] = ['assigned', 'mentioned', 'comment', 'state_changed', 'item_changed', 'due', 'item_created', 'template_run_failed', 'webhook_disabled'];
const CHANNELS: NotificationChannel[] = ['inbox', 'mail'];

describe('defaultEnabled (spec 4.14)', () => {
  it('has the inbox on for every event', () => {
    for (const event of EVENTS) expect(defaultEnabled(event, 'inbox')).toBe(true);
  });

  it('has mail on for assigned, mentioned, comment and due, and off for the rest', () => {
    const mailOn = EVENTS.filter((event) => defaultEnabled(event, 'mail'));
    expect(mailOn).toEqual(['assigned', 'mentioned', 'comment', 'due']);
  });

  it('is what the server answers for somebody who never chose anything', async () => {
    asUser('u_theo');
    const matrix = await getPreferences();

    expect(matrix).toHaveLength(EVENTS.length * CHANNELS.length);
    for (const row of matrix) expect(row.enabled, cellKey(row.event, row.channel)).toBe(defaultEnabled(row.event, row.channel));
  });
});

describe('changedPreferences', () => {
  it('lists only the cells that differ from what is saved', async () => {
    const saved = toChoices(await getPreferences());
    const draft = { ...saved, [cellKey('comment', 'mail')]: false, [cellKey('item_changed', 'mail')]: true };

    expect(changedPreferences('u_mara', saved, draft)).toEqual([
      { user_id: 'u_mara', event: 'comment', channel: 'mail', enabled: false },
      { user_id: 'u_mara', event: 'item_changed', channel: 'mail', enabled: true },
    ]);
  });

  it('lists nothing when nothing differs', async () => {
    const saved = toChoices(await getPreferences());
    expect(changedPreferences('u_mara', saved, { ...saved })).toEqual([]);
  });
});
