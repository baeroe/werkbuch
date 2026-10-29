/*
 * People and bots (spec 4.2). Admins manage accounts; accounts are deactivated, never deleted. The last active admin
 * among the people can neither be demoted nor deactivated; the default bot does not count and cannot be deactivated.
 */

import type { Invitation, OrgRole, ProjectRole, User } from '@/types';
import { isOrgAdmin, requireOrgAdmin } from './access';
import { conflict, FieldErrors, forbidden, newId, notFound, paginate, read, write, type Page } from './client';
import type { Db } from './db';

const HANDLE = /^[a-z0-9-]{3,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_DAYS = 7;

export interface ListUsersArgs {
  type?: User['type'];
}

/** All accounts, deactivated ones included (history and old assignments still point to them). People come first. */
export function listUsers(args: ListUsersArgs = {}): Promise<Page<User>> {
  return read(({ db }) => paginate(db.users.filter((user) => !args.type || user.type === args.type)));
}

function requireUser(db: Db, id: string): User {
  const user = db.users.find((entry) => entry.id === id);
  if (!user) throw notFound('Das Konto');
  return user;
}

/** Whether the person is an admin who is active and a person: the ones the "last admin" rule counts. */
const isActiveAdminPerson = (user: User) => user.type === 'person' && user.org_role === 'admin' && user.disabled_at === null;

function handleErrors(db: Db, errors: FieldErrors, handle: string, ownId: string | null): void {
  if (!HANDLE.test(handle)) errors.add('handle', 'Das Kürzel hat 3 bis 32 Zeichen: a–z, 0–9 und -.');
  else if (db.users.some((user) => user.id !== ownId && user.handle === handle)) errors.add('handle', 'Dieses Kürzel ist schon vergeben.');
}

export interface InviteUserInput {
  email: string;
  org_role: OrgRole;
  /** Projects to join, with the role there. */
  projects?: { project_id: string; role: ProjectRole }[];
}

/** Invites by e-mail. Answers the link (valid for 7 days); a new invitation replaces the old one for that address. */
export function inviteUser(input: InviteUserInput): Promise<{ link: string; invitation: Invitation }> {
  return write(({ db, me, now, stamp }) => {
    requireOrgAdmin(me, 'Einladen dürfen nur Org-Admins.');
    const email = input.email.trim().toLowerCase();
    const errors = new FieldErrors();
    if (!EMAIL.test(email)) errors.add('email', 'Das ist keine gültige E-Mail-Adresse.');
    else if (db.users.some((user) => user.email?.toLowerCase() === email)) errors.add('email', 'Zu dieser Adresse gibt es schon ein Konto.');
    for (const entry of input.projects ?? []) {
      if (!db.projects.some((project) => project.id === entry.project_id)) errors.add('projects', 'Mindestens ein Projekt gibt es nicht.');
    }
    errors.throwIfAny();

    const token = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
    const origin = typeof window === 'undefined' ? 'https://werkbuch.example.com' : window.location.origin;
    const invitation: Invitation = {
      id: newId('inv'),
      email,
      org_role: input.org_role,
      projects: (input.projects ?? []).map((entry) => ({ ...entry })),
      link: `${origin}/invitations/${token}`,
      created_by: me.id,
      created_at: stamp,
      expires_at: new Date(now.getTime() + INVITATION_DAYS * 86_400_000).toISOString(),
    };
    db.invitations = db.invitations.filter((entry) => entry.email !== email);
    db.invitations.push(invitation);
    return { link: invitation.link, invitation };
  });
}

/** The invitations that have not been accepted yet (admins). */
export function listInvitations(): Promise<Page<Invitation>> {
  return read(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Einladungen sehen nur Org-Admins.');
    return paginate(db.invitations.filter((invitation) => invitation.expires_at > stamp));
  });
}

export function updateUserRole(user_id: string, org_role: OrgRole): Promise<User> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Rollen ändern nur Org-Admins.');
    const user = requireUser(db, user_id);
    if (user.is_default_bot) throw conflict('default_bot', 'Der Standard-Bot hat immer die Rolle Admin.');
    if (isActiveAdminPerson(user) && org_role !== 'admin' && !db.users.some((other) => other.id !== user.id && isActiveAdminPerson(other))) {
      throw conflict('last_admin', 'Das ist der letzte aktive Admin. Mache zuerst jemand anderen zum Admin.');
    }
    user.org_role = org_role;
    return user;
  });
}

/** Deactivates an account: tokens are revoked, history and assignments stay. */
export function deactivateUser(user_id: string): Promise<User> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Konten deaktivieren nur Org-Admins.');
    const user = requireUser(db, user_id);
    if (user.is_default_bot) throw conflict('default_bot', 'Der Standard-Bot lässt sich nicht deaktivieren.');
    if (isActiveAdminPerson(user) && !db.users.some((other) => other.id !== user.id && isActiveAdminPerson(other))) {
      throw conflict('last_admin', 'Das ist der letzte aktive Admin. Mache zuerst jemand anderen zum Admin.');
    }
    user.disabled_at = user.disabled_at ?? stamp;
    db.tokens = db.tokens.filter((token) => token.user_id !== user.id);
    return user;
  });
}

export function reactivateUser(user_id: string): Promise<User> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Konten aktivieren nur Org-Admins.');
    const user = requireUser(db, user_id);
    user.disabled_at = null;
    return user;
  });
}

export interface CreateBotInput {
  name: string;
  handle: string;
  description?: string;
  /** The responsible person; the signed-in admin when omitted. */
  owner_id?: string;
}

export function createBot(input: CreateBotInput): Promise<User> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Bots anlegen nur Org-Admins.');
    const errors = new FieldErrors();
    if (input.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    handleErrors(db, errors, input.handle, null);
    const ownerId = input.owner_id ?? me.id;
    if (!db.users.some((user) => user.id === ownerId && user.type === 'person')) errors.add('owner_id', 'Die verantwortliche Person gibt es nicht.');
    errors.throwIfAny();

    const bot: User = {
      // an id of its own: a handle can change and be taken again, an id never
      id: newId('u'),
      type: 'bot',
      name: input.name.trim(),
      handle: input.handle,
      email: null,
      org_role: 'member',
      is_default_bot: false,
      owner_id: ownerId,
      description: input.description?.trim() ?? '',
      disabled_at: null,
      avatar_url: null,
      locale: db.organization.locale,
      timezone: db.organization.timezone,
    };
    db.users.push(bot);
    return bot;
  });
}

export type UpdateUserPatch = Partial<Pick<User, 'name' | 'handle' | 'email' | 'locale' | 'timezone' | 'avatar_url' | 'description' | 'owner_id'>>;

/** The profile of a person (themselves) or of anybody (admins): name, handle, language, time zone, avatar. */
export function updateUser(user_id: string, patch: UpdateUserPatch): Promise<User> {
  return write(({ db, me }) => {
    const user = requireUser(db, user_id);
    if (user.id !== me.id && !isOrgAdmin(me)) throw forbidden('Fremde Profile ändern nur Org-Admins.');
    const errors = new FieldErrors();

    if (patch.name !== undefined && patch.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    if (patch.handle !== undefined) handleErrors(db, errors, patch.handle, user.id);
    if (patch.email !== undefined) {
      if (user.type === 'bot') errors.add('email', 'Bots haben keine E-Mail-Adresse.');
      else if (!EMAIL.test(patch.email ?? '')) errors.add('email', 'Das ist keine gültige E-Mail-Adresse.');
      else if (db.users.some((other) => other.id !== user.id && other.email?.toLowerCase() === patch.email?.toLowerCase())) errors.add('email', 'Diese Adresse ist schon vergeben.');
    }
    if (patch.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('de', { timeZone: patch.timezone });
      } catch {
        errors.add('timezone', 'Diese Zeitzone gibt es nicht.');
      }
    }
    if (patch.owner_id !== undefined && patch.owner_id !== null && !db.users.some((other) => other.id === patch.owner_id && other.type === 'person')) {
      errors.add('owner_id', 'Die verantwortliche Person gibt es nicht.');
    }
    errors.throwIfAny();

    if (patch.name !== undefined) user.name = patch.name.trim();
    if (patch.handle !== undefined) user.handle = patch.handle;
    if (patch.email !== undefined) user.email = patch.email;
    if (patch.locale !== undefined) user.locale = patch.locale;
    if (patch.timezone !== undefined) user.timezone = patch.timezone;
    if (patch.avatar_url !== undefined) user.avatar_url = patch.avatar_url;
    if (patch.description !== undefined) user.description = patch.description;
    if (patch.owner_id !== undefined) user.owner_id = patch.owner_id;
    return user;
  });
}
