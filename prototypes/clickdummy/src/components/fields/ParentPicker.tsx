/*
 * The parent of an item (spec 4.8): another item of the same project, never the item itself or one of its children
 * and grandchildren (no cycles). Epics come first. Searching finds key and title. The change is optimistic.
 */

import { CornerLeftUp } from 'lucide-react';
import { useMemo } from 'react';
import { useUpdateWorkItem, useWorkItem, useWorkItems } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { WorkItem } from '@/types';
import { useEditReason } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';
import { TypeGlyph } from './TypePicker';

const NONE = '';

/** The ids of an item's children, grandchildren and so on. */
export function descendantsOf(itemId: string, items: readonly WorkItem[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const entry of items) if (entry.parent_id) children.set(entry.parent_id, [...(children.get(entry.parent_id) ?? []), entry.id]);
  const found = new Set<string>();
  const stack = [...(children.get(itemId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (found.has(next)) continue;
    found.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return found;
}

/** The items of a project that can be the parent of `item`: epics first, then the newest. */
export function parentCandidates(item: WorkItem, projectItems: readonly WorkItem[], isEpic: (typeId: string) => boolean): WorkItem[] {
  const below = descendantsOf(item.id, projectItems);
  return projectItems
    .filter((entry) => entry.project_id === item.project_id && entry.id !== item.id && !below.has(entry.id))
    .sort((a, b) => Number(isEpic(b.type_id)) - Number(isEpic(a.type_id)) || b.number - a.number);
}

/** The items of one project (the parent picker and the command `shift+p` choose from them). */
export function useProjectItems(projectId: string, enabled = true) {
  return useWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: projectId }] } }, { enabled });
}

type ParentPickerProps = PickerExtras & { item: WorkItem };

export function ParentPicker({ item, look = 'field', shortcut, ...extras }: ParentPickerProps) {
  const items = useProjectItems(item.project_id);
  const types = useWorkItemTypes();
  const parent = useWorkItem(item.parent_id).data?.item;
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  const typeList = types.data?.items;
  const typeOf = (id: string) => typeList?.find((type) => type.id === id);

  const options = useMemo<PickerOption[]>(() => {
    const isEpic = (typeId: string) => typeList?.find((type) => type.id === typeId)?.is_epic ?? false;
    const candidates = parentCandidates(item, items.data?.items ?? [], isEpic);
    return [
      { value: NONE, label: 'Kein Eltern-Item', keywords: ['entfernen'], icon: <CornerLeftUp className="size-4 text-muted" /> },
      ...candidates.map((candidate) => {
        const type = typeList?.find((entry) => entry.id === candidate.type_id);
        return { value: candidate.id, label: candidate.title, hint: candidate.key, keywords: [candidate.key], icon: type ? <TypeGlyph type={type} /> : undefined };
      }),
    ];
  }, [item, items.data, typeList]);

  const parentType = parent ? typeOf(parent.type_id) : undefined;
  const display =
    item.parent_id && parent ? (
      <>
        {parentType && <TypeGlyph type={parentType} />}
        <span translate="no" className="shrink-0 font-semibold text-muted tabular-nums">
          {parent.key}
        </span>
        <span className="truncate">{parent.title}</span>
      </>
    ) : (
      <>
        <CornerLeftUp className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate text-muted">{item.parent_id ? 'Eltern-Item wird geladen …' : 'Kein Eltern-Item'}</span>
      </>
    );

  return (
    <Picker
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? 'shift+p' : undefined)}
      label="Eltern-Item"
      display={display}
      displayText={parent ? `${parent.key} ${parent.title}` : 'keins'}
      options={options}
      value={item.parent_id ?? NONE}
      onValueChange={(value) => update.mutate({ id: item.id, patch: { parent_id: value || null } })}
      placeholder="Key oder Titel suchen …"
      emptyText="Kein Item im Projekt passt. Kinder des Items können nicht seine Eltern sein."
      load={{ isLoading: items.isPending || types.isPending, error: items.error ?? types.error, retry: () => void items.refetch(), retrying: items.isFetching }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
