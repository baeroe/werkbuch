/*
 * What the field editors and the item building blocks read besides the item itself: whether the signed-in person may
 * change it, its project and workflow, the people who can take it, and today in the organisation's time zone. All of
 * it comes from cached catalog queries, so a list of a hundred rows asks the API once.
 */

import { useMemo } from 'react';
import { canTakeWork } from '@/domain/people';
import { cachedZone } from '@/domain/tz';
import { useOrganization } from '@/hooks/organization';
import { useMembers, useMembersOf, useProjectsWith } from '@/hooks/projects';
import { useAllUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { intlLocale, t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import type { ListedItem, ProjectMember, User } from '@/types';

/** Why the archived item cannot change (spec 4.8: archived items are read-only). */
export const archivedReason = (key: string) => t('items.fields.archived', { key });

/**
 * Why the signed-in person cannot change this item right now, or null when they can: an archived item, a role without
 * `item.edit` (a viewer), an archived project, or rights that are still loading.
 */
export function useEditReason(item: Pick<ListedItem, 'key' | 'project_id' | 'archived_at'>): string | null {
  // a project the cached list lacks (just created or joined) loads the list again
  useProjectsWith(item.project_id);
  const { reason } = usePermissions();
  return item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id);
}

/** The project of an item and its workflow, plus the loading state of both. */
export function useItemWorkflow(item: Pick<ListedItem, 'project_id'>) {
  const projects = useProjectsWith(item.project_id);
  const workflows = useWorkflows();
  const project = projects.data?.items.find((entry) => entry.id === item.project_id);
  const workflow = project ? workflows.data?.items.find((entry) => entry.id === project.workflow_id) : undefined;
  return {
    project,
    workflow,
    isLoading: projects.isPending || workflows.isPending,
    error: projects.error ?? workflows.error,
    retry: () => void Promise.all([projects.refetch(), workflows.refetch()]),
    retrying: projects.isFetching || workflows.isFetching,
  };
}

/** Today ('YYYY-MM-DD') and the first day of the week, both as the organisation counts them. */
export function useToday(): { today: string; weekStart: 0 | 1 } {
  const organization = useOrganization().data;
  return { today: cachedZone(organization.timezone).date(new Date()), weekStart: organization.week_start };
}

/** All accounts by id (deactivated ones included: old assignments still point to them). */
export function useUserMap(): Map<string, User> {
  const users = useAllUsers().data?.items;
  return useMemo(() => new Map((users ?? []).map((user) => [user.id, user])), [users]);
}

/**
 * Who can take an item of a project (spec 4.2, 4.8, 4.16, `canTakeWork`): its active members, people and bots, and
 * the active people who are org admins. A bot only as a member, the default bot too. People first, then bots, each by
 * name. The API assigns the same accounts (`Assignable`).
 */
export function projectPeople(users: readonly User[], members: readonly ProjectMember[], projectId: string): User[] {
  const collator = new Intl.Collator(intlLocale());
  const memberIds = new Set(members.filter((member) => member.project_id === projectId).map((member) => member.user_id));
  return users
    .filter((user) => canTakeWork(user, memberIds.has(user.id)))
    .sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'person' ? -1 : 1));
}

/** `projectPeople` of a project (its members over `listMembers` and the org admins), with the loading state of both. */
export function useProjectPeople(projectId: string) {
  const members = useMembers(projectId);
  const users = useAllUsers();
  const memberList = members.data?.items;
  const userList = users.data?.items;

  const people = useMemo(() => (memberList && userList ? projectPeople(userList, memberList, projectId) : undefined), [memberList, userList, projectId]);

  return {
    people,
    isLoading: members.isPending || users.isPending,
    error: members.error ?? users.error,
    retry: () => void Promise.all([members.refetch(), users.refetch()]),
    retrying: members.isFetching || users.isFetching,
  };
}

/**
 * Who can take an item of every one of these projects (`projectPeople` of each, in the order of the first): the people a
 * change of several items offers. Undefined until everything has loaded, and without projects.
 */
export function useCommonPeople(projectIds: readonly string[]) {
  const members = useMembersOf(projectIds);
  const users = useAllUsers();
  const userList = users.data?.items;
  const lists = members.map((query) => query.data?.items);
  const loaded = userList !== undefined && projectIds.length > 0 && lists.every((entry) => entry !== undefined);
  const each = loaded ? projectIds.map((projectId, index) => projectPeople(userList, lists[index]!, projectId)) : [];
  const people = loaded ? each[0]!.filter((user) => each.every((others) => others.some((other) => other.id === user.id))) : undefined;
  const failed = [...members, users].filter((query) => query.isError);
  return {
    people,
    error: failed[0]?.error ?? null,
    retry: () => failed.forEach((query) => void query.refetch()),
  };
}
