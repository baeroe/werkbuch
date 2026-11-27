/*
 * What the overview and the dialog "Neue View" know about the make-up of a view (spec 4.11), ported from the
 * clickdummy: how a view is grouped in words, the display a new view starts with, the name of a copy, and the projects
 * its filter names. A view has no layout (WEBU-68): each list remembers its own. The icons a view can get are `ICON_OPTIONS` of
 * `components/ui/ViewIcon.tsx` (K23).
 */

import { VIEW_NAME_MAX } from '@/features/items/save/ViewFields';
import { t, type TranslationKey } from '@/lib/i18n';
import type { Filter, GroupBy, ViewInput } from '@/types';

const GROUPING: Record<GroupBy, TranslationKey> = {
  none: 'views.grouping.none',
  state: 'views.grouping.state',
  category: 'views.grouping.category',
  assignee: 'views.grouping.assignee',
  priority: 'views.grouping.priority',
  type: 'views.grouping.type',
  label: 'views.grouping.label',
  project: 'views.grouping.project',
  parent: 'views.grouping.parent',
};

/** "nach Projekt gruppiert", or "nicht gruppiert". */
export const groupingText = (groupBy: GroupBy): string => t(GROUPING[groupBy]);

/** The fields a new list shows. */
const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'due_date'];

/** A new view shows all items, grouped by status, in the manual order. */
export function newView(name: string, icon: string): ViewInput {
  return {
    name,
    icon,
    filter: { version: 1, conditions: [] },
    display: { group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: [...FIELDS], show_sub_items: true },
  };
}

/** "Roadmap (Kopie)", the one rule of the overview and of "save as a new view"; a long name is cut before the suffix, so the copy keeps within the 60 characters (K26). */
export function copyName(name: string): string {
  const room = VIEW_NAME_MAX - Array.from(t('views.copy_name', { name: '' })).length;
  return t('views.copy_name', { name: Array.from(name).slice(0, room).join('').trimEnd() });
}

/** The projects the filter of a view names (`project is` / `project in`), each once, in their order. */
export function namedProjects(filter: Filter): string[] {
  const ids = filter.conditions
    .filter((condition) => condition.field === 'project' && (condition.op === 'is' || condition.op === 'in'))
    .flatMap((condition) => (Array.isArray(condition.value) ? condition.value : [condition.value]))
    .filter((value): value is string => typeof value === 'string');
  return [...new Set(ids)];
}
