import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { mockApi, type MockApi } from '@/test/api';
import { list, makeDelivery, makeWebhook } from '@/test/fixtures';
import { deleteWebhook, listDeliveries, listWebhooks, pingWebhook, redeliver, rotateWebhookSecret, saveWebhook, type WebhookInput } from './webhooks';

let api: MockApi;

afterEach(() => api.restore());

const webhook = makeWebhook();
const input: WebhookInput = { name: webhook.name, url: webhook.url, project_id: null, events: ['work_item.*'], bot_id: null, active: true };

describe('webhooks', () => {
  it('lists every webhook across pages', async () => {
    const second = makeWebhook({ id: 'wh_2', name: 'Zweiter' });
    api = mockApi({
      'GET /api/v1/webhooks': (_body, url) =>
        url.searchParams.get('cursor') === 'next' ? { body: list([second], 2) } : { body: { data: [webhook], links: {}, meta: { next_cursor: 'next', total: 2 } } },
    });

    expect(await listWebhooks()).toEqual({ items: [webhook, second], next_cursor: null, total: 2 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/webhooks', '/api/v1/webhooks?cursor=next']);
  });

  it('creates a webhook with its secret and replaces one without', async () => {
    api = mockApi({
      'POST /api/v1/webhooks': () => ({ status: 201, body: { data: webhook, secret: 'whsec_neu' } }),
      'PUT /api/v1/webhooks/wh_1': () => ({ body: { data: webhook } }),
    });

    expect(await saveWebhook(input)).toEqual({ webhook, secret: 'whsec_neu' });
    expect(await saveWebhook({ ...input, id: 'wh_1' })).toEqual({ webhook, secret: null });
    expect(api.calls).toEqual([
      { method: 'POST', url: '/api/v1/webhooks', body: input },
      { method: 'PUT', url: '/api/v1/webhooks/wh_1', body: input },
    ]);
  });

  it('renews the secret and deletes a webhook', async () => {
    api = mockApi({
      'POST /api/v1/webhooks/wh_1/rotate-secret': () => ({ body: { data: webhook, secret: 'whsec_rotiert' } }),
      'DELETE /api/v1/webhooks/wh_1': () => ({ status: 204 }),
    });

    expect(await rotateWebhookSecret('wh_1')).toEqual({ webhook, secret: 'whsec_rotiert' });
    await expect(deleteWebhook('wh_1')).resolves.toBeUndefined();
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/webhooks/wh_1/rotate-secret', 'DELETE /api/v1/webhooks/wh_1']);
  });

  it('lists the attempts of a webhook, pings it and sends a delivery again', async () => {
    const attempt = makeDelivery();
    const again = makeDelivery({ id: 'at_2', attempt: 3, kind: 'manual' });
    api = mockApi({
      'GET /api/v1/webhooks/wh_1/deliveries': () => ({ body: list([attempt]) }),
      'POST /api/v1/webhooks/wh_1/ping': () => ({ body: { data: makeDelivery({ kind: 'ping', event: 'ping' }) } }),
      'POST /api/v1/webhooks/wh_1/deliveries/dl_1/redeliver': () => ({ body: { data: again } }),
    });

    expect(await listDeliveries('wh_1', { per_page: 20 })).toEqual({ items: [attempt], next_cursor: null, total: 1 });
    expect((await pingWebhook('wh_1')).kind).toBe('ping');
    expect(await redeliver('wh_1', 'dl_1')).toEqual(again);
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/webhooks/wh_1/deliveries?per_page=20', '/api/v1/webhooks/wh_1/ping', '/api/v1/webhooks/wh_1/deliveries/dl_1/redeliver']);
  });

  it('turns a refusal into an ApiError', async () => {
    api = mockApi({ 'GET /api/v1/webhooks': () => ({ status: 403, body: { type: 'about:blank', title: 'Forbidden', status: 403, reason: 'forbidden', detail: 'Webhooks verwalten nur Org-Admins.' } }) });

    await expect(listWebhooks()).rejects.toMatchObject({ status: 403, reason: 'forbidden' });
    await expect(listWebhooks()).rejects.toBeInstanceOf(ApiError);
  });
});
