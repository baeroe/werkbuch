import { router } from '@inertiajs/react';
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditReason, useItemWorkflow } from '@/components/fields/itemData';
import { ApiError, type Page } from '@/api/client';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { uploadAttachment } from '@/api/attachments';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import {
  agency,
  emptySearch,
  ida,
  itemEvent,
  labels,
  list,
  makeAttachment,
  makeComment,
  mara,
  ops12,
  organization,
  pageSummary,
  project,
  properties,
  relationTypes,
  resolutions,
  searchResults,
  seitenstruktur,
  standard,
  types,
  web47,
  web47Comments,
  web47History,
} from '@/test/fixtures';
import { installFakeXhr, FakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { Comment, ListedItem, ProjectMember, User, WorkItemDetail } from '@/types';
import { ATTACHMENT_FRESH_MS, useAttachment, useDeleteAttachment, usePrimeAttachments, useUploadAttachment } from './attachments';
import { useAddComment, useComments, useDeleteComment, useEditComment, useToggleReaction } from './comments';
import { useDeleteLabel, useDeleteRelationType, useDeleteResolution, useLabels, useRelationTypes, useResolutions, useSaveLabel, useSaveRelationType, useSaveResolution } from './catalog';
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
import { useSearch } from './search';
import { useDeleteProperty, useProperties, useSaveProperty } from './properties';
import { useChangePassword, useConfirmTwoFactor, useDisableTwoFactor, useEnableTwoFactor, useRegenerateRecoveryCodes, useTwoFactor } from './security';
import { useCreateToken, useRevokeToken, useTokens } from './tokens';
import {
  useAllUsers,
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
import { primeItemRef, primePageRef, useItemRef, useMentionables, usePageRef } from './richText';
import { useFavorites, useToggleFavorite } from './views';
import { useActivity } from './workItems';
import { useDeleteWorkItemType, useSaveWorkItemType, useWorkItemTypes } from './workItemTypes';
import { useAssignWorkflow, useDeleteWorkflow, useSaveWorkflow, useWorkflows } from './workflows';

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
  resetToasts();
});

const web = project('WEB', 'admin', { id: 'p1' });
const token = { id: 'tok_1', user_id: 'u_mara', name: 'CI', abilities: ['read'], expires_at: null, last_used_at: null, created_at: '2026-10-28T09:00:00.000Z' };
const member: ProjectMember = { project_id: 'p1', user_id: 'u_ida', role: 'member' };
const codes = { recovery_codes: ['a1b2c-d3e4f'] };

describe('a project the cached list lacks', () => {
  // created or joined after the list loaded, which counts as fresh for 10 s: the item of a hit in the palette must not
  // wait for its project until something else loads the list again
  const fresh = project('NEW', 'member', { id: 'p_new' });
  let projects = [web];
  const projectCalls = () => api!.calls.filter((call) => call.url.startsWith('/api/v1/projects')).length;

  async function cachedList() {
    projects = [web];
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list(projects) }), 'GET /api/v1/workflows': () => ({ body: list([standard]) }) });
    const { result } = renderHook(() => useProjects({ include_archived: true }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
  }

  const item = (projectId: string) => ({ key: 'NEW-1', project_id: projectId, archived_at: null });

  it('loads the projects again when an item names a project the list lacks', async () => {
    await cachedList();
    projects = [web, fresh];

    const { result } = renderHook(() => ({ workflow: useItemWorkflow(item('p_new')), reason: useEditReason(item('p_new')) }), { wrapper });

    await waitFor(() => expect(result.current.workflow.project?.id).toBe('p_new'));
    expect(result.current.workflow.workflow?.id).toBe(standard.id);
    expect(result.current.reason).toBeNull();
    expect(projectCalls()).toBe(2);
  });

  it('loads them again only once for a project that stays missing', async () => {
    await cachedList();

    const first = renderHook(() => useItemWorkflow(item('p_gone')), { wrapper });
    await waitFor(() => expect(projectCalls()).toBe(2));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    // a second item of the same project, and the first one rendered again
    renderHook(() => useEditReason(item('p_gone')), { wrapper });
    first.rerender();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(projectCalls()).toBe(2);
    expect(first.result.current.project).toBeUndefined();
  });
});

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
      '/api/v1/tokens?filter%5Buser_id%5D=u_mara',
      '/api/v1/users?filter%5Btype%5D=person',
    ]);
  });

  it('useAllUsers follows the cursor through every page, with the type filter on each request', async () => {
    const page = (data: User[], next_cursor: string | null) => ({ body: { data, links: {}, meta: { next_cursor, total: 3 } } });
    api = mockApi({ 'GET /api/v1/users': (_body, url) => (url.searchParams.get('cursor') === 'c2' ? page([ida], null) : page([mara, ida], 'c2')) });
    const { result } = renderHook(() => useAllUsers({ type: 'person' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [mara, ida, ida], next_cursor: null, total: 3 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/users?filter%5Btype%5D=person', '/api/v1/users?cursor=c2&filter%5Btype%5D=person']);
  });

  it('useProjects and useInvitations follow the cursor through every page as well', async () => {
    const app = project('APP', 'member', { id: 'p2' });
    const invitation = (id: string) => ({ id, email: `${id}@example.com` });
    const page = (data: unknown[], next_cursor: string | null) => ({ body: { data, links: {}, meta: { next_cursor, total: 2 } } });
    api = mockApi({
      'GET /api/v1/projects': (_body, url) => (url.searchParams.get('cursor') === 'c2' ? page([app], null) : page([web], 'c2')),
      'GET /api/v1/invitations': (_body, url) => (url.searchParams.get('cursor') === 'i2' ? page([invitation('b')], null) : page([invitation('a')], 'i2')),
    });
    const { result } = renderHook(() => ({ projects: useProjects({ include_archived: true }), invitations: useInvitations() }), { wrapper });

    await waitFor(() => expect(result.current.projects.isSuccess && result.current.invitations.isSuccess).toBe(true));
    expect(result.current.projects.data).toEqual({ items: [web, app], next_cursor: null, total: 2 });
    expect(result.current.invitations.data?.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(api.calls.map((call) => call.url).sort()).toEqual([
      '/api/v1/invitations',
      '/api/v1/invitations?cursor=i2',
      '/api/v1/projects?include_archived=1',
      '/api/v1/projects?include_archived=1&cursor=c2',
    ]);
  });

  it('useMembers follows the cursor through every page: the assignees, the lead and the members screen need all', async () => {
    const lene: ProjectMember = { ...member, user_id: 'u_lene', role: 'member' };
    const page = (data: ProjectMember[], next_cursor: string | null) => ({ body: { data, links: {}, meta: { next_cursor, total: 2 } } });
    api = mockApi({ 'GET /api/v1/projects/WEB/members': (_body, url) => (url.searchParams.get('cursor') === 'm2' ? page([lene], null) : page([member], 'm2')) });
    const { result } = renderHook(() => useMembers('WEB'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [member, lene], next_cursor: null, total: 2 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/projects/WEB/members', '/api/v1/projects/WEB/members?cursor=m2']);
  });

  it('follows next_cursor for every catalog list', async () => {
    const page = (data: unknown[], next_cursor: string | null) => ({ body: { data, links: {}, meta: { next_cursor, total: data.length } } });
    const twoPages = (first: unknown[], second: unknown[]): MockRoute => (_body, url) => (url.searchParams.get('cursor') === 'c2' ? page(second, null) : page(first, 'c2'));
    api = mockApi({
      'GET /api/v1/workflows': twoPages([standard], [agency]),
      'GET /api/v1/work-item-types': twoPages(types.slice(0, 2), types.slice(2)),
      'GET /api/v1/properties': twoPages(properties.slice(0, 1), properties.slice(1)),
      'GET /api/v1/labels': twoPages(labels.slice(0, 2), labels.slice(2)),
      'GET /api/v1/relation-types': twoPages(relationTypes.slice(0, 3), relationTypes.slice(3)),
      'GET /api/v1/resolutions': twoPages(resolutions.slice(0, 1), resolutions.slice(1)),
    });
    const { result } = renderHook(
      () => ({
        workflows: useWorkflows(),
        types: useWorkItemTypes(),
        properties: useProperties(),
        labels: useLabels(),
        relationTypes: useRelationTypes(),
        resolutions: useResolutions(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(Object.values(result.current).every((query) => query.isSuccess)).toBe(true));
    expect(result.current.workflows.data).toEqual({ items: [standard, agency], next_cursor: null, total: 2 });
    expect(result.current.types.data?.items).toEqual(types);
    expect(result.current.properties.data?.items).toEqual(properties);
    expect(result.current.labels.data?.items).toEqual(labels);
    expect(result.current.relationTypes.data?.items).toEqual(relationTypes);
    expect(result.current.resolutions.data?.items).toEqual(resolutions);
    expect(api.calls).toHaveLength(12);
    expect(api.calls.filter((call) => call.url.endsWith('?cursor=c2'))).toHaveLength(6);
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
  workflows: qk.workflows.all,
  workItemTypes: qk.workItemTypes.all,
  properties: qk.properties.all,
  labels: qk.labels.all,
  relationTypes: qk.relationTypes.all,
  resolutions: qk.resolutions.all,
  workItems: qk.workItems.all,
  activity: qk.activity.all,
  stateUsage: qk.stateUsage.all,
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
    ['useSaveWorkflow', useSaveWorkflow, { workflow: { ...agency, id: undefined }, options: { state_mapping: { app_review: 'app_progress' } } }, 'POST /api/v1/workflows', () => ({ status: 201, body: { data: agency } }), ALL],
    ['useDeleteWorkflow', useDeleteWorkflow, 'wf_agency', 'DELETE /api/v1/workflows/wf_agency', () => ({}), ['workflows']],
    ['useAssignWorkflow', useAssignWorkflow, { project_id: 'p1', workflow_id: 'wf_agency', mapping: { std_todo: 'app_todo' } }, 'PUT /api/v1/projects/p1/workflow', () => ({ body: { data: web } }), ALL],
    ['useSaveWorkItemType', useSaveWorkItemType, types[1], 'PUT /api/v1/work-item-types/t_bug', () => ({ body: { data: types[1] } }), ['workItemTypes']],
    ['useDeleteWorkItemType', useDeleteWorkItemType, 't_wish', 'DELETE /api/v1/work-item-types/t_wish', () => ({ body: { outcome: 'deleted' } }), ['projects', 'workItemTypes']],
    ['useSaveProperty', useSaveProperty, properties[1], 'PUT /api/v1/properties/pr_effort', () => ({ body: { data: properties[1] } }), ['properties']],
    ['useDeleteProperty', useDeleteProperty, 'pr_effort', 'DELETE /api/v1/properties/pr_effort', () => ({ body: { affected_items: 0 } }), ['workItemTypes', 'properties', 'workItems']],
    ['useSaveLabel', useSaveLabel, { name: 'Neu', color: 'sky' }, 'POST /api/v1/labels', () => ({ status: 201, body: { data: labels[0] } }), ['labels']],
    ['useDeleteLabel', useDeleteLabel, 'lb_ux', 'DELETE /api/v1/labels/lb_ux', () => ({ body: { affected_items: 0 } }), ['labels', 'workItems']],
    ['useSaveRelationType', useSaveRelationType, relationTypes[3], 'PUT /api/v1/relation-types/rt_tests', () => ({ body: { data: relationTypes[3] } }), ['relationTypes']],
    ['useDeleteRelationType', useDeleteRelationType, 'rt_tests', 'DELETE /api/v1/relation-types/rt_tests', () => ({ body: { affected_relations: 0 } }), ['relationTypes', 'workItems']],
    ['useSaveResolution', useSaveResolution, resolutions[2], 'PUT /api/v1/resolutions/res_duplicate', () => ({ body: { data: resolutions[2] } }), ['resolutions']],
    ['useDeleteResolution', useDeleteResolution, 'res_duplicate', 'DELETE /api/v1/resolutions/res_duplicate', () => ({ body: { outcome: 'deleted' } }), ['resolutions']],
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

  it('reloads the types and the projects after deleting a type', async () => {
    let types_ = [...types];
    api = mockApi({
      'GET /api/v1/work-item-types': () => ({ body: list(types_) }),
      'GET /api/v1/projects': () => ({ body: list([web]) }),
      'DELETE /api/v1/work-item-types/t_wish': () => {
        types_ = types_.filter((type) => type.id !== 't_wish');
        return { body: { outcome: 'deleted' } };
      },
    });
    const { result } = renderHook(() => ({ types: useWorkItemTypes(), projects: useProjects(), remove: useDeleteWorkItemType() }), { wrapper });
    await waitFor(() => expect(result.current.types.isSuccess && result.current.projects.isSuccess).toBe(true));
    expect(result.current.types.data?.items).toHaveLength(4);

    await act(() => result.current.remove.mutateAsync('t_wish'));

    await waitFor(() => expect(result.current.types.data?.items).toHaveLength(3));
    expect(api.calls.filter((call) => call.method === 'GET' && call.url === '/api/v1/projects')).toHaveLength(2);
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

  it('useUpdateUserRole reloads the page and the projects for the own account, only the people for another one', async () => {
    api = mockApi({
      'PUT /api/v1/users/u_ida/role': () => ({ body: { data: { ...ida, org_role: 'admin' } } }),
      'PUT /api/v1/users/u_mara/role': () => ({ body: { data: { ...mara, org_role: 'member' } } }),
    });
    const stale = () => ALL.filter((name) => queryClient.getQueryState(PROBES[name]!)?.isInvalidated);
    const seed = () => Object.values(PROBES).forEach((key) => queryClient.setQueryData(key, 'cached'));
    const { result } = renderHook(() => useUpdateUserRole(), { wrapper });

    seed();
    await act(() => result.current.mutateAsync({ user_id: 'u_ida', org_role: 'admin' }));
    expect(stale()).toEqual(['users']);
    expect(router.reload).not.toHaveBeenCalled();

    seed();
    await act(() => result.current.mutateAsync({ user_id: 'u_mara', org_role: 'member' }));
    expect(stale()).toEqual(['users', 'projects']);
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

describe('search', () => {
  const hit = searchResults({ projects: [web] });

  it('does not search for an empty query or spaces', async () => {
    api = mockApi({ 'GET /api/v1/search': () => ({ body: { data: hit } }) });
    const { result, rerender } = renderHook(({ q }) => useSearch(q), { wrapper, initialProps: { q: '' } });

    rerender({ q: '   ' });
    await act(async () => {});

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.calls).toHaveLength(0);
  });

  it('keeps the last hits while the next query is on its way', async () => {
    let release: () => void = () => {};
    const second = new Promise<void>((resolve) => (release = resolve));
    const real = globalThis.fetch;
    api = mockApi({ 'GET /api/v1/search': (_body, url) => ({ body: { data: url.searchParams.get('q') === 'a' ? hit : emptySearch } }) });
    const mocked = globalThis.fetch;
    globalThis.fetch = (input, init) => (String(input).includes('q=ab') ? second.then(() => mocked(input, init)) : mocked(input, init));

    const { result, rerender } = renderHook(({ q }) => useSearch(q), { wrapper, initialProps: { q: 'a' } });
    await waitFor(() => expect(result.current.data).toEqual(hit));

    rerender({ q: 'ab' });
    expect(result.current.data).toEqual(hit);
    expect(result.current.isPlaceholderData).toBe(true);

    release();
    await waitFor(() => expect(result.current.data).toEqual(emptySearch));
    globalThis.fetch = real;
  });

  it('asks again when the palette opens again', async () => {
    api = mockApi({ 'GET /api/v1/search': () => ({ body: { data: hit } }) });

    const first = renderHook(() => useSearch(' kontakt '), { wrapper });
    await waitFor(() => expect(first.result.current.data).toEqual(hit));
    first.unmount();
    const again = renderHook(() => useSearch('kontakt'), { wrapper });
    await waitFor(() => expect(api!.calls).toHaveLength(2));

    expect(again.result.current.data).toEqual(hit);
    expect(api.calls[0]?.url).toBe('/api/v1/search?q=kontakt');
  });
});

describe('activity', () => {
  it('merges comments and history in order: by time, a comment after an event of the same moment', async () => {
    const atTheMove = makeComment({ id: 'c_tie', created_at: web47History[1]!.occurred_at });
    api = mockApi({
      'GET /api/v1/work-items/WEB-47/history': () => ({ body: list(web47History) }),
      'GET /api/v1/work-items/WEB-47/comments': (_body, url) =>
        url.searchParams.get('cursor') === 'next'
          ? { body: list([web47Comments[1]!]) }
          : { body: { data: [atTheMove, web47Comments[0]!], links: {}, meta: { next_cursor: 'next', total: 3 } } },
    });
    const { result } = renderHook(() => useActivity('WEB-47'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((entry) => `${entry.kind} ${entry.id}`)).toEqual([
      'event ev_1',
      'event ev_2',
      'comment c_tie',
      'event ev_3',
      'comment c_web47_1',
      'comment c_web47_2',
    ]);
    expect(result.current.data?.find((entry) => entry.id === 'c_web47_2')).toEqual({ kind: 'comment', id: 'c_web47_2', at: web47Comments[1]!.created_at, comment: web47Comments[1] });
    expect(result.current.isError).toBe(false);
  });

  it('mixes a comment and an event of the same second by their moment', async () => {
    const at = (time: string) => `2026-10-28T10:00:00.${time}Z`;
    api = mockApi({
      'GET /api/v1/work-items/WEB-47/history': () =>
        ({ body: list([itemEvent({ id: 'ev_early', occurred_at: at('100000') }), itemEvent({ id: 'ev_late', occurred_at: at('700000') })]) }),
      'GET /api/v1/work-items/WEB-47/comments': () => ({ body: list([makeComment({ id: 'c_between', created_at: at('200000') }), makeComment({ id: 'c_last', created_at: at('900000') })]) }),
    });
    const { result } = renderHook(() => useActivity('WEB-47'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // the comment at .200 before the change at .700, and after the one at .100
    expect(result.current.data?.map((entry) => `${entry.kind} ${entry.id}`)).toEqual(['event ev_early', 'comment c_between', 'event ev_late', 'comment c_last']);
  });

  it('fails only when a source fails without data, and fetches both again', async () => {
    let comments: { status: number; body: unknown } = { status: 500, body: { reason: 'server_error', detail: 'Kommentare kaputt' } };
    api = mockApi({
      'GET /api/v1/work-items/WEB-47/history': () => ({ body: list([itemEvent()]) }),
      'GET /api/v1/work-items/WEB-47/comments': () => comments,
    });
    const { result } = renderHook(() => useActivity('WEB-47'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe('Kommentare kaputt');

    comments = { status: 200, body: list(web47Comments) };
    await act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.isError).toBe(false);

    // a reload that fails keeps what the activity showed
    comments = { status: 500, body: { reason: 'server_error' } };
    await act(() => result.current.refetch());
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toHaveLength(3);
  });
});

describe('comments', () => {
  const COMMENTS = qk.comments.list({ item: 'wi_web_47', pages: 'all' });

  it('reads every page of the comments of an item, and waits without an item', async () => {
    api = mockApi({
      'GET /api/v1/work-items/wi_web_47/comments': (_body, url) =>
        url.searchParams.get('cursor') === 'next' ? { body: list(web47Comments.slice(1)) } : { body: { data: web47Comments.slice(0, 1), links: {}, meta: { next_cursor: 'next', total: 2 } } },
    });
    const { result } = renderHook(() => ({ comments: useComments('wi_web_47'), none: useComments(null) }), { wrapper });

    await waitFor(() => expect(result.current.comments.isSuccess).toBe(true));
    expect(result.current.comments.data?.items).toEqual(web47Comments);
    expect(result.current.none.fetchStatus).toBe('idle');
  });

  it('adds, edits and deletes comments and makes the comments, the activity and the items stale', async () => {
    const added = makeComment({ id: 'c_new' });
    api = mockApi({
      'POST /api/v1/work-items/wi_web_47/comments': () => ({ status: 201, body: { data: added } }),
      'PATCH /api/v1/comments/c_new': () => ({ body: { data: { ...added, edited_at: '2026-10-28T10:00:00.000Z' } } }),
      'DELETE /api/v1/comments/c_new': () => ({ status: 204 }),
    });
    const stale = [COMMENTS, qk.activity.list({ item: 'wi_web_47', pages: 'all' }), qk.workItems.detail('wi_web_47')];
    const seed = () => stale.forEach((key) => queryClient.setQueryData(key, { items: [] }));
    const isStale = () => stale.map((key) => queryClient.getQueryState(key)?.isInvalidated);
    const { result } = renderHook(() => ({ add: useAddComment(), edit: useEditComment(), remove: useDeleteComment() }), { wrapper });

    seed();
    expect(await act(() => result.current.add.mutateAsync({ work_item_id: 'wi_web_47', body: added.body_json }))).toEqual(added);
    expect(isStale()).toEqual([true, true, true]);
    seed();
    await act(() => result.current.edit.mutateAsync({ id: 'c_new', body: added.body_json }));
    expect(isStale()).toEqual([true, true, true]);
    seed();
    await act(() => result.current.remove.mutateAsync('c_new'));
    expect(isStale()).toEqual([true, true, true]);
    expect(api.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /api/v1/work-items/wi_web_47/comments',
      'PATCH /api/v1/comments/c_new',
      'DELETE /api/v1/comments/c_new',
    ]);
  });

  describe('reactions', () => {
    const seed = (comments: Comment[]) => queryClient.setQueryData<Page<Comment>>(COMMENTS, { items: comments, next_cursor: null, total: comments.length });
    const cached = () => queryClient.getQueryData<Page<Comment>>(COMMENTS)!.items;

    it('shows the own reaction at once and takes the comment of the answer', async () => {
      const answered = makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida', 'u_theo', 'u_mara'] }] });
      let release!: () => void;
      api = mockApi({ 'PUT /api/v1/comments/c_web47_1/reactions': () => ({ body: { data: answered } }) });
      const held = globalThis.fetch;
      globalThis.fetch = (...args) => new Promise((resolve) => (release = () => resolve(held(...args))));
      seed(web47Comments);
      const { result } = renderHook(() => useToggleReaction(), { wrapper });

      act(() => result.current.toggle({ comment_id: 'c_web47_1', emoji: '👍', on: true }));
      await waitFor(() => expect(cached()[0]!.reactions).toEqual([{ emoji: '👍', user_ids: ['u_ida', 'u_theo', 'u_mara'] }]));
      expect(result.current.isPending('c_web47_1', '👍')).toBe(true);
      expect(result.current.isPending('c_web47_1', '🎉')).toBe(false);

      act(() => release());
      await waitFor(() => expect(result.current.isPending('c_web47_1', '👍')).toBe(false));
      expect(cached()[0]).toEqual(answered);
      expect(cached()[1]).toEqual(web47Comments[1]);
    });

    it('takes back the own reaction at once and drops an emoji nobody uses any more', async () => {
      api = mockApi({ 'DELETE /api/v1/comments/c_1/reactions': () => ({ body: { data: makeComment() } }) });
      seed([makeComment({ reactions: [{ emoji: '🎉', user_ids: ['u_mara'] }, { emoji: '👍', user_ids: ['u_mara', 'u_ida'] }] })]);
      // the comments of another item stay as they are
      const elsewhere = { items: [makeComment({ id: 'c_9', work_item_id: 'wi_ops_12' })], next_cursor: null, total: 1 };
      queryClient.setQueryData(qk.comments.list({ item: 'wi_ops_12', pages: 'all' }), elsewhere);
      const { result } = renderHook(() => useToggleReaction(), { wrapper });

      act(() => result.current.toggle({ comment_id: 'c_1', emoji: '🎉', on: false }));
      expect(cached()[0]!.reactions).toEqual([{ emoji: '👍', user_ids: ['u_mara', 'u_ida'] }]);
      act(() => result.current.toggle({ comment_id: 'c_1', emoji: '👍', on: false }));
      expect(cached()[0]!.reactions).toEqual([{ emoji: '👍', user_ids: ['u_ida'] }]);
      // a reaction that is there already stays as it is
      act(() => result.current.toggle({ comment_id: 'c_1', emoji: '👍', on: false }));
      expect(cached()[0]!.reactions).toEqual([{ emoji: '👍', user_ids: ['u_ida'] }]);
      await waitFor(() => expect(api!.calls).toHaveLength(3));
      expect(queryClient.getQueryData(qk.comments.list({ item: 'wi_ops_12', pages: 'all' }))).toBe(elsewhere);
    });

    it('rolls back a reaction the server refuses and reports each failure', async () => {
      api = mockApi({
        'PUT /api/v1/comments/c_web47_1/reactions': (body) =>
          (body as { emoji: string }).emoji === '🎉'
            ? { status: 409, body: { reason: 'archived', detail: 'WEB-47 ist archiviert.' } }
            : { status: 503, body: { reason: 'server_error', detail: 'Wartung' } },
        // a reaction that was there already stays when the call fails
        'PUT /api/v1/comments/c_web47_2/reactions': () => ({ status: 409, body: { reason: 'archived', detail: 'Schon da.' } }),
      });
      const mine = { ...web47Comments[1]!, reactions: [{ emoji: '🚀', user_ids: ['u_mara'] }] };
      seed([web47Comments[0]!, mine]);
      const { result } = renderHook(() => useToggleReaction(), { wrapper });

      act(() => {
        result.current.toggle({ comment_id: 'c_web47_1', emoji: '🎉', on: true });
        result.current.toggle({ comment_id: 'c_web47_1', emoji: '👍', on: true });
      });
      expect(cached()[0]!.reactions).toEqual([
        { emoji: '👍', user_ids: ['u_ida', 'u_theo', 'u_mara'] },
        { emoji: '🎉', user_ids: ['u_mara'] },
      ]);

      act(() => result.current.toggle({ comment_id: 'c_web47_2', emoji: '🚀', on: true }));

      await waitFor(() => expect(currentToasts()).toHaveLength(3));
      expect(cached()).toEqual([web47Comments[0], mine]);
      expect(currentToasts().map((toast) => [toast.title, toast.description, toast.action?.label])).toEqual([
        ['Reaktion 🎉 nicht gespeichert', 'WEB-47 ist archiviert.', undefined],
        ['Reaktion 👍 nicht gespeichert', 'Wartung', 'Erneut versuchen'],
        ['Reaktion 🚀 nicht gespeichert', 'Schon da.', undefined],
      ]);
    });

    it('takes the answer of a comment while a reaction to another one is on its way, and keeps two failures apart (F26, T15-M2)', async () => {
      const answered = makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida', 'u_theo', 'u_mara', 'u_lene'] }] });
      api = mockApi({
        'PUT /api/v1/comments/c_web47_1/reactions': () => ({ body: { data: answered } }),
        'PUT /api/v1/comments/c_web47_2/reactions': () => ({ status: 503, body: { reason: 'server_error', detail: 'Wartung' } }),
      });
      seed(web47Comments);
      // the reaction to the second comment hangs
      const held = globalThis.fetch;
      let release!: () => void;
      globalThis.fetch = (input, init) =>
        String(input).includes('c_web47_2') ? new Promise((resolve) => (release = () => resolve(held(input, init)))) : held(input, init);
      const { result } = renderHook(() => useToggleReaction(), { wrapper });

      act(() => {
        result.current.toggle({ comment_id: 'c_web47_2', emoji: '👍', on: true });
        result.current.toggle({ comment_id: 'c_web47_1', emoji: '👍', on: true });
      });
      // the answer for the first comment comes in, though the second one's call still runs (Lene reacted meanwhile)
      await waitFor(() => expect(cached()[0]).toEqual(answered));

      act(() => release());
      await waitFor(() => expect(currentToasts()).toHaveLength(1));
      // the same failure on another comment: a toast of its own, each with its own retry
      api.restore();
      api = mockApi({ 'DELETE /api/v1/comments/c_web47_1/reactions': () => ({ status: 503, body: { reason: 'server_error', detail: 'Wartung' } }) });
      act(() => result.current.toggle({ comment_id: 'c_web47_1', emoji: '👍', on: false }));
      await waitFor(() => expect(currentToasts()).toHaveLength(2));
      expect(currentToasts().map((toast) => [toast.subject, toast.title, toast.action?.label])).toEqual([
        ['reaction:c_web47_2:👍', 'Reaktion 👍 nicht gespeichert', 'Erneut versuchen'],
        ['reaction:c_web47_1:👍', 'Reaktion 👍 nicht gespeichert', 'Erneut versuchen'],
      ]);
    });

    it('offers to try again after an outage, with the same reaction', async () => {
      let status = 503;
      const restored = makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida', 'u_theo'] }] });
      api = mockApi({
        'DELETE /api/v1/comments/c_web47_1/reactions': () => (status === 503 ? { status, body: { reason: 'server_error' } } : { body: { data: { ...restored, reactions: [] } } }),
      });
      seed(web47Comments);
      const { result } = renderHook(() => useToggleReaction(), { wrapper });

      act(() => result.current.toggle({ comment_id: 'c_web47_1', emoji: '👍', on: false }));
      await waitFor(() => expect(currentToasts()).toHaveLength(1));
      expect(cached()).toEqual(web47Comments);

      status = 200;
      act(() => currentToasts()[0]!.action!.onClick());
      await waitFor(() => expect(cached()[0]!.reactions).toEqual([]));
      expect(api.calls.at(-1)!.url).toBe(`/api/v1/comments/c_web47_1/reactions?emoji=${encodeURIComponent('👍')}`);
    });
  });
});

describe('attachments', () => {
  it('reads an attachment once and keeps it fresh, and puts those that came with something else into the cache', async () => {
    const picture = makeAttachment();
    const file = makeAttachment({ id: 'att_2', kind: 'file' });
    api = mockApi({ 'GET /api/v1/attachments/att_1': () => ({ body: { data: picture } }) });
    const listOf = [file];
    const { result, rerender } = renderHook(({ id }) => ({ one: useAttachment(id), none: useAttachment(null), prime: usePrimeAttachments(listOf) }), {
      wrapper,
      initialProps: { id: 'att_1' },
    });

    await waitFor(() => expect(result.current.one.data).toEqual(picture));
    rerender({ id: 'att_2' });
    expect(result.current.one.data).toEqual(file);
    rerender({ id: 'att_1' });
    expect(result.current.none.fetchStatus).toBe('idle');
    expect(api.calls).toHaveLength(1);
    expect(queryClient.getQueryCache().find({ queryKey: qk.attachments.detail('att_1') })?.isStale()).toBe(false);
    // the preview and the owner come later: after a while the record is read again
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + ATTACHMENT_FRESH_MS - 1000);
      rerender({ id: 'att_1' });
      expect(result.current.one.isStale).toBe(false);
      vi.setSystemTime(Date.now() + 2000);
      rerender({ id: 'att_1' });
      expect(result.current.one.isStale).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uploads with progress and puts the answer into the cache, deletes and makes the item stale', async () => {
    installFakeXhr();
    try {
      const picture = makeAttachment();
      api = mockApi({ 'DELETE /api/v1/attachments/att_1': () => ({ status: 204 }) });
      const onProgress = vi.fn();
      const listed = makeAttachment({ id: 'att_1', kind: 'file', owner: { type: 'work_item', id: 'wi_web_47' } });
      const other = makeAttachment({ id: 'att_3', kind: 'file', owner: { type: 'work_item', id: 'wi_web_47' } });
      queryClient.setQueryData(qk.workItems.detail('wi_web_47'), { item: web47, attachments: [listed, other] });
      queryClient.setQueryData(qk.workItems.detail('WEB-47'), { item: web47, attachments: [listed] });
      const { result } = renderHook(() => ({ upload: useUploadAttachment(), remove: useDeleteAttachment() }), { wrapper });

      let call!: Promise<unknown>;
      act(() => {
        call = result.current.upload.mutateAsync({ project_id: 'p_web', file: new File(['x'], 'x.png'), owner: null, kind: 'inline', onProgress });
      });
      await waitFor(() => expect(FakeXhr.last?.sent).not.toBeNull());
      FakeXhr.last.progress(1, 4);
      FakeXhr.last.answer(201, { data: picture });
      expect(await call).toEqual(picture);
      expect(onProgress).toHaveBeenCalledWith(0.25);
      expect(queryClient.getQueryData(qk.attachments.detail('att_1'))).toEqual(picture);

      await act(() => result.current.remove.mutateAsync('att_1'));
      expect(queryClient.getQueryState(qk.workItems.detail('wi_web_47'))?.isInvalidated).toBe(true);
      // the file leaves every cached detail at once, also one cached under the key
      expect(queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail('wi_web_47'))?.attachments).toEqual([other]);
      expect(queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail('WEB-47'))?.attachments).toEqual([]);
      // a deleted attachment leaves the cache
      expect(queryClient.getQueryData(qk.attachments.detail('att_1'))).toBeUndefined();
    } finally {
      restoreFakeXhr();
    }
  });
});

describe('uploads into the file list', () => {
  it('makes the item stale after a file of the list, not after a picture of a text (T15-M4)', async () => {
    installFakeXhr();
    try {
      queryClient.setQueryData(qk.workItems.detail('wi_web_47'), { item: web47, attachments: [] });
      const { result } = renderHook(() => useUploadAttachment(), { wrapper });
      const upload = async (kind: 'inline' | 'file', answer: ReturnType<typeof makeAttachment>) => {
        let call!: Promise<unknown>;
        act(() => {
          call = result.current.mutateAsync({ project_id: 'p_web', file: new File(['x'], 'x.png'), owner: kind === 'file' ? { type: 'work_item', id: 'wi_web_47' } : null, kind });
        });
        await waitFor(() => expect(FakeXhr.last?.sent).not.toBeNull());
        FakeXhr.last.answer(201, { data: answer });
        await act(() => call);
      };

      await upload('inline', makeAttachment());
      expect(queryClient.getQueryState(qk.workItems.detail('wi_web_47'))?.isInvalidated).toBe(false);
      await upload('file', makeAttachment({ id: 'att_2', kind: 'file', owner: { type: 'work_item', id: 'wi_web_47' } }));
      expect(queryClient.getQueryState(qk.workItems.detail('wi_web_47'))?.isInvalidated).toBe(true);
    } finally {
      restoreFakeXhr();
    }
  });

  it('refuses a file of the list without its item at once (T15-M6)', async () => {
    installFakeXhr();
    try {
      await expect(uploadAttachment('p_web', new File(['x'], 'x.pdf'), null, 'file')).rejects.toThrow(TypeError);
      expect(FakeXhr.all).toEqual([]);
    } finally {
      restoreFakeXhr();
    }
  });

  it('puts back only the XMLHttpRequest, never what other tests stubbed (T15-M5)', () => {
    vi.stubGlobal('Notification', 'stubbed');
    const real = globalThis.XMLHttpRequest;
    installFakeXhr();
    expect(globalThis.XMLHttpRequest).toBe(FakeXhr);
    restoreFakeXhr();
    expect(globalThis.XMLHttpRequest).toBe(real);
    expect((globalThis as { Notification?: unknown }).Notification).toBe('stubbed');
    vi.unstubAllGlobals();
  });
});

describe('mentions and references', () => {
  it('lists who can be mentioned, keeping the last list while the next one loads', async () => {
    let answer: User[] = [ida, mara];
    api = mockApi({ 'GET /api/v1/mentions': () => ({ body: { data: answer } }) });
    const { result, rerender } = renderHook(({ q, enabled }) => useMentionables('p_web', q, enabled), { wrapper, initialProps: { q: '', enabled: false } });

    expect(result.current.fetchStatus).toBe('idle');
    rerender({ q: '', enabled: true });
    await waitFor(() => expect(result.current.data).toEqual([ida, mara]));
    answer = [ida];
    rerender({ q: 'i', enabled: true });
    expect(result.current.data).toEqual([ida, mara]);
    await waitFor(() => expect(result.current.data).toEqual([ida]));
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/mentions?project=p_web&q=', '/api/v1/mentions?project=p_web&q=i']);
  });

  it('batches the references of one tick into one request', async () => {
    const other = { ...web47, id: 'wi_web_42', key: 'WEB-42' };
    api = mockApi({ 'GET /api/v1/references': () => ({ body: { data: { items: [web47, ops12, other] } } }) });
    const { result } = renderHook(() => [useItemRef('wi_web_47'), useItemRef('wi_ops_12'), useItemRef('wi_web_42'), useItemRef('wi_web_47'), useItemRef(null)], { wrapper });

    await waitFor(() => expect(result.current.slice(0, 4).every((ref) => ref.isSuccess)).toBe(true));
    expect(result.current.map((ref) => ref.data?.key)).toEqual(['WEB-47', 'OPS-12', 'WEB-42', 'WEB-47', undefined]);
    expect(api.calls.map((call) => decodeURIComponent(call.url))).toEqual(['/api/v1/references?items=wi_web_47,wi_ops_12,wi_web_42']);
    expect(queryClient.getQueryData(qk.references.item('wi_ops_12'))).toEqual(ops12);
  });

  it('resolves items and pages of a tick in one request', async () => {
    const structure = pageSummary(seitenstruktur);
    api = mockApi({ 'GET /api/v1/references': () => ({ body: { data: { items: [web47], pages: [structure] } } }) });
    const { result } = renderHook(() => ({ item: useItemRef('wi_web_47'), page: usePageRef('pg_web_structure'), hidden: usePageRef('pg_ops_servers'), none: usePageRef(null) }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.hidden.isError).toBe(true));
    expect(result.current.item.data).toEqual(web47);
    expect(result.current.page.data).toEqual(structure);
    expect(result.current.hidden.error).toMatchObject({ status: 404, reason: 'not_found' });
    expect(result.current.none.fetchStatus).toBe('idle');
    expect(api.calls.map((call) => decodeURIComponent(call.url))).toEqual(['/api/v1/references?items=wi_web_47&pages=pg_web_structure,pg_ops_servers']);
    expect(queryClient.getQueryData(qk.references.page('pg_web_structure'))).toEqual(structure);
  });

  it('asks only for pages when a tick names no item, and counts both kinds into the hundred of a request', async () => {
    const pages = Array.from({ length: 60 }, (_, index) => `pg_${String(index).padStart(2, '0')}`);
    const items = Array.from({ length: 60 }, (_, index) => `wi_${String(index).padStart(2, '0')}`);
    api = mockApi({
      'GET /api/v1/references': (_body, url) => ({
        body: {
          data: {
            items: (url.searchParams.get('items')?.split(',') ?? []).map((id) => ({ ...web47, id })),
            pages: (url.searchParams.get('pages')?.split(',') ?? []).map((id) => ({ ...pageSummary(seitenstruktur), id })),
          },
        },
      }),
    });
    primePageRef({ ...pageSummary(seitenstruktur), id: 'pg_primed' }, queryClient);
    const first = renderHook(() => [usePageRef('pg_web_structure'), usePageRef('pg_primed')], { wrapper });
    await waitFor(() => expect(first.result.current.every((ref) => ref.isSuccess)).toBe(true));
    const second = renderHook(() => [...pages.map((id) => usePageRef(id)), ...items.map((id) => useItemRef(id))], { wrapper });
    await waitFor(() => expect(second.result.current.every((ref) => ref.isSuccess)).toBe(true));

    const asked = api.calls.map((call) => new URL(call.url, 'http://werkbuch.test').searchParams);
    expect(asked.map((query) => [query.get('items')?.split(',').length ?? 0, query.get('pages')?.split(',').length ?? 0])).toEqual([
      [0, 1],
      [40, 60],
      [20, 0],
    ]);
    expect(second.result.current[0]!.data?.id).toBe('pg_00');
    expect(second.result.current[119]!.data?.id).toBe('wi_59');
  });

  it('marks a reference the server leaves out as hidden', async () => {
    api = mockApi({ 'GET /api/v1/references': () => ({ body: { data: { items: [web47] } } }) });
    const { result } = renderHook(() => [useItemRef('wi_web_47'), useItemRef('wi_hidden')], { wrapper });

    await waitFor(() => expect(result.current[1]!.isError).toBe(true));
    expect(result.current[1]!.error).toBeInstanceOf(ApiError);
    expect(result.current[1]!.error).toMatchObject({ status: 404, reason: 'not_found' });
    expect(result.current[0]!.data).toEqual(web47);
  });

  it('fails every reference of a request that fails, splits large requests and skips what was primed', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `wi_${String(index).padStart(3, '0')}`);
    api = mockApi({
      'GET /api/v1/references': (_body, url) => {
        const asked = url.searchParams.get('items')!.split(',');
        return asked.length === 1 ? { status: 500, body: { reason: 'server_error' } } : { body: { data: { items: asked.map((id) => ({ ...web47, id })) } } };
      },
    });
    primeItemRef({ ...ops12 } as ListedItem, queryClient);
    const { result } = renderHook(() => [...ids.map((id) => useItemRef(id)), useItemRef('wi_ops_12')], { wrapper });

    await waitFor(() => expect(result.current.every((ref) => ref.isSuccess || ref.isError)).toBe(true));
    expect(api.calls.map((call) => call.url.split('items=')[1]!.split('%2C').length)).toEqual([100, 1]);
    expect(result.current[0]!.data?.id).toBe('wi_000');
    expect(result.current[100]!.error).toMatchObject({ status: 500 });
    expect(result.current[101]!.data).toEqual(ops12);
  });
});
