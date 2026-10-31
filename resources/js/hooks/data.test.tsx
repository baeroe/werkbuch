import { router } from '@inertiajs/react';
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, mara, organization, project } from '@/test/fixtures';
import type { User } from '@/types';
import { qk } from './keys';
import { useApiMutation, useSettle } from './mutation';
import { useOrganization, useUpdateOrganization } from './organization';
import {
  useAddMember,
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useJoinProject,
  useMembers,
  useProject,
  useProjects,
  useRemoveMember,
  useUpdateMemberRole,
  useUpdateProject,
} from './projects';
import { useChangePassword, useConfirmTwoFactor, useDisableTwoFactor, useEnableTwoFactor, useRegenerateRecoveryCodes, useTwoFactor } from './security';
import { useCreateToken, useRevokeToken, useTokens } from './tokens';
import {
  useCreateBot,
  useCurrentUser,
  useDeactivateUser,
  useInvitations,
  useInviteUser,
  useReactivateUser,
  useUpdateUser,
  useUpdateUserRole,
  useUsers,
} from './users';
import { useFavorites, useToggleFavorite } from './views';

let me: User | null = mara;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: me, permissions: [] }, organization } }),
  router: { reload: vi.fn() },
}));

let queryClient: QueryClient;
let api: MockApi | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  me = mara;
  vi.mocked(router.reload).mockClear();
  // the stale time of the app's client (queryClient.ts): data from the page counts as fresh for a moment
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
});

const web = project('WEB', 'admin', { id: 'p1' });
const token = { id: 'tok_1', user_id: 'u_mara', name: 'CI', abilities: ['read'], expires_at: null, last_used_at: null, created_at: '2026-10-28T09:00:00.000Z' };
const member = { project_id: 'p1', user_id: 'u_ida', role: 'member' };
const codes = { recovery_codes: ['a1b2c-d3e4f'] };

describe('reading', () => {
  it('useCurrentUser reads the signed-in account from the shared props, and nobody on a guest page', () => {
    expect(renderHook(() => useCurrentUser(), { wrapper }).result.current).toBe(mara);

    me = null;
    expect(renderHook(() => useCurrentUser(), { wrapper }).result.current).toBeUndefined();
  });

  it('useOrganization starts with the shared props and asks the API only once they are stale', async () => {
    api = mockApi({ 'GET /api/v1/organization': () => ({ body: { data: { ...organization, name: 'Feldwerk GmbH' } } }) });
    const { result } = renderHook(() => useOrganization(), { wrapper });

    expect(result.current.data).toEqual(organization);
    expect(api.calls).toHaveLength(0);

    await act(() => queryClient.invalidateQueries({ queryKey: qk.organization.all }));
    await waitFor(() => expect(result.current.data?.name).toBe('Feldwerk GmbH'));
  });

  it('the list hooks answer pages', async () => {
    api = mockApi({
      'GET /api/v1/users': () => ({ body: list([mara, ida]) }),
      'GET /api/v1/invitations': () => ({ body: list([]) }),
      'GET /api/v1/tokens': () => ({ body: list([token]) }),
      'GET /api/v1/projects': () => ({ body: list([web]) }),
      'GET /api/v1/projects/WEB/members': () => ({ body: list([member]) }),
      'GET /api/v1/favorites': () => ({ body: list([{ user_id: 'u_mara', kind: 'project', id: 'p1', position: 0 }]) }),
    });
    const { result } = renderHook(
      () => ({
        users: useUsers({ type: 'person' }),
        invitations: useInvitations(),
        tokens: useTokens('u_mara'),
        projects: useProjects({ include_archived: true }),
        members: useMembers('WEB'),
        favorites: useFavorites(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(Object.values(result.current).every((query) => query.isSuccess)).toBe(true));
    expect(result.current.users.data?.items).toEqual([mara, ida]);
    expect(result.current.invitations.data?.total).toBe(0);
    expect(result.current.tokens.data?.items).toEqual([token]);
    expect(result.current.projects.data?.items).toEqual([web]);
    expect(result.current.members.data?.items).toEqual([member]);
    expect(result.current.favorites.data?.items).toHaveLength(1);
    expect(api.calls.map((call) => call.url).sort()).toEqual([
      '/api/v1/favorites',
      '/api/v1/invitations',
      '/api/v1/projects/WEB/members',
      '/api/v1/projects?include_archived=1',
      '/api/v1/tokens?user_id=u_mara',
      '/api/v1/users?type=person',
    ]);
  });

  it('useProject reads one project, and waits while the identifier is unknown or it is switched off', async () => {
    api = mockApi({ 'GET /api/v1/projects/WEB': () => ({ body: { data: web } }) });
    const { result } = renderHook(
      () => ({ web: useProject('WEB'), none: useProject(null), off: useProject('APP', { enabled: false }), tokens: useTokens(undefined), members: useMembers(null) }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.web.data).toEqual(web));
    expect(result.current.none.fetchStatus).toBe('idle');
    expect(result.current.off.fetchStatus).toBe('idle');
    expect(result.current.tokens.fetchStatus).toBe('idle');
    expect(result.current.members.fetchStatus).toBe('idle');
    expect(api.calls).toHaveLength(1);
  });

  it('useTwoFactor reads the own second factor', async () => {
    const status = { enabled: false, confirmed_at: null, recovery_codes_left: 0 };
    api = mockApi({ 'GET /api/v1/me/two-factor': () => ({ body: status }) });
    const { result } = renderHook(() => useTwoFactor(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(status));
  });
});

/** The cached resources a mutation may make stale, by name. */
const PROBES: Record<string, QueryKey> = {
  organization: qk.organization.all,
  users: qk.users.all,
  invitations: qk.invitations.all,
  tokens: qk.tokens.all,
  twoFactor: qk.twoFactor.all,
  projects: qk.projects.all,
  members: qk.members.all,
  favorites: qk.favorites.all,
  workItems: qk.workItems.all,
};
const ALL = Object.keys(PROBES);

/** A mutation hook, whatever its variables and answer. */
type AnyMutation = () => { mutateAsync: (vars: never) => Promise<unknown> };

describe('mutations', () => {
  it.each<[string, AnyMutation, unknown, string, MockRoute, string[]]>([
    ['useUpdateOrganization', useUpdateOrganization, { name: 'Feldwerk GmbH' }, 'PATCH /api/v1/organization', () => ({ body: { data: organization } }), ['organization']],
    ['useInviteUser', useInviteUser, { email: 'rita@example.com', org_role: 'member' }, 'POST /api/v1/invitations', () => ({ status: 201, body: { link: 'x', invitation: {} } }), ['invitations']],
    ['useUpdateUserRole', useUpdateUserRole, { user_id: 'u_ida', org_role: 'admin' }, 'PUT /api/v1/users/u_ida/role', () => ({ body: { data: ida } }), ['users']],
    ['useDeactivateUser', useDeactivateUser, 'u_ida', 'POST /api/v1/users/u_ida/deactivate', () => ({ body: { data: ida } }), ['users', 'tokens', 'workItems']],
    ['useReactivateUser', useReactivateUser, 'u_ida', 'POST /api/v1/users/u_ida/reactivate', () => ({ body: { data: ida } }), ['users']],
    ['useCreateBot', useCreateBot, { name: 'Kira', handle: 'kira' }, 'POST /api/v1/bots', () => ({ status: 201, body: { data: ida } }), ['users']],
    ['useUpdateUser', useUpdateUser, { user_id: 'u_ida', patch: { name: 'Ida B.' } }, 'PATCH /api/v1/users/u_ida', () => ({ body: { data: ida } }), ['users']],
    ['useCreateToken', useCreateToken, { user_id: 'u_mara', name: 'CI', abilities: ['read'] }, 'POST /api/v1/tokens', () => ({ status: 201, body: { token, plain_text: 'x' } }), ['tokens']],
    ['useRevokeToken', useRevokeToken, 'tok_1', 'DELETE /api/v1/tokens/tok_1', () => ({}), ['tokens']],
    ['useCreateProject', useCreateProject, { name: 'Website', identifier: 'WEB' }, 'POST /api/v1/projects', () => ({ status: 201, body: { data: web } }), ['projects', 'members', 'favorites']],
    ['useUpdateProject', useUpdateProject, { id: 'p1', patch: { identifier: 'SITE' } }, 'PATCH /api/v1/projects/p1', () => ({ body: { data: web } }), ALL],
    ['useArchiveProject', useArchiveProject, { id: 'p1', archived: false }, 'POST /api/v1/projects/p1/restore', () => ({ body: { data: web } }), ALL],
    ['useDeleteProject', useDeleteProject, 'p1', 'DELETE /api/v1/projects/p1', () => ({ status: 202 }), ALL],
    ['useJoinProject', useJoinProject, 'p1', 'POST /api/v1/projects/p1/join', () => ({ status: 201, body: { data: member } }), ['projects', 'members', 'favorites']],
    ['useAddMember', useAddMember, { project_id: 'p1', user_id: 'u_ida', role: 'member' }, 'POST /api/v1/projects/p1/members', () => ({ status: 201, body: { data: member } }), ['projects', 'members']],
    ['useUpdateMemberRole', useUpdateMemberRole, { project_id: 'p1', user_id: 'u_ida', role: 'admin' }, 'PATCH /api/v1/projects/p1/members/u_ida', () => ({ body: { data: member } }), ['projects', 'members']],
    ['useRemoveMember', useRemoveMember, { project_id: 'p1', user_id: 'u_ida' }, 'DELETE /api/v1/projects/p1/members/u_ida', () => ({}), ['projects', 'members']],
    ['useToggleFavorite', useToggleFavorite, { kind: 'project', id: 'p1' }, 'POST /api/v1/favorites/toggle', () => ({ body: { kind: 'project', id: 'p1', favorite: true } }), ['favorites']],
    ['useChangePassword', useChangePassword, { current_password: 'a', password: 'b', password_confirmation: 'b' }, 'PUT /api/v1/me/password', () => ({}), []],
    ['useEnableTwoFactor', useEnableTwoFactor, undefined, 'POST /api/v1/me/two-factor', () => ({ body: { secret: 's', otpauth_url: 'o', qr_svg: 'q' } }), ['twoFactor']],
    ['useConfirmTwoFactor', useConfirmTwoFactor, '123456', 'POST /api/v1/me/two-factor/confirm', () => ({ body: codes }), ['twoFactor']],
    ['useDisableTwoFactor', useDisableTwoFactor, undefined, 'DELETE /api/v1/me/two-factor', () => ({}), ['twoFactor']],
    ['useRegenerateRecoveryCodes', useRegenerateRecoveryCodes, undefined, 'POST /api/v1/me/two-factor/recovery-codes', () => ({ body: codes }), ['twoFactor']],
  ])('%s calls the API and makes stale what it changed', async (_name, useHook, vars, route, answer, stale) => {
    api = mockApi({ [route]: answer });
    Object.values(PROBES).forEach((key) => queryClient.setQueryData(key, 'cached'));
    const { result } = renderHook(() => useHook(), { wrapper });

    await act(() => result.current.mutateAsync(vars as never));

    expect(api.calls.map((call) => `${call.method} ${call.url.split('?')[0]}`)).toEqual([route]);
    expect(ALL.filter((name) => queryClient.getQueryState(PROBES[name]!)?.isInvalidated)).toEqual(stale);
  });

  it('useUpdateOrganization reloads the page, so the shared props follow', async () => {
    api = mockApi({ 'PATCH /api/v1/organization': () => ({ body: { data: organization } }) });
    const { result } = renderHook(() => useUpdateOrganization(), { wrapper });

    await act(() => result.current.mutateAsync({ locale: 'en' }));

    expect(router.reload).toHaveBeenCalledTimes(1);
  });

  it('useUpdateUser reloads the page for the own account, not for another one', async () => {
    api = mockApi({
      'PATCH /api/v1/users/u_mara': () => ({ body: { data: mara } }),
      'PATCH /api/v1/users/u_ida': () => ({ body: { data: ida } }),
    });
    const { result } = renderHook(() => useUpdateUser(), { wrapper });

    await act(() => result.current.mutateAsync({ user_id: 'u_ida', patch: { name: 'Ida B.' } }));
    expect(router.reload).not.toHaveBeenCalled();

    await act(() => result.current.mutateAsync({ user_id: 'u_mara', patch: { locale: 'en' } }));
    expect(router.reload).toHaveBeenCalledTimes(1);
  });

  it('useCreateToken does not keep the answer with the plain text once its dialog lets go of it', async () => {
    api = mockApi({
      'POST /api/v1/tokens': () => ({ status: 201, body: { token, plain_text: 'tok_1|wb_geheim' } }),
      'DELETE /api/v1/tokens/tok_1': () => ({}),
    });
    const create = renderHook(() => useCreateToken(), { wrapper });
    const revoke = renderHook(() => useRevokeToken(), { wrapper });
    await act(() => create.result.current.mutateAsync({ user_id: 'u_mara', name: 'CI', abilities: ['read'] }));
    await act(() => revoke.result.current.mutateAsync('tok_1'));
    const secrets = () => queryClient.getMutationCache().getAll().filter((mutation) => JSON.stringify(mutation.state.data ?? null).includes('wb_geheim'));
    expect(secrets()).toHaveLength(1);

    create.unmount();
    revoke.unmount();

    await waitFor(() => expect(secrets()).toHaveLength(0));
    // an answer without a secret may stay for its usual time
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  });
});

describe('useApiMutation', () => {
  it('stays pending until what it made stale has loaded again', async () => {
    let release!: (value: string) => void;
    let loads = 0;
    const queryFn = () => {
      loads += 1;
      return loads === 1 ? Promise.resolve('alt') : new Promise<string>((resolve) => (release = resolve));
    };
    const { result } = renderHook(
      () => ({ data: useQueryProbe(queryFn), save: useApiMutation((value: string) => Promise.resolve(value), [['probe']]) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe('alt'));

    let done = false;
    act(() => {
      void result.current.save.mutateAsync('neu').then(() => (done = true));
    });
    await waitFor(() => expect(loads).toBe(2));
    expect(result.current.save.isPending).toBe(true);
    expect(done).toBe(false);

    await act(async () => release('neu'));

    await waitFor(() => expect(result.current.save.isPending).toBe(false));
    expect(done).toBe(true);
    expect(result.current.data).toBe('neu');
  });

  it('takes the keys from a function of the answer and hands the answer to onSuccess first', async () => {
    const order: string[] = [];
    queryClient.setQueryData(['projects', 'detail', 'p1'], 'cached');
    queryClient.setQueryData(['projects', 'detail', 'p2'], 'cached');
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'invalidate') order.push('invalidate');
    });
    const { result } = renderHook(
      () =>
        useApiMutation((id: string) => Promise.resolve({ id }), (data) => [qk.projects.detail(data.id)], {
          onSuccess: (data, vars, client) => order.push(`onSuccess ${data.id} ${vars} ${client === queryClient}`),
        }),
      { wrapper },
    );

    await act(() => result.current.mutateAsync('p1'));

    expect(order).toEqual(['onSuccess p1 p1 true', 'invalidate']);
    expect(queryClient.getQueryState(['projects', 'detail', 'p1'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['projects', 'detail', 'p2'])?.isInvalidated).toBe(false);
    unsubscribe();
  });
});

/** A query of the key `['probe']`, for the tests of useApiMutation. */
function useQueryProbe(queryFn: () => Promise<string>) {
  return useQuery({ queryKey: ['probe'], queryFn, staleTime: Infinity }).data;
}

describe('useSettle', () => {
  it('gives every call its own answer, success or failure', async () => {
    const { result } = renderHook(() => useSettle(), { wrapper });
    const seen: string[] = [];

    result.current(Promise.resolve('eins'), { onSuccess: (data) => seen.push(`ok ${data}`), onSettled: () => seen.push('settled 1') });
    result.current(Promise.reject(new Error('kaputt')), { onError: (error) => seen.push(`error ${error.message}`), onSettled: () => seen.push('settled 2') });
    result.current(Promise.resolve('ohne Rückruf'));
    result.current(Promise.reject(new Error('ohne Rückruf')));

    await waitFor(() => expect(seen).toHaveLength(4));
    expect(seen).toEqual(expect.arrayContaining(['ok eins', 'settled 1', 'error kaputt', 'settled 2']));
    expect(seen.indexOf('ok eins')).toBeLessThan(seen.indexOf('settled 1'));
    expect(seen.indexOf('error kaputt')).toBeLessThan(seen.indexOf('settled 2'));
  });

  it('stays quiet once the component is gone', async () => {
    const { result, unmount } = renderHook(() => useSettle(), { wrapper });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;

    result.current(new Promise<string>((done) => (resolve = done)), { onSuccess });
    result.current(new Promise<string>((_done, fail) => (reject = fail)), { onError });
    unmount();
    resolve('spät');
    reject(new Error('spät'));
    await new Promise((done) => setTimeout(done, 0));

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
