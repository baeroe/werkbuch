import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list } from '@/test/fixtures';
import type { Token } from '@/types';
import { createToken, listTokens, revokeToken } from './tokens';

let api: MockApi;

afterEach(() => api.restore());

const token: Token = {
  id: 'tok_1',
  user_id: 'u_kira',
  name: 'CI',
  abilities: ['read', 'write'],
  expires_at: null,
  last_used_at: null,
  created_at: '2026-10-28T09:00:00.000Z',
};

describe('tokens', () => {
  it('lists the tokens of an account, creates one with its plain text and revokes it', async () => {
    api = mockApi({
      'GET /api/v1/tokens': () => ({ body: list([token]) }),
      'POST /api/v1/tokens': () => ({ status: 201, body: { token, plain_text: 'tok_1|wb_geheim' } }),
      'DELETE /api/v1/tokens/tok_1': () => ({}),
    });

    expect(await listTokens('u_kira')).toEqual({ items: [token], next_cursor: null, total: 1 });
    const input = { user_id: 'u_kira', name: 'CI', abilities: ['read' as const, 'write' as const], expires_at: null };
    expect(await createToken(input)).toEqual({ token, plain_text: 'tok_1|wb_geheim' });
    await expect(revokeToken('tok_1')).resolves.toBeUndefined();

    expect(api.calls).toEqual([
      { method: 'GET', url: '/api/v1/tokens?user_id=u_kira', body: undefined },
      { method: 'POST', url: '/api/v1/tokens', body: input },
      { method: 'DELETE', url: '/api/v1/tokens/tok_1', body: undefined },
    ]);
  });
});
