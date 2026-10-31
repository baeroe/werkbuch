/*
 * The parent of an item (spec 4.8): an epic of the same project (two levels, `domain/hierarchy`), never the item itself
 * or one of its children (no cycles). An epic has no parent: the item's fields show no picker for it, ⇧P says why.
 * Searching finds key and title. The change is optimistic (`useUpdateWorkItem`). The create dialog and ⇧P build their
 * lists with the helpers here.
 */

import { useQuery } from '@tanstack/react-query';
import { CornerLeftUp } from 'lucide-react';
import { useMemo } from 'react';
import { listWorkItems } from '@/api/workItems';
import { canHaveChildren } from '@/domain/hierarchy';
import { qk } from '@/hooks/keys';
import { allPages } from '@/hooks/pages';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { WorkItem, WorkItemType } from '@/types';
import { useEditReason } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';
import { TypeGlyph } from './TypeGlyph';

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

/** "Kein Eltern-Item", offered once there is a parent to take away; a function, so it follows the language. */
export const NO_PARENT_OPTION = (): PickerOption => ({
  value: NONE,
  label: t('items.fields.parent.none'),
  keywords: [t('items.fields.parent.none_keywords')],
  icon: <CornerLeftUp className="size-4 text-muted" />,
});

/** A candidate in a parent list: its title, the key as hint and search word, the icon of its type. */
export function parentOption(candidate: WorkItem, type: WorkItemType | undefined): PickerOption {
  return { value: candidate.id, label: candidate.title, hint: candidate.key, keywords: [candidate.key], icon: type ? <TypeGlyph type={type} /> : undefined };
}

/** What a parent list says when it shows nothing: the project has no epic yet, or none matches the search. */
export function noParentText(candidates: readonly WorkItem[]): string {
  return candidates.length === 0 ? t('items.fields.parent.no_epic') : t('items.fields.parent.no_match');
}

/**
 * Every item of one project, all pages (`next_cursor` followed to the end): the parent picker and ⇧P choose from them,
 * and an epic on the second page must not be missing. Under `qk.workItems`, so the optimistic changes reach it.
 */
export function useProjectItems(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.workItems.list({ project_id: projectId, pages: 'all' }),
    queryFn: () => allPages((cursor) => listWorkItems({ project_id: projectId, cursor })),
    enabled,
  });
}

type ParentPickerProps = PickerExtras & { item: WorkItem };

export function ParentPicker({ item, look = 'field', shortcut, ...extras }: ParentPickerProps) {
  const items = useProjectItems(item.project_id);
  const types = useWorkItemTypes();
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  const typeList = types.data?.items;
  const projectItems = items.data?.items;

  const candidates = useMemo(
    () => parentCandidates(item, projectItems ?? [], (id) => typeList?.find((type) => type.id === id)),
    [item, projectItems, typeList],
  );
  const options = useMemo<PickerOption[]>(
    () => [...(item.parent_id ? [NO_PARENT_OPTION()] : []), ...candidates.map((candidate) => parentOption(candidate, typeList?.find((type) => type.id === candidate.type_id)))],
    [item.parent_id, candidates, typeList],
  );

  // the item names its parent itself; the icon comes with the items of the project
  const parent = item.parent_id ? item.parent : null;
  const parentTypeId = parent ? projectItems?.find((entry) => entry.id === parent.id)?.type_id : undefined;
  const parentType = parentTypeId ? typeList?.find((type) => type.id === parentTypeId) : undefined;
  const display = parent ? (
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
      <span className="truncate text-muted">{t('items.fields.parent.none')}</span>
    </>
  );

  return (
    <Picker
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? SHORTCUTS['item.parent'].keys : undefined)}
      label={t('items.fields.parent.label')}
      display={display}
      displayText={parent ? `${parent.key} ${parent.title}` : t('items.fields.parent.none_text')}
      options={options}
      value={item.parent_id ?? NONE}
      onValueChange={(value) => update.mutate({ id: item.id, patch: { parent_id: value || null } })}
      placeholder={t('items.fields.parent.placeholder')}
      emptyText={noParentText(candidates)}
      load={{ isLoading: items.isPending || types.isPending, error: items.error ?? types.error, retry: () => void items.refetch(), retrying: items.isFetching }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
