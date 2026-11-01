/*
 * "Anzeige" (spec 4.11): how a list shows its items, ported from the clickdummy. Layout, grouping, sorting with its
 * direction, whether sub-items show, and the fields (the chips of a row, the columns of the table; a card on the board
 * shows labels, priority, due date and assignee of them), properties included. Every change is part of the view state:
 * for a view an unsaved change, for a built-in list just how one looks at it (P28), which "Als neue View speichern …" at
 * the end of the menu keeps.
 *
 * - The grouping by status falls back to the categories when the items span several workflows (P14): the menu then
 *   offers no status grouping, shows the categories as chosen and says why.
 * - A sort on something that is gone (a deleted property) stays visible as an unknown field; the list is in the manual
 *   order meanwhile (P2).
 */

import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, ChartGantt, List, SlidersHorizontal, SquareKanban, Table2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ROW_FIELDS } from '@/components/items/ItemRowBase';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { GROUP_BYS } from '@/domain/viewState';
import { t } from '@/lib/i18n';
import type { Display, GroupBy, Property } from '@/types';
import { LAYOUT_OPTIONS } from '../layouts';
import { PROPERTY_PREFIX } from '../filter/fieldOps';
import { GROUP_LABEL_KEYS } from './groupLabels';
import { isSortable, SORT_FIELDS, SORTABLE_TYPES } from './options';

const LAYOUT_ICONS = { list: List, board: SquareKanban, table: Table2, timeline: ChartGantt };

/** The name of a display field: "Status", or the label of a property. */
export function fieldLabel(field: string, properties: readonly Property[]): string {
  if (field === 'title') return t('items.display.field.title');
  if (field in ROW_FIELDS) return t(ROW_FIELDS[field as keyof typeof ROW_FIELDS]);
  const property = properties.find((entry) => `${PROPERTY_PREFIX}${entry.key}` === field);
  return property?.label ?? field;
}

type DisplayMenuProps = {
  display: Display;
  onChange(display: Display): void;
  /** The grouping by status fell back to the categories (the items have several workflows). */
  fellBack: boolean;
  properties: readonly Property[];
  /** A built-in list: saves what it shows as a new view, also when only the display changed (P28). */
  onSaveAs?(): void;
  /** Why "Als neue View speichern" is not possible (rights still loading), or null. */
  saveAsReason?: string | null;
};

export function DisplayMenu({ display, onChange, fellBack, properties, onSaveAs, saveAsReason = null }: DisplayMenuProps) {
  const [open, setOpen] = useState(false);
  const fieldsId = useId();
  const set = (patch: Partial<Display>) => onChange({ ...display, ...patch });

  const groupBy: GroupBy = fellBack && display.group_by === 'state' ? 'category' : display.group_by;
  const groupOptions = GROUP_BYS.filter((value) => !(fellBack && value === 'state')).map((value) => ({ value, label: t(GROUP_LABEL_KEYS[value]) }));

  const sortKnown = isSortable(display.sort.field, properties);
  const sortOptions = [
    ...SORT_FIELDS.map((option) => ({ value: option.value, label: t(option.label) })),
    ...properties.filter((property) => SORTABLE_TYPES.has(property.field_type)).map((property) => ({ value: `${PROPERTY_PREFIX}${property.key}`, label: property.label })),
    // a sort on a field that is gone stays shown as such; the list is in the manual order meanwhile
    ...(sortKnown ? [] : [{ value: display.sort.field, label: t('items.display.sort.unknown') }]),
  ];

  const fieldOptions = [...Object.keys(ROW_FIELDS), ...properties.map((property) => `${PROPERTY_PREFIX}${property.key}`)];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" icon={SlidersHorizontal}>
            <span className="max-sm:sr-only">{t('items.display.label')}</span>
          </Button>
        }
      />
      <PopoverContent
        title={t('items.display.label')}
        description={t('items.display.description')}
        align="end"
        className="max-h-[var(--available-height)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-4"
      >
        <div className="mt-4 flex flex-col gap-4">
          <SegmentedControl
            label={t('items.screen.layout')}
            size="sm"
            value={display.layout}
            onValueChange={(layout) => set({ layout })}
            options={LAYOUT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label), icon: LAYOUT_ICONS[option.value] }))}
            className="self-start"
          />
          <Select
            label={t('items.display.group_by')}
            hint={fellBack ? t('items.display.fell_back') : undefined}
            value={groupBy}
            onValueChange={(next) => next && set({ group_by: next as GroupBy })}
            options={groupOptions}
          />
          <div className="flex flex-col gap-2">
            <Select
              label={t('items.display.sort.label')}
              hint={sortKnown ? undefined : t('items.display.sort.unknown_hint')}
              value={display.sort.field}
              onValueChange={(field) => field && set({ sort: { ...display.sort, field } })}
              options={sortOptions}
            />
            <SegmentedControl
              label={t('items.display.direction.label')}
              size="sm"
              value={display.sort.direction}
              onValueChange={(direction) => set({ sort: { ...display.sort, direction } })}
              options={[
                { value: 'asc', label: t('items.display.direction.asc'), icon: ArrowUpNarrowWide },
                { value: 'desc', label: t('items.display.direction.desc'), icon: ArrowDownWideNarrow },
              ]}
              className="self-start"
            />
          </div>
          <Switch label={t('items.display.sub_items')} checked={display.show_sub_items} onCheckedChange={(show_sub_items) => set({ show_sub_items })} />
          <fieldset aria-describedby={`${fieldsId}-hint`}>
            <legend className={labelClass}>{t('items.display.fields.label')}</legend>
            <p id={`${fieldsId}-hint`} className="mt-0.5 text-sm text-pretty text-muted">
              {t('items.display.fields.hint')}
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
          {onSaveAs && (
            <Button
              variant="secondary"
              size="sm"
              icon={Bookmark}
              disabledReason={saveAsReason}
              onClick={() => {
                setOpen(false);
                onSaveAs();
              }}
              className="self-start"
            >
              {t('items.save.save_as')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
