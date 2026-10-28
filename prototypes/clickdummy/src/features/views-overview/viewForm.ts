/*
 * What the overview and the dialog "Neue View" know about the make-up of a view (spec 4.11): the four layouts with
 * their German names and icons, the icons a view can get, and the display a new view starts with.
 */

import { ChartGantt, List, SquareKanban, Table2, type LucideIcon } from 'lucide-react';
import type { ViewInput } from '@/api/views';
import type { Display, GroupBy } from '@/types';

export const LAYOUTS: Record<Display['layout'], { label: string; icon: LucideIcon }> = {
  list: { label: 'Liste', icon: List },
  board: { label: 'Board', icon: SquareKanban },
  table: { label: 'Tabelle', icon: Table2 },
  timeline: { label: 'Timeline', icon: ChartGantt },
};

export const LAYOUT_ORDER: readonly Display['layout'][] = ['list', 'board', 'table', 'timeline'];

const GROUPS: Record<Exclude<GroupBy, 'none'>, string> = {
  state: 'Status',
  category: 'Kategorie',
  assignee: 'Assignee',
  priority: 'Priorität',
  type: 'Typ',
  label: 'Label',
  project: 'Projekt',
  parent: 'Eltern-Item',
};

/** "nach Projekt gruppiert", or "nicht gruppiert". */
export const groupingText = (groupBy: GroupBy): string => (groupBy === 'none' ? 'nicht gruppiert' : `nach ${GROUPS[groupBy]} gruppiert`);

/** The icons the dialog offers (Lucide names, see `VIEW_ICONS`), with the name a person reads. */
export const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: 'layers', label: 'Ebenen' },
  { value: 'list-todo', label: 'Aufgabenliste' },
  { value: 'square-check', label: 'Haken' },
  { value: 'bug', label: 'Käfer' },
  { value: 'zap', label: 'Blitz' },
  { value: 'calendar-clock', label: 'Kalender' },
  { value: 'route', label: 'Route' },
  { value: 'building-2', label: 'Gebäude' },
  { value: 'user-round-check', label: 'Person' },
  { value: 'octagon-alert', label: 'Warnung' },
  { value: 'eye', label: 'Auge' },
  { value: 'flag', label: 'Flagge' },
  { value: 'rocket', label: 'Rakete' },
  { value: 'target', label: 'Ziel' },
];

/** The fields every list shows by default; a timeline needs only the title. */
const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'due_date'];

/** A new view shows all items, grouped the way its layout suits (a timeline by project), in the manual order. */
export function newView(name: string, icon: string, layout: Display['layout']): ViewInput {
  return {
    name,
    icon,
    filter: { version: 1, conditions: [] },
    display: {
      layout,
      group_by: layout === 'timeline' ? 'project' : 'state',
      sort: { field: 'rank', direction: 'asc' },
      fields: layout === 'timeline' ? ['key', 'title'] : [...FIELDS],
      show_sub_items: true,
    },
  };
}
