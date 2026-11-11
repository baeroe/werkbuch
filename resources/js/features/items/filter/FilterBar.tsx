/*
 * The filter bar of an item list (spec 4.11, moodboard): "Filter" adds a condition (`f`), the search field narrows by
 * title (`/`), and every condition is a chip (`ConditionChip`). Conditions join with AND; within a field "eines von".
 *
 * - A new condition first lives here as a draft, until it has its value: then it joins the filter in the same place
 *   (the chip stays the same element, its open list too). A flag (Blockiert, Archiviert …) and an operator without a
 *   value ("ist leer") are complete at once.
 * - An unfinished condition stays while the focus is within its chip and goes once the focus leaves it (13c); a
 *   condition of the filter can be unfinished for a moment too (its values taken away, "zwischen" with one end). What
 *   is unfinished never goes to the server (`isComplete`, `useListData`).
 * - Removing a chip (×, Backspace) puts the focus on the next chip, else on the one before, else on "Filter".
 * `/` and `f` (scope `list`) win over a later global `/` while the list is on screen (P25).
 */

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useProperties } from '@/hooks/properties';
import { t } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Condition, Filter, Project } from '@/types';
import { AddFilterMenu } from './AddFilterMenu';
import { ConditionChip } from './ConditionChip';
import { fieldDef, isComplete, newCondition, type FieldDef } from './fieldOps';
import { TitleSearch } from './TitleSearch';

type FilterBarProps = {
  filter: Filter;
  onChange: (filter: Filter) => void;
  /** The project of a project list: its workflow's states, and no "Projekt" field (the list is the project). */
  project?: Project;
  /** On the right: the display menu and "Neues Item". */
  actions?: ReactNode;
  /** The search field, for whoever wants to put the focus there. */
  searchRef?: RefObject<HTMLInputElement | null>;
};

const isTitleSearch = (condition: Condition) => condition.field === 'title' && condition.op === 'contains';

const replaceAt = (list: Condition[], index: number, next: Condition) => list.map((entry, at) => (at === index ? next : entry));
const removeAt = (list: Condition[], index: number) => list.filter((_, at) => at !== index);

export function FilterBar({ filter, onChange, project, actions, searchRef }: FilterBarProps) {
  const properties = useProperties();
  const known = properties.data?.items ?? [];
  // without a list of properties a property chip says it was not loaded, not that its field is unknown (T16-M5)
  const failed = properties.isError && !properties.data ? { retry: async () => !(await properties.refetch()).isError, retrying: properties.isFetching } : undefined;
  const ownSearch = useRef<HTMLInputElement>(null);
  const search = searchRef ?? ownSearch;
  const addButton = useRef<HTMLButtonElement>(null);
  const chips = useRef<HTMLUListElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Condition | null>(null);
  // the latest filter for the callbacks of the chips, which may report a change and leave in one go
  const latest = useRef(filter);
  useLayoutEffect(() => {
    latest.current = filter;
  });
  /** After a chip was removed: the place whose chip takes the focus. */
  const focusAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusAt.current === null) return;
    const at = focusAt.current;
    focusAt.current = null;
    const shown = chips.current?.querySelectorAll<HTMLElement>('[data-condition-chip]') ?? [];
    const next = shown[at] ?? shown[at - 1];
    (next?.querySelector<HTMLElement>('button') ?? addButton.current)?.focus();
  });

  const commit = (conditions: Condition[]) => {
    const next: Filter = { version: 1, conditions };
    latest.current = next;
    onChange(next);
  };

  const conditions = filter.conditions;
  const titleIndex = conditions.findIndex(isTitleSearch);
  const titleValue = titleIndex >= 0 && typeof conditions[titleIndex]!.value === 'string' ? (conditions[titleIndex]!.value as string) : '';
  /** The places of the chips, in the order they show: the title search has a field of its own. */
  const chipIndexes = conditions.flatMap((_, index) => (index === titleIndex ? [] : [index]));

  function setTitle(text: string) {
    const current = latest.current.conditions;
    const index = current.findIndex(isTitleSearch);
    if (text === '') commit(index >= 0 ? removeAt(current, index) : current);
    else if (index >= 0) commit(replaceAt(current, index, { field: 'title', op: 'contains', value: text }));
    else commit([...current, { field: 'title', op: 'contains', value: text }]);
  }

  /** A field was chosen in "Filter": answers whether its chip waits for a value (and takes the focus). */
  function add(def: FieldDef): boolean {
    const condition = newCondition(def);
    if (isComplete(condition)) {
      commit([...latest.current.conditions, condition]);
      setDraft(null);
      return false;
    }
    setDraft(condition);
    return true;
  }

  /** A chip goes; the focus moves on to the next one (`focusAt`). */
  function remove(index: number, place: number) {
    commit(removeAt(latest.current.conditions, index));
    focusAt.current = place;
  }

  useShortcut('list.search', () => search.current?.focus());
  useShortcut('list.filter', () => setAdding(true));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AddFilterMenu open={adding} onOpenChange={setAdding} properties={known} inProject={project !== undefined} onAdd={add} triggerRef={addButton} />
      <TitleSearch value={titleValue} onCommit={setTitle} inputRef={search} />
      {actions && <div className="ml-auto flex items-center gap-1.5 sm:order-last">{actions}</div>}
      {(chipIndexes.length > 0 || draft) && (
        <ul ref={chips} aria-label={t('items.filter.conditions')} className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-1">
          {[
            ...chipIndexes.map((index, place) => {
              const condition = conditions[index]!;
              // a property that is not loaded yet is no unknown field: its chip waits for the list
              const def = fieldDef(condition.field, known);
              if (!def && !properties.data && !properties.isError) return null;
              return (
                <li key={`${index}:${condition.field}`} className="min-w-0">
                  <ConditionChip
                    condition={condition}
                    def={def}
                    project={project}
                    failed={failed}
                    onChange={(next) => commit(replaceAt(latest.current.conditions, index, next))}
                    onRemove={() => remove(index, place)}
                    onLeave={() => {
                      const current = latest.current.conditions[index];
                      if (current && !isComplete(current)) commit(removeAt(latest.current.conditions, index));
                    }}
                  />
                </li>
              );
            }),
            // in the same list and with the key it will have in the filter: once complete, the chip stays the same
            // element (with its open list)
            draft && (
              <li key={`${conditions.length}:${draft.field}`} className="min-w-0">
                <ConditionChip
                  fresh
                  condition={draft}
                  def={fieldDef(draft.field, known)}
                  project={project}
                  onChange={(next) => {
                    if (isComplete(next)) {
                      setDraft(null);
                      commit([...latest.current.conditions, next]);
                    } else setDraft(next);
                  }}
                  onRemove={() => {
                    setDraft(null);
                    focusAt.current = chipIndexes.length;
                  }}
                  onLeave={() => setDraft(null)}
                />
              </li>
            ),
          ]}
        </ul>
      )}
    </div>
  );
}
