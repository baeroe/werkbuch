/*
 * What the field editors and the item building blocks read besides the item itself: whether the signed-in person may
 * change it, its project and workflow, the people who can take it, and today in the organisation's time zone. All of
 * it comes from cached catalog queries, so a list of a hundred rows asks the fake API once.
 */

import { useMemo } from 'react';
import { useOrganization } from '@/hooks/organization';
import { useMembers, useProjects } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { canTakeWork } from '@/domain/people';
import { today } from '@/lib/clock';
import { usePermissions } from '@/lib/permissions';
import type { ProjectMember, User, WorkItem } from '@/types';

const COLLATOR = new Intl.Collator('de-DE');

/** Why the archived item cannot change (spec 4.8: archived items are read-only). */
export const archivedReason = (key: string) => `${key} ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.`;

/** Why the signed-in person cannot change this item right now, or null when they can. */
export function useEditReason(item: Pick<WorkItem, 'key' | 'project_id' | 'archived_at'>): string | null {
  const { reason } = usePermissions();
  return item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id);
}

/** The project of an item and its workflow, plus the loading state of both. */
export function useItemWorkflow(item: Pick<WorkItem, 'project_id'>) {
  const projects = useProjects({ include_archived: true });
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
  return { today: today(organization?.timezone ?? 'Europe/Berlin'), weekStart: organization?.week_start ?? 1 };
}

/** All accounts by id (deactivated ones included: old assignments still point to them). */
export function useUserMap(): Map<string, User> {
  const users = useUsers().data?.items;
  return useMemo(() => new Map((users ?? []).map((user) => [user.id, user])), [users]);
}

/**
 * Who can take an item of a project and be mentioned in it (spec 4.2, 4.8, 4.16, `canTakeWork`): its active members,
 * people and bots, and the active people who are org admins. A bot only as a member, the default bot too. People
 * first, then bots, each by name. The API assigns the same accounts (`canBeAssigned`).
 */
export function projectPeople(users: readonly User[], members: readonly ProjectMember[], projectId: string): User[] {
  const memberIds = new Set(members.filter((member) => member.project_id === projectId).map((member) => member.user_id));
  return users
    .filter((user) => canTakeWork(user, memberIds.has(user.id)))
    .sort((a, b) => (a.type === b.type ? COLLATOR.compare(a.name, b.name) : a.type === 'person' ? -1 : 1));
}

/** `projectPeople` of a project, with the loading state of what it reads. */
export function useProjectPeople(projectId: string) {
  const members = useMembers(projectId);
  const users = useUsers();
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
