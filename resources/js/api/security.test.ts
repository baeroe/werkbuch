import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { changePassword, confirmTwoFactor, disableTwoFactor, enableTwoFactor, getTwoFactor, regenerateRecoveryCodes } from './security';

let api: MockApi;

afterEach(() => api.restore());

describe('security', () => {
  it('changes the password', async () => {
    api = mockApi({ 'PUT /api/v1/me/password': () => ({}) });
    const input = { current_password: 'alt-und-lang', password: 'neu-und-lang', password_confirmation: 'neu-und-lang' };

    await expect(changePassword(input)).resolves.toBeUndefined();
    expect(api.calls).toEqual([{ method: 'PUT', url: '/api/v1/me/password', body: input }]);
  });

  it('reads, starts, confirms and switches off the second factor and renews the recovery codes', async () => {
    const status = { enabled: true, confirmed_at: '2026-10-28T09:00:00.000Z', recovery_codes_left: 8 };
    const setup = { secret: 'JBSWY3DPEHPK3PXP', otpauth_url: 'otpauth://totp/werkbuch:mara', qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+' };
    api = mockApi({
      'GET /api/v1/me/two-factor': () => ({ body: status }),
      'POST /api/v1/me/two-factor': () => ({ body: setup }),
      'POST /api/v1/me/two-factor/confirm': () => ({ body: { recovery_codes: ['a1b2c-d3e4f'] } }),
      'DELETE /api/v1/me/two-factor': () => ({}),
      'POST /api/v1/me/two-factor/recovery-codes': () => ({ body: { recovery_codes: ['f6e5d-c4b3a'] } }),
    });

    expect(await getTwoFactor()).toEqual(status);
    expect(await enableTwoFactor()).toEqual(setup);
    expect(await confirmTwoFactor('123456')).toEqual({ recovery_codes: ['a1b2c-d3e4f'] });
    await expect(disableTwoFactor()).resolves.toBeUndefined();
    expect(await regenerateRecoveryCodes()).toEqual({ recovery_codes: ['f6e5d-c4b3a'] });
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['GET', '/api/v1/me/two-factor', undefined],
      ['POST', '/api/v1/me/two-factor', undefined],
      ['POST', '/api/v1/me/two-factor/confirm', { code: '123456' }],
      ['DELETE', '/api/v1/me/two-factor', undefined],
      ['POST', '/api/v1/me/two-factor/recovery-codes', undefined],
    ]);
  });
});
