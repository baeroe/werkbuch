/*
 * "Filter" (`f`): the fields a condition can be about, in a list with a search field on top. Typing narrows it, the
 * arrows move, Enter adds a condition on the field. The core fields first, then the properties; on a project list the
 * project is the list itself and not offered, the title has the search field of its own.
 */

import { Combobox } from '@base-ui/react/combobox';
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
  Eye,
  FolderKanban,
  Hash,
  Layers,
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
} from 'lucide-react';
import { useRef, type Ref } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts, Kbd } from '@/components/ui/Kbd';
import { optionClass, popupFocus, popupSurface } from '@/components/ui/styles';
import { intlLocale, t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { Property } from '@/types';
import { CORE_FIELD_DEFS, fieldLabel, propertyFieldDef, type FieldDef } from './fieldOps';

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
  epic: Layers,
  subscribed: Eye,
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

interface FieldOption {
  value: string;
  label: string;
  def: FieldDef;
  icon: LucideIcon;
  /** "Property" after the label of a property. */
  hint?: string;
}

const matches = (option: FieldOption, query: string): boolean => {
  const locale = intlLocale();
  const haystack = [option.label, option.hint, option.value].join(' ').toLocaleLowerCase(locale);
  return query
    .toLocaleLowerCase(locale)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};

type AddFilterMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: readonly Property[];
  /** A project list: no "Projekt" field. */
  inProject: boolean;
  /** A field was chosen; answers whether its condition waits for a value (its chip then takes the focus). */
  onAdd: (def: FieldDef) => boolean;
  triggerRef?: Ref<HTMLButtonElement>;
};

export function AddFilterMenu({ open, onOpenChange, properties, inProject, onAdd, triggerRef }: AddFilterMenuProps) {
  // the chip of a condition that waits for a value takes the focus; otherwise it goes back to "Filter"
  const handedOn = useRef(false);
  const options: FieldOption[] = [
    ...CORE_FIELD_DEFS.filter((def) => def.field !== 'title' && !(inProject && def.field === 'project')).map((def) => ({
      value: def.field,
      label: fieldLabel(def),
      def,
      icon: FIELD_ICONS[def.field]!,
    })),
    ...properties.map((property) => {
      const def = propertyFieldDef(property);
      return { value: def.field, label: property.label, def, icon: PROPERTY_ICONS[property.field_type], hint: t('items.filter.add.property') };
    }),
  ];
  const keys = SHORTCUTS['list.filter'].keys;

  return (
    <Combobox.Root
      items={options}
      value={null}
      onValueChange={(next: FieldOption | null) => {
        if (next) handedOn.current = onAdd(next.def);
      }}
      itemToStringLabel={(option: FieldOption) => option.label}
      isItemEqualToValue={(option: FieldOption, other: FieldOption) => option.value === other.value}
      filter={(option: FieldOption, text: string) => matches(option, text)}
      autoHighlight
      open={open}
      onOpenChange={(next) => {
        if (next) handedOn.current = false;
        onOpenChange(next);
      }}
    >
      <Combobox.Trigger
        ref={triggerRef}
        aria-label={t('items.filter.add.label')}
        aria-keyshortcuts={ariaKeyshortcuts(keys)}
        className={buttonClass({ variant: 'secondary', size: 'sm' }, 'gap-1.5 pr-1.5')}
      >
        <ListFilter className="size-4 text-muted" aria-hidden="true" />
        {t('items.filter.add.label')}
        <Kbd keys={keys} aria-hidden="true" className="max-sm:hidden" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={6} className="z-50 outline-none">
          <Combobox.Popup
            {...popupFocus}
            finalFocus={() => !handedOn.current}
            aria-label={t('items.filter.add.list')}
            className={cx(popupSurface, 'flex w-72 max-w-[var(--available-width)] flex-col overflow-hidden')}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 focus-within:shadow-[inset_0_-2px_0_var(--focus-ring)]">
              <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <Combobox.Input
                name="filter-field"
                placeholder={t('items.filter.add.search')}
                aria-label={t('items.filter.add.search')}
                data-focus-ring="none"
                autoComplete="off"
                spellCheck={false}
                className="h-11 min-w-0 flex-1 bg-transparent text-input text-ink outline-none placeholder:text-muted md:h-9 md:text-ui"
              />
            </div>
            <Combobox.Empty className="px-3 py-2.5 text-ui text-pretty text-muted empty:hidden">{t('items.filter.add.empty')}</Combobox.Empty>
            <Combobox.List className="max-h-[min(24rem,calc(var(--available-height)-3rem))] overflow-y-auto overscroll-contain p-1 empty:p-0">
              {(option: FieldOption) => (
                <Combobox.Item key={option.value} value={option} className={optionClass}>
                  <option.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && <span className="shrink-0 text-sm text-muted">{option.hint}</span>}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
