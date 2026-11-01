/*
 * The values a choice of the filter bar offers (P1: they only name things, the server matches): projects, types, the
 * states of the one workflow of a project list or of all workflows of the projects in view, the categories, people
 * with "Ich" first, the priorities, labels, the epics as parents (lean), the options of a dropdown property. A value
 * the reader does not know (an id in a view of somebody else, of a project the reader does not see) reads "Verborgen"
 * (P21); names come only from the lists of the reader.
 */

import { UserRoundCheck } from 'lucide-react';
import { personOption } from '@/components/fields/AssigneePicker';
import { labelOption } from '@/components/fields/LabelsPicker';
import type { PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { stateOption } from '@/components/fields/StatePicker';
import { typeOption } from '@/components/fields/TypePicker';
import { ToneDot } from '@/components/ui/Chip';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { CATEGORY_ORDER, statesInOrder } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useProjects } from '@/hooks/projects';
import { useAllUsers, useCurrentUser } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useEpics } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { intlLocale, t } from '@/lib/i18n';
import type { Project, User } from '@/types';
import { CATEGORY_ICONS } from '../display/GroupIcon';
import { CATEGORY_LABEL_KEYS } from '../display/groupLabels';
import type { FieldDef } from './fieldOps';

export interface ValueOptions {
  options: PickerOption[];
  loading: boolean;
  error: Error | null;
  retry(): void;
  /** The name of a value: its option's label, "Verborgen" for one the reader does not know, "…" while loading. */
  nameOf(value: unknown): string;
}

/** The value `me`: the reader, whoever that is. */
export const ME = 'me';

/** Active people before bots, by name. */
function people(users: readonly User[]): User[] {
  const collator = new Intl.Collator(intlLocale());
  return users
    .filter((user) => user.disabled_at === null)
    .sort((a, b) => (a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'person' ? -1 : 1));
}

export function useValueOptions(def: FieldDef, project?: Project): ValueOptions {
  const source = def.source;
  const projects = useProjects({ include_archived: true });
  const workflows = useWorkflows();
  const types = useWorkItemTypes();
  const users = useAllUsers();
  const labels = useLabels();
  const me = useCurrentUser();
  const epics = useEpics(project?.id, source === 'parent');

  const used =
    source === 'project'
      ? [projects]
      : source === 'state'
        ? [projects, workflows]
        : source === 'type'
          ? [types]
          : source === 'person' || source === 'member'
            ? [users]
            : source === 'label'
              ? [labels]
              : source === 'parent'
                ? [epics, types]
                : [];
  const loading = used.some((query) => query.isPending);
  const error = used.find((query) => query.error)?.error ?? null;
  const retry = () => used.forEach((query) => void query.refetch());

  let options: PickerOption[] = [];
  switch (source) {
    case 'project':
      options = (projects.data?.items ?? []).map((entry) => ({ value: entry.id, label: entry.name, keywords: [entry.identifier], icon: <ProjectBadge project={entry} /> }));
      break;
    case 'type':
      options = (types.data?.items ?? []).map((type) => ({ ...typeOption(type), hint: type.archived_at ? t('items.filter.value.archived') : undefined }));
      break;
    case 'state': {
      // the workflow of a project list, else the workflows of the projects the reader sees
      const ids = project ? [project.workflow_id] : [...new Set((projects.data?.items ?? []).map((entry) => entry.workflow_id))];
      const shown = (workflows.data?.items ?? []).filter((workflow) => ids.includes(workflow.id));
      options = shown.flatMap((workflow) => statesInOrder(workflow).map((state) => ({ ...stateOption(state), hint: shown.length > 1 ? workflow.name : undefined })));
      break;
    }
    case 'category':
      options = CATEGORY_ORDER.map((category) => {
        const label = t(CATEGORY_LABEL_KEYS[category]);
        return { value: category, label, icon: <StatusIcon icon={CATEGORY_ICONS[category]} category={category} label={label} aria-hidden="true" /> };
      });
      break;
    case 'person':
    case 'member': {
      const meOption: PickerOption[] = def.acceptsMe && me ? [{ value: ME, label: t('items.filter.value.me'), hint: me.name, keywords: [me.handle], icon: <UserRoundCheck className="size-4 text-muted" /> }] : [];
      options = [...meOption, ...people(users.data?.items ?? []).map(personOption)];
      break;
    }
    case 'priority':
      options = PRIORITY_OPTIONS();
      break;
    case 'label': {
      const collator = new Intl.Collator(intlLocale());
      options = [...(labels.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name)).map(labelOption);
      break;
    }
    case 'parent': {
      const typeList = types.data?.items ?? [];
      options = (epics.data?.items ?? []).map((item) => {
        const type = typeList.find((entry) => entry.id === item.type_id);
        return { value: item.id, label: item.title, hint: item.key, keywords: [item.key], icon: type ? typeOption(type).icon : undefined };
      });
      break;
    }
    case 'option':
      options = [...(def.property?.options ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((option) => ({
          value: option.id,
          label: option.label,
          hint: option.archived_at ? t('items.filter.value.archived') : undefined,
          icon: <ToneDot tone={option.color} className="size-2" />,
        }));
      break;
  }

  const nameOf = (value: unknown): string => {
    const known = options.find((option) => option.value === value);
    if (known) return known.label;
    return loading ? t('items.filter.value.loading') : t('items.filter.value.hidden');
  };
  return { options, loading, error, retry, nameOf };
}
