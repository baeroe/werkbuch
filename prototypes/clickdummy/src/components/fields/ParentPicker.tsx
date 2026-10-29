/*
 * The parent of an item (spec 4.8): an epic of the same project (two levels, `domain/hierarchy`, correction round
 * 2026-10-29), never the item itself or one of its children (no cycles). An epic has no parent: the item's fields show
 * no picker for it, ⇧P says why. Searching finds key and title. The change is optimistic. The create dialog, the
 * template editor and ⇧P build their lists with the helpers here.
 */

import { CornerLeftUp } from 'lucide-react';
import { useMemo } from 'react';
import { canHaveChildren } from '@/domain/hierarchy';
import { useUpdateWorkItem, useWorkItem, useWorkItems } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { WorkItem, WorkItemType } from '@/types';
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

/**
 * The items that can be the parent of `item` (a new item has no id yet): the epics of its project, never the item itself
 * or one of its descendants, the newest first.
 */
export function parentCandidates(
  item: { id: string | null; project_id: string },
  projectItems: readonly WorkItem[],
  typeOf: (typeId: string) => WorkItemType | undefined,
): WorkItem[] {
  const below = item.id ? descendantsOf(item.id, projectItems) : new Set<string>();
  return projectItems
    .filter((entry) => entry.project_id === item.project_id && entry.id !== item.id && !below.has(entry.id) && canHaveChildren(typeOf(entry.type_id)))
    .sort((a, b) => b.number - a.number);
}

/** "Kein Eltern-Item", offered once there is a parent to take away. */
export const NO_PARENT_OPTION: PickerOption = { value: '', label: 'Kein Eltern-Item', keywords: ['entfernen'], icon: <CornerLeftUp className="size-4 text-muted" /> };

/** A candidate in a parent list: its title, the key as hint and search word, the icon of its type. */
export function parentOption(candidate: WorkItem, type: WorkItemType | undefined): PickerOption {
  return { value: candidate.id, label: candidate.title, hint: candidate.key, keywords: [candidate.key], icon: type ? <TypeGlyph type={type} /> : undefined };
}

/** What a parent list says when it shows nothing: the project has no epic yet, or none matches the search. */
export function noParentText(candidates: readonly WorkItem[]): string {
  return candidates.length === 0 ? 'Im Projekt gibt es noch kein Epic.' : 'Kein Epic im Projekt passt.';
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

  const candidates = useMemo(() => parentCandidates(item, items.data?.items ?? [], (id) => typeList?.find((type) => type.id === id)), [item, items.data, typeList]);
  const options = useMemo<PickerOption[]>(
    () => [...(item.parent_id ? [NO_PARENT_OPTION] : []), ...candidates.map((candidate) => parentOption(candidate, typeList?.find((type) => type.id === candidate.type_id)))],
    [item.parent_id, candidates, typeList],
  );

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
      emptyText={noParentText(candidates)}
      load={{ isLoading: items.isPending || types.isPending, error: items.error ?? types.error, retry: () => void items.refetch(), retrying: items.isFetching }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
