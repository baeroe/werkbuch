/*
 * The assignee of an item (spec 4.8): one or nobody, from the members of the project. Bots carry their word ("Bot",
 * "Agent") and their square avatar; "Mir zuweisen" comes first. The change is optimistic.
 */

import { UserRoundCheck } from 'lucide-react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { useCurrentUser } from '@/hooks/users';
import { useUpdateWorkItem } from '@/hooks/workItems';
import type { User, WorkItem } from '@/types';
import { botWord } from './format';
import { useEditReason, useProjectPeople, useUserMap } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';

/** The option values that are not a person: take it yourself, or nobody. */
const ME = '__me';
const NOBODY = '';

/** A person or bot as an option: avatar, name and, for bots, their word. */
export const personOption = (user: User): PickerOption => ({
  value: user.id,
  label: user.name,
  hint: botWord(user),
  keywords: [user.handle],
  icon: <Avatar user={user} size="sm" decorative />,
});

type AssigneePickerProps = PickerExtras & { item: WorkItem };

export function AssigneePicker({ item, look = 'field', shortcut, ...extras }: AssigneePickerProps) {
  const me = useCurrentUser();
  const { people, isLoading, error, retry, retrying } = useProjectPeople(item.project_id);
  const users = useUserMap();
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  const assignee = item.assignee_id ? users.get(item.assignee_id) : undefined;

  const mine = me && item.assignee_id !== me.id && people?.some((user) => user.id === me.id);
  const options: PickerOption[] = [
    ...(mine ? [{ value: ME, label: 'Mir zuweisen', keywords: [me.name], icon: <UserRoundCheck className="size-4 text-muted" /> }] : []),
    { value: NOBODY, label: 'Nicht zugewiesen', keywords: ['niemand', 'entfernen'], icon: <UnassignedAvatar /> },
    ...(people ?? []).map(personOption),
  ];

  const name = assignee ? `${assignee.name}${assignee.type === 'bot' ? ` (${botWord(assignee)})` : ''}` : 'Nicht zugewiesen';
  const display =
    look === 'avatar' ? (
      assignee ? (
        <Avatar user={assignee} size="sm" decorative />
      ) : (
        <UnassignedAvatar />
      )
    ) : assignee ? (
      <>
        <Avatar user={assignee} size="sm" decorative />
        <span className="truncate">{assignee.name}</span>
        {assignee.type === 'bot' && <span className="shrink-0 text-sm text-muted">{botWord(assignee)}</span>}
      </>
    ) : (
      <>
        <UnassignedAvatar />
        <span className="truncate text-muted">Nicht zugewiesen</span>
      </>
    );

  return (
    <Picker
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? 'a' : undefined)}
      label="Assignee"
      display={display}
      displayText={name}
      options={options}
      value={item.assignee_id ?? NOBODY}
      onValueChange={(value) => {
        const next = value === ME ? (me?.id ?? null) : value || null;
        if (next !== item.assignee_id) update.mutate({ id: item.id, patch: { assignee_id: next } });
      }}
      placeholder="Person suchen …"
      emptyText="Niemand im Projekt heißt so."
      load={{ isLoading, error, retry, retrying }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
