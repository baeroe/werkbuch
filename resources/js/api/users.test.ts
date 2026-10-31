import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { ida, list, mara } from '@/test/fixtures';
import type { Invitation, User } from '@/types';
import { ApiError } from './client';
import { createBot, deactivateUser, inviteUser, listInvitations, listUsers, reactivateUser, updateUser, updateUserRole } from './users';

let api: MockApi;

afterEach(() => api.restore());

const kira: User = { ...mara, id: 'u_kira', type: 'bot', name: 'Kira', handle: 'kira', email: null, org_role: 'member', owner_id: 'u_mara', description: 'Sortiert Bugs.' };

const invitation: Invitation = {
  id: 'inv_1',
  email: 'rita@feldwerk.example.com',
  org_role: 'member',
  projects: [{ project_id: 'p_web', role: 'viewer' }],
  link: null,
  state: 'open',
  created_by: 'u_mara',
  created_at: '2026-10-28T09:00:00.000Z',
  expires_at: '2026-11-04T09:00:00.000Z',
};

describe('users', () => {
  it('lists accounts as a page, filtered by type when asked', async () => {
    api = mockApi({ 'GET /api/v1/users': (_body, url) => ({ body: list(url.searchParams.get('type') === 'bot' ? [kira] : [mara, ida, kira]) }) });

    expect(await listUsers()).toEqual({ items: [mara, ida, kira], next_cursor: null, total: 3 });
    expect(await listUsers({ type: 'bot' })).toEqual({ items: [kira], next_cursor: null, total: 1 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/users', '/api/v1/users?type=bot']);
  });

  it('invites with the link as it comes (no data wrapper) and lists the invitations', async () => {
    const link = 'https://werkbuch.example.com/invitations/inv_1?signature=x';
    api = mockApi({
      'POST /api/v1/invitations': () => ({ status: 201, body: { link, invitation: { ...invitation, link } } }),
      'GET /api/v1/invitations': () => ({ body: list([invitation]) }),
    });

    const input = { email: 'rita@feldwerk.example.com', org_role: 'member' as const, projects: [{ project_id: 'p_web', role: 'viewer' as const }] };
    expect(await inviteUser(input)).toEqual({ link, invitation: { ...invitation, link } });
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/v1/invitations', body: input });
    expect(await listInvitations()).toEqual({ items: [invitation], next_cursor: null, total: 1 });
  });

  it('changes the role, deactivates and reactivates an account, each answering the account', async () => {
    api = mockApi({
      'PUT /api/v1/users/u_ida/role': () => ({ body: { data: { ...ida, org_role: 'admin' } } }),
      'POST /api/v1/users/u_ida/deactivate': () => ({ body: { data: { ...ida, disabled_at: '2026-10-28T09:00:00.000Z' } } }),
      'POST /api/v1/users/u_ida/reactivate': () => ({ body: { data: ida } }),
    });

    expect((await updateUserRole('u_ida', 'admin')).org_role).toBe('admin');
    expect((await deactivateUser('u_ida')).disabled_at).toBe('2026-10-28T09:00:00.000Z');
    expect(await reactivateUser('u_ida')).toEqual(ida);
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['PUT', '/api/v1/users/u_ida/role', { org_role: 'admin' }],
      ['POST', '/api/v1/users/u_ida/deactivate', undefined],
      ['POST', '/api/v1/users/u_ida/reactivate', undefined],
    ]);
  });

  it('creates a bot and changes a profile', async () => {
    api = mockApi({
      'POST /api/v1/bots': () => ({ status: 201, body: { data: kira } }),
      'PATCH /api/v1/users/u_ida': (body) => ({ body: { data: { ...ida, ...(body as object) } } }),
    });

    expect(await createBot({ name: 'Kira', handle: 'kira', description: 'Sortiert Bugs.' })).toEqual(kira);
    expect(api.calls[0]!.body).toEqual({ name: 'Kira', handle: 'kira', description: 'Sortiert Bugs.' });
    expect(await updateUser('u_ida', { timezone: 'Europe/Vienna' })).toEqual({ ...ida, timezone: 'Europe/Vienna' });
    expect(api.calls[1]).toEqual({ method: 'PATCH', url: '/api/v1/users/u_ida', body: { timezone: 'Europe/Vienna' } });
  });

  it('hands a refusal on as ApiError with its reason', async () => {
    api = mockApi({ 'PUT /api/v1/users/u_mara/role': () => ({ status: 409, body: { reason: 'last_admin', detail: 'Das ist der letzte aktive Admin.' } }) });

    await expect(updateUserRole('u_mara', 'member')).rejects.toEqual(expect.objectContaining({ status: 409, reason: 'last_admin' }));
    await expect(updateUserRole('u_mara', 'member')).rejects.toBeInstanceOf(ApiError);
  });
});
