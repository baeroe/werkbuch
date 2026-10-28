/*
 * The filter bar of an item list (spec 4.11, moodboard): "Filter" adds a condition (`f`), the search field narrows by
 * title (`/`), and every condition is a chip (ConditionEditor). Conditions join with AND; within a field "eines von".
 *
 * - The search is the condition "Titel enthält"; it applies a moment after typing stops, or on Enter. Escape clears it,
 *   a second Escape leaves the field.
 * - A new condition first lives here, until its value is chosen: closing its editor without a value drops it again,
 *   so the list never shows "nothing matches" because of a half-made condition. A flag (Blockiert, Archiviert …) is
 *   complete at once.
 * - A chip whose values were all taken away goes when its editor closes.
 * `/` here wins over the shell's "/ opens the search" while the list is on screen.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Ban,
  CalendarArrowUp,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CircleDashed,
  ClockArrowUp,
  CornerLeftUp,
  FolderKanban,
  Hash,
  Link,
  ListFilter,
  ListTree,
  OctagonAlert,
  Search,
  Shapes,
  Signal,
  SquarePen,
  Tag,
  TextAlignStart,
  ToggleLeft,
  UserRound,
  UserRoundPen,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { fieldClass } from '@/components/ui/styles';
import { useProperties } from '@/hooks/properties';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Condition, Filter, Project, Property } from '@/types';
import { ConditionEditor } from './ConditionEditor';
import { CORE_FIELD_DEFS, fieldDef, isComplete, newCondition, propertyFieldDef, VALUELESS, type FieldDef } from './fieldOps';

const FIELD_ICONS: Record<string, LucideIcon> = {
  state: CircleDashed,
  state_category: Shapes,
  assignee: UserRound,
  priority: Signal,
  label: Tag,
  type: Shapes,
  project: FolderKanban,
  due_date: CalendarClock,
  start_date: CalendarArrowUp,
  created_by: UserRoundPen,
  created_at: CalendarPlus,
  updated_at: ClockArrowUp,
  closed_at: CalendarCheck,
  parent: CornerLeftUp,
  has_children: ListTree,
  blocked: Ban,
  blocking: OctagonAlert,
  archived: Archive,
};

const PROPERTY_ICONS: Record<Property['field_type'], LucideIcon> = {
  dropdown: ListFilter,
  member: Users,
  date: CalendarClock,
  boolean: ToggleLeft,
  number: Hash,
  text: SquarePen,
  url: Link,
  rich_text: TextAlignStart,
};

const isTitleSearch = (condition: Condition) => condition.field === 'title' && condition.op === 'contains';

/** The search field: the condition "Titel enthält". */
function TitleSearch({ value, onCommit, inputRef }: { value: string; onCommit: (text: string) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState(value);
  const commit = useRef(onCommit);
  useLayoutEffect(() => {
    commit.current = onCommit;
  });
  // a value from outside (Verwerfen, a link) shows unless somebody is typing
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(value);
  }, [value, inputRef]);
  // applies a moment after the typing stops
  useEffect(() => {
    if (text.trim() === value) return;
    const timer = setTimeout(() => commit.current(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, value]);

  return (
    <div className="relative flex h-11 min-w-0 flex-1 basis-40 items-center sm:max-w-64 md:h-7">
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        name="item-search"
        aria-label="Titel durchsuchen"
        aria-keyshortcuts="/"
        placeholder="Titel durchsuchen …"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit.current(text.trim());
          } else if (event.key === 'Escape') {
            // the first Escape clears, the next one leaves the field
            event.preventDefault();
            if (text !== '') {
              setText('');
              commit.current('');
            } else event.currentTarget.blur();
          }
        }}
        className={cx(fieldClass(false), 'h-full rounded-ctl pr-8 pl-7 text-input md:text-sm [&::-webkit-search-cancel-button]:hidden')}
      />
      {text !== '' ? (
        <IconButton
          icon={X}
          size="sm"
          label="Suche leeren"
          tooltip={false}
          className="absolute right-0.5"
          onClick={() => {
            setText('');
            commit.current('');
            inputRef.current?.focus();
          }}
        />
      ) : (
        <Kbd keys="/" className="pointer-events-none absolute right-1.5 max-md:hidden" aria-hidden="true" />
      )}
    </div>
  );
}

type FilterBarProps = {
  filter: Filter;
  onChange: (filter: Filter) => void;
  /** The project of a project list: its workflow's states, and no "Projekt" field (the list is the project). */
  project?: Project;
  /** On the right: the display menu and "Neues Item". */
  actions?: ReactNode;
};

const replaceAt = (list: Condition[], index: number, next: Condition) => list.map((entry, at) => (at === index ? next : entry));
const removeAt = (list: Condition[], index: number) => list.filter((_, at) => at !== index);

export function FilterBar({ filter, onChange, project, actions }: FilterBarProps) {
  const properties = useProperties().data?.items ?? [];
  const search = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraftState] = useState<Condition | null>(null);
  // the latest state for the callbacks of the editors, which may report a change and their close in one go
  const draftRef = useRef<Condition | null>(null);
  const latest = useRef(filter);
  useLayoutEffect(() => {
    latest.current = filter;
  });

  const setDraft = (next: Condition | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const commit = (conditions: Condition[]) => {
    const next: Filter = { version: 1, conditions };
    latest.current = next;
    onChange(next);
  };

  const conditions = filter.conditions;
  const titleIndex = conditions.findIndex(isTitleSearch);
  const titleValue = titleIndex >= 0 && typeof conditions[titleIndex].value === 'string' ? (conditions[titleIndex].value as string) : '';

  function setTitle(text: string) {
    const current = latest.current.conditions;
    const index = current.findIndex(isTitleSearch);
    if (text === '') commit(index >= 0 ? removeAt(current, index) : current);
    else if (index >= 0) commit(replaceAt(current, index, { field: 'title', op: 'contains', value: text }));
    else commit([...current, { field: 'title', op: 'contains', value: text }]);
  }

  function add(def: FieldDef) {
    setAdding(false);
    const condition = newCondition(def);
    if (isComplete(condition)) commit([...latest.current.conditions, condition]);
    else setDraft(condition);
  }

  useShortcut({ id: 'list.search', keys: '/', scope: 'list', label: 'Nach Titel filtern', group: 'Liste', run: () => search.current?.focus() });
  useShortcut({ id: 'list.filter', keys: 'f', scope: 'list', label: 'Bedingung hinzufügen', group: 'Liste', run: () => setAdding(true) });

  const coreFields = CORE_FIELD_DEFS.filter((def) => def.field !== 'title' && !(project && def.field === 'project'));

  return (
    // as tall as the bulk bar that takes its place, so the list does not jump when a selection starts
    <div className="flex min-h-[2.375rem] flex-wrap items-center gap-2">
      <Menu open={adding} onOpenChange={setAdding}>
        <MenuTrigger
          render={
            <Button variant="secondary" size="sm" icon={ListFilter} shortcut="f" className="max-sm:[&_kbd]:hidden">
              Filter
            </Button>
          }
        />
        <MenuContent className="max-h-[min(28rem,var(--available-height))]">
          <MenuGroup>
            <MenuGroupLabel>Felder</MenuGroupLabel>
            {coreFields.map((def) => (
              <MenuItem key={def.field} icon={FIELD_ICONS[def.field]} onClick={() => add(def)}>
                {def.label}
              </MenuItem>
            ))}
          </MenuGroup>
          {properties.length > 0 && (
            <>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Properties</MenuGroupLabel>
                {properties.map((property) => (
                  <MenuItem key={property.id} icon={PROPERTY_ICONS[property.field_type]} onClick={() => add(propertyFieldDef(property))}>
                    {property.label}
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          )}
        </MenuContent>
      </Menu>
      <TitleSearch value={titleValue} onCommit={setTitle} inputRef={search} />
      {actions && <div className="ml-auto flex items-center gap-1.5 sm:order-last">{actions}</div>}
      {(conditions.length > (titleIndex >= 0 ? 1 : 0) || draft) && (
        <ul aria-label="Bedingungen" className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-1">
          {conditions.map((condition, index) =>
            index === titleIndex ? null : (
              <li key={`${index}:${condition.field}`} className="min-w-0">
                <ConditionEditor
                  condition={condition}
                  def={fieldDef(condition.field, properties)}
                  project={project}
                  onChange={(next) => commit(replaceAt(latest.current.conditions, index, next))}
                  onRemove={() => commit(removeAt(latest.current.conditions, index))}
                  onDone={() => {
                    const current = latest.current.conditions[index];
                    if (current && !isComplete(current)) commit(removeAt(latest.current.conditions, index));
                  }}
                />
              </li>
            ),
          )}
          {draft && (
            <li key="draft" className="min-w-0">
              <ConditionEditor
                fresh
                condition={draft}
                def={fieldDef(draft.field, properties)}
                project={project}
                onChange={(next) => {
                  // "ist leer" and the like need no value: the condition is done
                  if (VALUELESS.has(next.op)) {
                    setDraft(null);
                    commit([...latest.current.conditions, next]);
                  } else setDraft(next);
                }}
                onRemove={() => setDraft(null)}
                onDone={() => {
                  const current = draftRef.current;
                  setDraft(null);
                  if (current && isComplete(current)) commit([...latest.current.conditions, current]);
                }}
              />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
