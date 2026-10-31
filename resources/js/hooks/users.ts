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
import { useSharedProps } from '@/lib/page';
import type { OrgRole, User } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** All accounts, deactivated ones included (history and old assignments point to them). */
export function useUsers(args: ListUsersArgs = {}) {
  return useQuery({ queryKey: qk.users.list(args), queryFn: () => listUsers(args) });
}

/** The signed-in account as the page brought it along (shared props), or undefined on a guest page. */
export function useCurrentUser(): User | undefined {
  return useSharedProps().auth.user ?? undefined;
}

export function useInvitations() {
  return useQuery({ queryKey: qk.invitations.all, queryFn: listInvitations });
}

export function useInviteUser() {
  return useApiMutation(inviteUser, [qk.invitations.all]);
}

export function useUpdateUserRole() {
  return useApiMutation(({ user_id, org_role }: { user_id: string; org_role: OrgRole }) => updateUserRole(user_id, org_role), [qk.users.all]);
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
