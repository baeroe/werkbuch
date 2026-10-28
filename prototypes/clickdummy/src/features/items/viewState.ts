/*
 * The state of an item list (spec 4.11): its filter and its display (layout, grouping, sorting, fields, sub-items).
 *
 * Every list starts from a base: a saved view, or one of the built-in lists (`presetState`). What somebody changes on
 * top of it lives in the URL, so a link shows the same list (spec: "Der Stand steckt in der URL"):
 *
 *   ?filter=[{"field":"priority","op":"in","value":["urgent"]}]&layout=board&group=assignee&sort=due_date:desc
 *   &fields=key,state,property:customer&sub=0
 *
 * - `filter` is the JSON of the conditions (the filter JSON of the API without its version), `sort` is `field:dir`,
 *   `fields` a comma list, `sub` 1 or 0. Each part is written only when it differs from the base, so a plain link
 *   (`/projects/WEB`) is the base itself and `?layout=board` changes just the layout.
 * - Reading never fails: a part that cannot be read is left out and the base shows instead.
 * - A difference from a saved view is an unsaved change (`hasUnsavedChanges`); on a built-in list only a different
 *   filter is (ItemsScreen), since layout and fields are just how one looks at it. Conditions are compared by meaning:
 *   their order, the order of the values of "eines von", and `is x` against `in [x]` change nothing.
 *
 * The built-in lists also have a scope the filter bar does not show (`scopeConditions`): the project of the project
 * list, "mir zugewiesen" of Meine Items, "von mir erstellt". A view saved from such a list takes the scope along.
 */

import type { Condition, ConditionOp, Display, Filter, GroupBy, SortSpec, StateCategory, View } from '@/types';

export type ItemsPreset = 'my' | 'created' | 'subscribed' | 'view' | 'project';

export interface ViewState {
  filter: Filter;
  display: Display;
}

/** What the URL changes: any part of the state, or none. */
export interface ViewStatePatch {
  filter?: Filter;
  display?: Partial<Display>;
}

export const LAYOUTS = ['list', 'board', 'table', 'timeline'] as const satisfies readonly Display['layout'][];

export const GROUP_BYS = ['state', 'category', 'assignee', 'priority', 'type', 'label', 'project', 'parent', 'none'] as const satisfies readonly GroupBy[];

const OPS: readonly ConditionOp[] = ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty', 'before', 'after', 'between', 'contains', 'gt', 'lt', 'overdue'];

/** The search params of the view state; anything else in the URL (e.g. `?create=1`) is left alone. */
export const VIEW_STATE_PARAMS = ['filter', 'layout', 'group', 'sort', 'fields', 'sub'] as const;

/** Field names: `due_date`, `property:customer`. */
const FIELD_NAME = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)?$/;

/* -------------------------------------------------------------------------- comparing */

/** JSON with sorted object keys, so `{ a, b }` and `{ b, a }` read the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const POSITIVE = new Set<ConditionOp>(['is', 'in']);
const NEGATIVE = new Set<ConditionOp>(['is_not', 'not_in']);
const VALUELESS = new Set<ConditionOp>(['is_empty', 'is_not_empty', 'overdue']);

/** A condition by its meaning: the engine reads `is` like `in` (and `is_not` like `not_in`), with a value or a list. */
function canonical(condition: Condition): string {
  const { field, op, value } = condition;
  if (POSITIVE.has(op) || NEGATIVE.has(op)) {
    const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return stable([field, POSITIVE.has(op) ? 'in' : 'not_in', list.map(stable).sort()]);
  }
  return stable([field, op, VALUELESS.has(op) ? null : value]);
}

/** Whether two filters match the same items: the same conditions, in any order. */
export function sameFilter(a: Filter, b: Filter): boolean {
  const left = a.conditions.map(canonical).sort();
  const right = b.conditions.map(canonical).sort();
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

const sameSort = (a: SortSpec, b: SortSpec) => a.field === b.field && a.direction === b.direction;
const sameFields = (a: string[], b: string[]) => a.length === b.length && a.every((field, index) => field === b[index]);

export function sameDisplay(a: Display, b: Display): boolean {
  return a.layout === b.layout && a.group_by === b.group_by && sameSort(a.sort, b.sort) && sameFields(a.fields, b.fields) && a.show_sub_items === b.show_sub_items;
}

/** Whether what is shown differs from the base: the filter or any part of the display. */
export function hasUnsavedChanges(base: ViewState, state: ViewState): boolean {
  return !sameFilter(base.filter, state.filter) || !sameDisplay(base.display, state.display);
}

/* --------------------------------------------------------------------------- the URL */

const formatSort = (sort: SortSpec) => `${sort.field}:${sort.direction}`;

/** Writes the state as search params (without "?"); with a base only what differs from it, '' when nothing does. */
export function encodeViewState(state: ViewStatePatch, base?: ViewState): string {
  const params = new URLSearchParams();
  const { filter, display = {} } = state;
  if (filter && !(base && sameFilter(filter, base.filter))) params.set('filter', JSON.stringify(filter.conditions));
  const differs = <K extends keyof Display>(key: K, same: (a: Display[K], b: Display[K]) => boolean) =>
    display[key] !== undefined && !(base && same(display[key] as Display[K], base.display[key]));

  if (differs('layout', (a, b) => a === b)) params.set('layout', display.layout!);
  if (differs('group_by', (a, b) => a === b)) params.set('group', display.group_by!);
  if (differs('sort', sameSort)) params.set('sort', formatSort(display.sort!));
  if (differs('fields', sameFields)) params.set('fields', display.fields!.join(','));
  if (differs('show_sub_items', (a, b) => a === b)) params.set('sub', display.show_sub_items ? '1' : '0');
  return params.toString();
}

/** One condition from the URL, or null when it is not one: an object with a field name and a known operator. */
function readCondition(raw: unknown): Condition | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { field, op, value } = raw as Record<string, unknown>;
  if (typeof field !== 'string' || !FIELD_NAME.test(field) || !OPS.includes(op as ConditionOp)) return null;
  return value === undefined ? { field, op: op as ConditionOp } : { field, op: op as ConditionOp, value };
}

function readFilter(text: string): Filter | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return { version: 1, conditions: parsed.map(readCondition).filter((condition): condition is Condition => condition !== null) };
}

function readSort(text: string): SortSpec | undefined {
  const cut = text.lastIndexOf(':');
  const tail = cut >= 0 ? text.slice(cut + 1) : '';
  const direction = tail === 'asc' || tail === 'desc' ? tail : 'asc';
  const field = tail === 'asc' || tail === 'desc' ? text.slice(0, cut) : text;
  return FIELD_NAME.test(field) ? { field, direction } : undefined;
}

const isLayout = (value: string | null): value is Display['layout'] => (LAYOUTS as readonly string[]).includes(value ?? '');
const isGroupBy = (value: string | null): value is GroupBy => (GROUP_BYS as readonly string[]).includes(value ?? '');

/** Reads the view state from a URL search (with or without "?"). Parts that are missing or unreadable stay out. */
export function decodeViewState(search: string): ViewStatePatch {
  const params = new URLSearchParams(search);
  const patch: ViewStatePatch = {};
  const display: Partial<Display> = {};

  const filterText = params.get('filter');
  const filter = filterText === null ? undefined : readFilter(filterText);
  if (filter) patch.filter = filter;

  const layout = params.get('layout');
  if (isLayout(layout)) display.layout = layout;
  const group = params.get('group');
  if (isGroupBy(group)) display.group_by = group;
  const sortText = params.get('sort');
  const sort = sortText ? readSort(sortText) : undefined;
  if (sort) display.sort = sort;
  const fields = params.get('fields');
  if (fields !== null) display.fields = fields.split(',').filter((field) => FIELD_NAME.test(field));
  const sub = params.get('sub');
  if (sub === '1' || sub === '0') display.show_sub_items = sub === '1';

  if (Object.keys(display).length > 0) patch.display = display;
  return patch;
}

/** What the list shows: the base with the changes from the URL. A copy, so nothing changes the cached base. */
export function applyViewState(base: ViewState, patch: ViewStatePatch): ViewState {
  return structuredClone({ filter: patch.filter ?? base.filter, display: { ...base.display, ...patch.display } });
}

/* ------------------------------------------------------------------------ the bases */

/** The state a saved view starts from: what was saved (a copy). */
export function viewStateOf(view: Pick<View, 'filter' | 'display'>): ViewState {
  return structuredClone({ filter: view.filter, display: view.display });
}

/** Open means anything but Completed and Canceled. */
export const OPEN_CATEGORIES: StateCategory[] = ['backlog', 'unstarted', 'started'];

/** The fields a list shows unless a view says otherwise. */
export const DEFAULT_FIELDS = ['key', 'state', 'priority', 'labels', 'due_date', 'assignee'];

const listDisplay = (group_by: GroupBy, sort: SortSpec, fields = DEFAULT_FIELDS): Display => ({ layout: 'list', group_by, sort, fields: [...fields], show_sub_items: true });

const noFilter = (): Filter => ({ version: 1, conditions: [] });

/**
 * The base of a built-in list. The project list is grouped by status in the manual order; the lists across projects
 * group by category (their items have several workflows) and sort by what matters there.
 */
export function presetState(preset: Exclude<ItemsPreset, 'view'>): ViewState {
  switch (preset) {
    case 'project':
      return { filter: noFilter(), display: listDisplay('state', { field: 'rank', direction: 'asc' }) };
    case 'my':
      return {
        filter: { version: 1, conditions: [{ field: 'state_category', op: 'in', value: [...OPEN_CATEGORIES] }] },
        // every item is mine: no assignee chip
        display: listDisplay('category', { field: 'priority', direction: 'asc' }, DEFAULT_FIELDS.filter((field) => field !== 'assignee')),
      };
    case 'created':
      return { filter: noFilter(), display: listDisplay('category', { field: 'created_at', direction: 'desc' }) };
    case 'subscribed':
      return { filter: noFilter(), display: listDisplay('category', { field: 'updated_at', direction: 'desc' }) };
  }
}

/**
 * What a built-in list always holds besides its filter: the project, "mir zugewiesen", "von mir erstellt". "Beobachtet"
 * has no condition for it (the filter engine knows no subscriber field); the screen narrows it itself.
 */
export function scopeConditions(preset: ItemsPreset, projectId?: string): Condition[] {
  switch (preset) {
    case 'project':
      return projectId ? [{ field: 'project', op: 'is', value: projectId }] : [];
    case 'my':
      return [{ field: 'assignee', op: 'is', value: 'me' }];
    case 'created':
      return [{ field: 'created_by', op: 'is', value: 'me' }];
    default:
      return [];
  }
}
