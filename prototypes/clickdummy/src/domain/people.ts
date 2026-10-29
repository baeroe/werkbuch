/*
 * Who can take an item of a project and be mentioned in it (spec 4.2, 4.8, 4.16). One rule for the API, the pickers,
 * the mentions and the board: the active members of the project, people and bots, and active people who are org
 * admins (they have access to every project). A bot only as a member: the default bot is an org admin just so that
 * automations may act everywhere, and it is offered where it is a member itself.
 */

import type { User } from '@/types';

/** Whether an account can take work in a project it is (or is not) a member of. */
export function canTakeWork(user: Pick<User, 'type' | 'org_role' | 'disabled_at'>, isMember: boolean): boolean {
  if (user.disabled_at !== null) return false;
  return isMember || (user.type === 'person' && user.org_role === 'admin');
}
