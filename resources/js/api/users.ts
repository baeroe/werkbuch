/*
 * People and bots (spec 4.2). Admins manage accounts; accounts are deactivated, never deleted. The last active admin
 * among the people can neither be demoted nor deactivated; the default bot does not count and cannot be deactivated.
 */

import type { Invitation, OrgRole, ProjectRole, User } from '@/types';
import type { Page } from './client';
import { getPage, one, patch as sendPatch, post, put } from './http';

export interface ListUsersArgs {
  type?: User['type'];
}

/** All accounts, deactivated ones included (history and old assignments still point to them). People come first. */
export function listUsers(args: ListUsersArgs = {}): Promise<Page<User>> {
  return getPage<User>('/users', { ...args });
}

export interface InviteUserInput {
  email: string;
  org_role: OrgRole;
  /** Projects to join, with the role there. */
  projects?: { project_id: string; role: ProjectRole }[];
}

/** Invites by e-mail. Answers the link (valid for 7 days); a new invitation replaces the old one for that address. */
export function inviteUser(input: InviteUserInput): Promise<{ link: string; invitation: Invitation }> {
  return post<{ link: string; invitation: Invitation }>('/invitations', input);
}

/** The invitations that have not been accepted yet (admins). */
export function listInvitations(): Promise<Page<Invitation>> {
  return getPage<Invitation>('/invitations');
}

export function updateUserRole(user_id: string, org_role: OrgRole): Promise<User> {
  return one(put<{ data: User }>(`/users/${user_id}/role`, { org_role }));
}

/** Deactivates an account: tokens are revoked, sessions end, history and assignments stay. */
export function deactivateUser(user_id: string): Promise<User> {
  return one(post<{ data: User }>(`/users/${user_id}/deactivate`));
}

export function reactivateUser(user_id: string): Promise<User> {
  return one(post<{ data: User }>(`/users/${user_id}/reactivate`));
}

export interface CreateBotInput {
  name: string;
  handle: string;
  description?: string;
  /** The responsible person; the signed-in admin when omitted. */
  owner_id?: string;
}

export function createBot(input: CreateBotInput): Promise<User> {
  return one(post<{ data: User }>('/bots', input));
}

export type UpdateUserPatch = Partial<Pick<User, 'name' | 'handle' | 'email' | 'locale' | 'timezone' | 'avatar_url' | 'description' | 'owner_id'>>;

/** The profile of a person (themselves) or of anybody (admins): name, handle, language, time zone, avatar. */
export function updateUser(user_id: string, patch: UpdateUserPatch): Promise<User> {
  return one(sendPatch<{ data: User }>(`/users/${user_id}`, patch));
}
