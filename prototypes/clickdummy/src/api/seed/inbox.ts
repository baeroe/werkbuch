/*
 * Seed: Mara's inbox (14 notifications, 3 of them unread), the three webhooks with their deliveries, and the state of
 * the system (queue, failed jobs, search, mail).
 */

import { plainText } from '@/lib/richtext';
import type { Notification, NotificationData, NotificationEvent, SystemStatus, WebhookDelivery } from '@/types';
import type { StoredWebhook } from '../db';
import { comments } from './activity';
import { at, USER_IDS, type UserShort } from './helpers';
import { itemId } from './items';

/* --------------------------------------------------------------- notifications */

const excerpt = (commentId: string) => plainText(comments.find((entry) => entry.id === commentId)!.body);

interface NotificationRow {
  id: string;
  event: NotificationEvent;
  /** The item key; the project follows from it. */
  item?: string;
  /** Without an item: the project. */
  project?: string | null;
  actor?: UserShort;
  data?: NotificationData;
  created: string;
  /** When Mara read it; unread when omitted. */
  read?: string;
  eventId?: string;
}

const PROJECT_OF: Record<string, string> = { WEB: 'p_web', APP: 'p_app', OPS: 'p_ops' };

const rows: NotificationRow[] = [
  // unread
  { id: 'n_01', event: 'mentioned', item: 'WEB-42', actor: 'ida', data: { excerpt: excerpt('c_web42_1'), comment_id: 'c_web42_1' }, created: '10-28 08:40' },
  { id: 'n_03', event: 'comment', item: 'APP-15', actor: 'theo', data: { excerpt: excerpt('c_app15_1'), comment_id: 'c_app15_1' }, created: '10-27 15:10' },
  { id: 'n_04', event: 'assigned', item: 'APP-24', actor: 'theo', created: '10-27 16:05', eventId: 'ev_app24_assigned' },
  // read
  { id: 'n_02', event: 'due', item: 'APP-18', data: { due_date: '2026-10-28' }, created: '10-28 08:00', read: '10-28 08:10' },
  { id: 'n_05', event: 'state_changed', item: 'OPS-11', actor: 'jonas', data: { from_state_id: 'std_progress', to_state_id: 'std_done' }, created: '10-27 14:00', read: '10-27 16:00', eventId: 'ev_ops11_done' },
  { id: 'n_06', event: 'item_changed', item: 'WEB-47', actor: 'ida', data: { fields: ['priority'] }, created: '10-27 10:20', read: '10-27 12:00', eventId: 'ev_web47_priority' },
  { id: 'n_07', event: 'state_changed', item: 'WEB-47', actor: 'jonas', data: { from_state_id: 'std_todo', to_state_id: 'std_progress' }, created: '10-27 09:15', read: '10-27 12:00', eventId: 'ev_web47_started' },
  { id: 'n_08', event: 'comment', item: 'OPS-12', actor: 'jonas', data: { excerpt: excerpt('c_ops12_2'), comment_id: 'c_ops12_2' }, created: '10-26 16:30', read: '10-27 08:30' },
  { id: 'n_09', event: 'mentioned', item: 'OPS-3', actor: 'jonas', data: { excerpt: excerpt('c_ops3_1'), comment_id: 'c_ops3_1' }, created: '10-26 17:00', read: '10-27 08:30' },
  { id: 'n_11', event: 'state_changed', item: 'WEB-40', actor: 'lene', data: { from_state_id: 'std_todo', to_state_id: 'std_done' }, created: '10-23 14:10', read: '10-23 16:00', eventId: 'ev_web40_done' },
  { id: 'n_10', event: 'webhook_disabled', project: null, data: { webhook_id: 'wh_crm' }, created: '10-22 10:00', read: '10-23 09:00' },
  { id: 'n_12', event: 'assigned', item: 'APP-18', actor: 'theo', created: '10-21 11:00', read: '10-21 13:00' },
  { id: 'n_13', event: 'mentioned', item: 'WEB-47', actor: 'ida', data: { excerpt: 'Beim Absenden über Safari kommen zwei Mails an. @mara kannst du prüfen, ob das mit WEB-42 zusammenhängt?' }, created: '10-20 11:30', read: '10-20 15:00', eventId: 'ev_web47_created' },
  {
    id: 'n_14',
    event: 'template_run_failed',
    project: 'p_ops',
    data: { template_id: 'tpl_ops_certs', error: 'Pflicht-Property Umgebung fehlt' },
    created: '10-01 07:00',
    read: '10-02 09:00',
  },
];

export const notifications: Notification[] = rows.map((row): Notification => ({
  id: row.id,
  user_id: USER_IDS.mara,
  event_id: row.eventId ?? null,
  event: row.event,
  project_id: row.item ? PROJECT_OF[row.item.split('-')[0]] : (row.project ?? null),
  work_item_id: row.item ? itemId(row.item) : null,
  actor_id: row.actor ? USER_IDS[row.actor] : null,
  data: row.data ?? {},
  read_at: row.read ? at(row.read) : null,
  mailed_at: null,
  created_at: at(row.created, row.id === 'n_14' ? 5 : 0),
}));

/* -------------------------------------------------------------------- webhooks */

export const webhooks: StoredWebhook[] = [
  {
    id: 'wh_deploy',
    name: 'Deploy-Bot',
    url: 'https://deploy.feldwerk.example.com/hooks/werkbuch',
    project_id: null,
    events: ['work_item.state_changed'],
    bot_id: null,
    active: true,
    disabled_at: null,
    created_at: at('10-02 10:30'),
    secret: 'whsec_demo_deploy_4f8a1c',
  },
  {
    id: 'wh_kira',
    name: 'Kira-Agent',
    url: 'https://agent.feldwerk.example.com/werkbuch/webhook',
    project_id: null,
    events: ['bot.*'],
    bot_id: USER_IDS.kira,
    active: true,
    disabled_at: null,
    created_at: at('10-05 14:35'),
    secret: 'whsec_demo_kira_9b2e77',
  },
  {
    // switched off by the system after 24 hours without a success
    id: 'wh_crm',
    name: 'Altes CRM',
    url: 'https://crm.example.com/api/inbound/werkbuch',
    project_id: 'p_app',
    events: ['work_item.created', 'work_item.updated'],
    bot_id: null,
    active: false,
    disabled_at: '2026-10-22T08:00:30.000Z',
    created_at: at('08-12 09:00'),
    secret: 'whsec_demo_crm_31d0aa',
  },
];

function delivery(
  id: string,
  webhook: string,
  event: string,
  when: string,
  statusCode: number | null,
  durationMs: number,
  options: { attempt?: number; excerpt?: string | null; error?: string | null } = {},
): WebhookDelivery {
  return {
    id,
    webhook_id: webhook,
    event,
    attempt: options.attempt ?? 1,
    status_code: statusCode,
    duration_ms: durationMs,
    response_excerpt: options.excerpt === undefined ? (statusCode === 200 ? '{"ok":true}' : null) : options.excerpt,
    error: options.error ?? null,
    created_at: when.includes('T') ? when : at(when),
  };
}

const TIMEOUT = 'Zeitüberschreitung nach 10 s';

export const webhookDeliveries: WebhookDelivery[] = [
  delivery('dl_d1', 'wh_deploy', 'work_item.state_changed', '10-22 11:05', 200, 142),
  delivery('dl_d2', 'wh_deploy', 'work_item.state_changed', '10-23 14:10', 200, 188),
  delivery('dl_d3', 'wh_deploy', 'work_item.state_changed', '10-26 10:00', 200, 121),
  delivery('dl_d4', 'wh_deploy', 'work_item.state_changed', '10-27 09:15', 200, 305),
  delivery('dl_d5', 'wh_deploy', 'work_item.state_changed', '10-27 14:00', 200, 167),
  delivery('dl_d6', 'wh_deploy', 'work_item.state_changed', '10-27 16:20', 200, 154),

  delivery('dl_k1', 'wh_kira', 'bot.assigned', '10-26 11:20', 200, 233),
  delivery('dl_k2', 'wh_kira', 'bot.mentioned', '10-26 15:30', 200, 198),
  delivery('dl_k3', 'wh_kira', 'bot.assigned', '10-27 09:40', 502, 1204, { excerpt: 'Bad Gateway' }),
  delivery('dl_k4', 'wh_kira', 'bot.assigned', '10-27 09:41', 200, 219, { attempt: 2 }),

  // eight attempts over 24 hours, then the webhook was switched off
  delivery('dl_c1', 'wh_crm', 'work_item.updated', '2026-10-21T08:00:00.000Z', 500, 412, { excerpt: '{"error":"Internal Server Error"}' }),
  delivery('dl_c2', 'wh_crm', 'work_item.updated', '2026-10-21T08:01:00.000Z', 500, 388, { attempt: 2, excerpt: '{"error":"Internal Server Error"}' }),
  delivery('dl_c3', 'wh_crm', 'work_item.updated', '2026-10-21T08:06:00.000Z', null, 10000, { attempt: 3, error: TIMEOUT }),
  delivery('dl_c4', 'wh_crm', 'work_item.updated', '2026-10-21T08:36:00.000Z', 502, 521, { attempt: 4, excerpt: 'Bad Gateway' }),
  delivery('dl_c5', 'wh_crm', 'work_item.updated', '2026-10-21T10:36:00.000Z', null, 10000, { attempt: 5, error: TIMEOUT }),
  delivery('dl_c6', 'wh_crm', 'work_item.updated', '2026-10-21T16:36:00.000Z', 500, 447, { attempt: 6, excerpt: '{"error":"Internal Server Error"}' }),
  delivery('dl_c7', 'wh_crm', 'work_item.updated', '2026-10-22T04:36:00.000Z', null, 10000, { attempt: 7, error: TIMEOUT }),
  delivery('dl_c8', 'wh_crm', 'work_item.updated', '2026-10-22T08:00:00.000Z', 500, 460, { attempt: 8, excerpt: '{"error":"Internal Server Error"}' }),
];

/* ---------------------------------------------------------------------- system */

export const system: SystemStatus = {
  version: '0.1.0-dev',
  queued_jobs: 3,
  failed_jobs: [
    {
      id: 'fj_1',
      queue: 'webhooks',
      job: 'App\\Jobs\\DeliverWebhook',
      error: 'cURL error 28: Operation timed out after 10001 milliseconds',
      failed_at: at('10-22 09:00'),
    },
    {
      id: 'fj_2',
      queue: 'notifications',
      job: 'App\\Jobs\\SendDigestMail',
      error: 'Connection to mail-1.feldwerk.example.com:587 refused',
      failed_at: at('10-26 13:05'),
    },
  ],
  search: 'ok',
  mail_configured: true,
};
