import { router } from '@inertiajs/react';
import { useQuery } from '@tanstack/react-query';
import {
  createBot,
  deactivateUser,
  inviteUser,
  listInvitations,
  listUsers,
  reactivateUser,
  updateUser,
  updateUserRole,
  type ListUsersArgs,
  type UpdateUserPatch,
} from '@/api/users';
import type { Page } from '@/api/client';
import { useSharedProps } from '@/lib/page';
import type { OrgRole, User } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';
import { allPages } from './pages';

/** All accounts, deactivated ones included (history and old assignments point to them). */
export function useUsers(args: ListUsersArgs = {}) {
  return useQuery({ queryKey: qk.users.list(args), queryFn: () => listUsers(args) });
}

/**
 * All accounts of every page (`next_cursor` followed to the end), for the screens that must show every one of them:
 * the people and bots of the settings, the responsible person of a bot. One page holds at most 100.
 */
export function useAllUsers(args: Omit<ListUsersArgs, 'cursor' | 'per_page'> = {}) {
  return useQuery({
    queryKey: qk.users.list({ ...args, pages: 'all' }),
    queryFn: (): Promise<Page<User>> => allPages((cursor) => listUsers({ ...args, cursor })),
  });
}

/** The signed-in account as the page brought it along (shared props), or undefined on a guest page. */
export function useCurrentUser(): User | undefined {
  return useSharedProps().auth.user ?? undefined;
}

/** Every open invitation, all pages: a list that stops at the first hundred would hide the newest ones. */
export function useInvitations() {
  return useQuery({ queryKey: qk.invitations.all, queryFn: () => allPages((cursor) => listInvitations({ cursor })) });
}

export function useInviteUser() {
  return useApiMutation(inviteUser, [qk.invitations.all]);
}

/**
 * A change of the own role reloads the page (the shared props carry the role) and the projects (their `my_role`), so
 * the rights of the interface follow it at once.
 */
export function useUpdateUserRole() {
  const me = useCurrentUser();
  const own = (user_id: string) => user_id === me?.id;
  return useApiMutation(
    ({ user_id, org_role }: { user_id: string; org_role: OrgRole }) => updateUserRole(user_id, org_role),
    (_user, { user_id }) => (own(user_id) ? [qk.users.all, qk.projects.all] : [qk.users.all]),
    {
      onSuccess: (_user, { user_id }) => {
        if (own(user_id)) router.reload();
      },
    },
  );
}

export function useDeactivateUser() {
  return useApiMutation(deactivateUser, [qk.users.all, qk.tokens.all, qk.workItems.all]);
}

export function useReactivateUser() {
  return useApiMutation(reactivateUser, [qk.users.all]);
}

export function useCreateBot() {
  return useApiMutation(createBot, [qk.users.all]);
}

/** A change of the own profile reloads the page: the shared props (name, avatar) and the language follow it. */
export function useUpdateUser() {
  const me = useCurrentUser();
  return useApiMutation(({ user_id, patch }: { user_id: string; patch: UpdateUserPatch }) => updateUser(user_id, patch), [qk.users.all], {
    onSuccess: (_user, { user_id }) => {
      if (user_id === me?.id) router.reload();
    },
  });
}
