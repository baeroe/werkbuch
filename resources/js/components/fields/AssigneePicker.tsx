/*
 * The assignee of an item (spec 4.8): one or nobody, from the people who can take work in the project
 * (`useProjectPeople`). Bots carry the word "Bot" and their square avatar; "Mir zuweisen" comes first. The change is
 * optimistic (`useUpdateWorkItem`).
 */

import { UserRoundCheck } from 'lucide-react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { useCurrentUser } from '@/hooks/users';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { ListedItem, User } from '@/types';
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

type AssigneePickerProps = PickerExtras & { item: ListedItem };

export function AssigneePicker({ item, look = 'field', shortcut, ...extras }: AssigneePickerProps) {
  const me = useCurrentUser();
  const { people, isLoading, error, retry, retrying } = useProjectPeople(item.project_id);
  const users = useUserMap();
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  const assignee = item.assignee_id ? users.get(item.assignee_id) : undefined;
  const nobody = t('items.fields.assignee.nobody');

  const mine = me && item.assignee_id !== me.id && people?.some((user) => user.id === me.id);
  const options: PickerOption[] = [
    ...(mine ? [{ value: ME, label: t('items.fields.assignee.me'), keywords: [me.name], icon: <UserRoundCheck className="size-4 text-muted" /> }] : []),
    { value: NOBODY, label: nobody, keywords: [t('items.fields.assignee.nobody_keywords')], icon: <UnassignedAvatar /> },
    ...(people ?? []).map(personOption),
  ];

  const name = assignee ? (assignee.type === 'bot' ? `${assignee.name} (${botWord(assignee)})` : assignee.name) : nobody;
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
        <span className="truncate text-muted">{nobody}</span>
      </>
    );

  return (
    <Picker
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? SHORTCUTS['item.assignee'].keys : undefined)}
      label={t('items.fields.assignee.label')}
      display={display}
      displayText={name}
      options={options}
      value={item.assignee_id ?? NOBODY}
      onValueChange={(value) => {
        const next = value === ME ? me!.id : value || null;
        if (next !== item.assignee_id) update.mutate({ id: item.id, patch: { assignee_id: next } });
      }}
      placeholder={t('items.fields.assignee.placeholder')}
      emptyText={t('items.fields.assignee.empty')}
      load={{ isLoading, error, retry, retrying }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
