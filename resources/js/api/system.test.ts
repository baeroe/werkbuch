import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { makeSystemStatus } from '@/test/fixtures';
import { getSystemStatus, retryFailedJobs, sendTestMail } from './system';

let api: MockApi;

afterEach(() => api.restore());

describe('the system page', () => {
  it('reads the status', async () => {
    const status = makeSystemStatus();
    api = mockApi({ 'GET /api/v1/system': () => ({ body: { data: status } }) });

    expect(await getSystemStatus()).toEqual(status);
    expect(api.calls).toEqual([{ method: 'GET', url: '/api/v1/system', body: undefined }]);
  });

  it('retries every failed job, or the ones named, and answers how many went back', async () => {
    api = mockApi({ 'POST /api/v1/system/failed-jobs/retry': (body) => ({ body: { retried: 'ids' in (body as object) ? 1 : 4 } }) });

    expect(await retryFailedJobs()).toEqual({ retried: 4 });
    expect(await retryFailedJobs(['9b3e6a52-1c0f-4f1e-9a57-2d6f3e8c1a01'])).toEqual({ retried: 1 });
    expect(api.calls.map((call) => call.body)).toEqual([{}, { ids: ['9b3e6a52-1c0f-4f1e-9a57-2d6f3e8c1a01'] }]);
  });

  it('sends a test mail and answers where it went', async () => {
    api = mockApi({ 'POST /api/v1/system/test-mail': () => ({ body: { sent_to: 'mara@example.com' } }) });

    expect(await sendTestMail()).toEqual({ sent_to: 'mara@example.com' });
    expect(api.calls).toEqual([{ method: 'POST', url: '/api/v1/system/test-mail', body: undefined }]);
  });

  it('lets the refusal of a server without mail through as it came', async () => {
    api = mockApi({ 'POST /api/v1/system/test-mail': () => ({ status: 409, body: { reason: 'mail_not_configured', detail: 'Kein Mailserver.' } }) });

    await expect(sendTestMail()).rejects.toMatchObject({ status: 409, reason: 'mail_not_configured' });
  });
});
