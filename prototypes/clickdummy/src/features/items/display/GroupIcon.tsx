/*
 * The mark before a group's name (list section, table group, board column): the status icon, the category's shape, the
 * pen strokes of a priority, the type glyph, a label's dot, a person's avatar or the project badge. Decorative: the
 * group's name stands next to it.
 */

import { Layers } from 'lucide-react';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { NONE_KEY } from '@/domain/grouping';
import { useLabels } from '@/hooks/catalog';
import { useProjects } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { GroupBy, Priority, StateCategory, StateIcon } from '@/types';

/** The shape that stands for a category, from the fixed set of status shapes. */
export const CATEGORY_ICONS: Record<StateCategory, StateIcon> = {
  backlog: 'dashed',
  unstarted: 'circle',
  started: 'half',
  completed: 'check',
  canceled: 'cross',
};

export function GroupIcon({ groupBy, groupKey }: { groupBy: GroupBy; groupKey: string }) {
  const workflows = useWorkflows().data?.items;
  const users = useUsers().data?.items;
  const types = useWorkItemTypes().data?.items;
  const labels = useLabels().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;

  let mark = null;
  switch (groupBy) {
    case 'state': {
      const state = workflows?.flatMap((workflow) => workflow.states).find((entry) => entry.id === groupKey);
      mark = state ? <StatusIcon icon={state.icon} category={state.category} label={state.name} /> : null;
      break;
    }
    case 'category': {
      const category = groupKey as StateCategory;
      mark = CATEGORY_ICONS[category] ? <StatusIcon icon={CATEGORY_ICONS[category]} category={category} label={groupKey} /> : null;
      break;
    }
    case 'priority':
      mark = <PriorityIcon priority={groupKey as Priority} />;
      break;
    case 'assignee': {
      const user = users?.find((entry) => entry.id === groupKey);
      mark = groupKey === NONE_KEY ? <UnassignedAvatar /> : user ? <Avatar user={user} size="sm" decorative /> : null;
      break;
    }
    case 'type': {
      const type = types?.find((entry) => entry.id === groupKey);
      mark = type ? <TypeGlyph type={type} /> : null;
      break;
    }
    case 'label': {
      const label = labels?.find((entry) => entry.id === groupKey);
      mark = label ? <ToneDot tone={label.color} className="size-2" /> : <span className="size-2 rounded-full border border-dashed border-faint" />;
      break;
    }
    case 'project': {
      const project = projects?.find((entry) => entry.id === groupKey);
      mark = project ? <ProjectBadge project={project} /> : null;
      break;
    }
    case 'parent':
      mark = groupKey === NONE_KEY ? null : <Layers className="size-4 text-muted" />;
      break;
    case 'none':
      mark = null;
  }
  if (!mark) return null;
  return (
    <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center">
      {mark}
    </span>
  );
}
