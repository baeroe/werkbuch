/*
 * "Anzeige" (spec 4.11): how a list shows its items. Grouping, sorting with its direction, whether sub-items show, and
 * the fields (the list's chips, the table's columns), properties included. The layout itself switches in the header
 * (1–4). Every change is part of the view state, so for a view it is an unsaved change.
 */

import { ArrowDownWideNarrow, ArrowUpNarrowWide, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { ROW_FIELDS } from '@/components/items/ItemRowBase';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { useProperties } from '@/hooks/properties';
import type { Display, GroupBy, Property } from '@/types';
import { GROUP_BYS } from '../viewState';
import { GROUP_LABELS } from './grouping';

/** What a list can be sorted by (`sortItems`), besides number, date and text properties. */
const SORT_FIELDS: { value: string; label: string }[] = [
  { value: 'rank', label: 'Manuell' },
  { value: 'priority', label: 'Priorität' },
  { value: 'due_date', label: 'Due-Date' },
  { value: 'start_date', label: 'Start-Date' },
  { value: 'created_at', label: 'Angelegt' },
  { value: 'updated_at', label: 'Geändert' },
  { value: 'key', label: 'Key' },
  { value: 'state_category', label: 'Kategorie' },
];

const SORTABLE_PROPERTIES = new Set<Property['field_type']>(['number', 'date', 'text', 'url']);

/** The name of a display field: "Status", or a property's label. */
export function fieldLabel(field: string, properties: readonly Property[]): string {
  if (ROW_FIELDS[field]) return ROW_FIELDS[field];
  const property = properties.find((entry) => `property:${entry.key}` === field);
  return property?.label ?? field;
}

type DisplayMenuProps = {
  display: Display;
  onChange: (display: Display) => void;
  /** The grouping by status fell back to the categories (several workflows). */
  fellBack: boolean;
};

export function DisplayMenu({ display, onChange, fellBack }: DisplayMenuProps) {
  const properties = useProperties().data?.items ?? [];
  const fieldsId = useId();
  const set = (patch: Partial<Display>) => onChange({ ...display, ...patch });

  const sortOptions = [
    ...SORT_FIELDS,
    ...properties.filter((property) => SORTABLE_PROPERTIES.has(property.field_type)).map((property) => ({ value: `property:${property.key}`, label: property.label })),
  ];
  // a view may sort by something the menu does not offer (an old property): it stays choosable
  if (!sortOptions.some((option) => option.value === display.sort.field)) sortOptions.push({ value: display.sort.field, label: fieldLabel(display.sort.field, properties) });

  const fieldOptions = [...Object.keys(ROW_FIELDS), ...properties.map((property) => `property:${property.key}`)];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" icon={SlidersHorizontal}>
            <span className="max-sm:sr-only">Anzeige</span>
          </Button>
        }
      />
      <PopoverContent
        title="Anzeige"
        description="Wie die Liste ihre Items zeigt."
        align="end"
        className="max-h-[var(--available-height)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-4"
      >
        <div className="mt-4 flex flex-col gap-4">
          <Select
            label="Gruppierung"
            hint={fellBack ? 'Die Items haben mehrere Workflows, darum nach Kategorie.' : undefined}
            value={display.group_by}
            onValueChange={(next) => next && set({ group_by: next as GroupBy })}
            options={GROUP_BYS.map((value) => ({ value, label: GROUP_LABELS[value] }))}
          />
          <div className="flex flex-col gap-2">
            <Select label="Sortierung" value={display.sort.field} onValueChange={(next) => next && set({ sort: { ...display.sort, field: next } })} options={sortOptions} />
            <SegmentedControl
              label="Richtung"
              size="sm"
              value={display.sort.direction}
              onValueChange={(direction) => set({ sort: { ...display.sort, direction } })}
              options={[
                { value: 'asc', label: 'Aufsteigend', icon: ArrowUpNarrowWide },
                { value: 'desc', label: 'Absteigend', icon: ArrowDownWideNarrow },
              ]}
              className="self-start"
            />
          </div>
          <Switch label="Kind-Items zeigen" checked={display.show_sub_items} onCheckedChange={(show_sub_items) => set({ show_sub_items })} />
          <fieldset aria-describedby={`${fieldsId}-hint`}>
            <legend className={labelClass}>Felder</legend>
            <p id={`${fieldsId}-hint`} className="mt-0.5 text-sm text-muted">
              Chips in der Liste, Spalten in der Tabelle.
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3">
              {fieldOptions.map((field) => (
                <Checkbox
                  key={field}
                  label={<span className="truncate">{fieldLabel(field, properties)}</span>}
                  checked={display.fields.includes(field)}
                  onCheckedChange={(checked) => set({ fields: checked ? [...display.fields, field] : display.fields.filter((entry) => entry !== field) })}
                  className="min-w-0"
                />
              ))}
            </div>
          </fieldset>
        </div>
      </PopoverContent>
    </Popover>
  );
}
