/*
 * The cells of the table layout, one per display field (spec 4.11: "Inline-Bearbeitung mit der Tastatur").
 *
 * - Status, assignee, priority, labels and the dates open the same pickers as everywhere (look "bare", no tab stop of
 *   their own): Enter on the cell opens them, Escape closes them.
 * - Properties have their own cells here, because PropertyField only has the form look: dropdown and member open a
 *   picker, a date the calendar, yes/no switches with Enter, and text, numbers and links open a small editor that
 *   saves on Enter (the property's own rules: German numbers, http(s) only, required values stay).
 * - Project, created and changed only show. A property the item's type does not have shows a dash.
 * Every cell is controlled by the table: `editing` opens its editor, `onEditingChange(false)` reports that it closed.
 */

import { Check, Minus } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { AssigneePicker, personOption } from '@/components/fields/AssigneePicker';
import { DatePopover, DayValue, useOverdue } from '@/components/fields/DateField';
import { formatPropertyValue, formatDay } from '@/components/fields/format';
import { useEditReason, useProjectPeople, useToday, useUserMap } from '@/components/fields/itemData';
import { LabelsPicker } from '@/components/fields/LabelsPicker';
import { Picker, ReadOnlyTrigger, triggerClass, type PickerOption } from '@/components/fields/Picker';
import { PriorityPicker } from '@/components/fields/PriorityPicker';
import { PropertyValueInput } from '@/components/fields/PropertyField';
import { StatePicker } from '@/components/fields/StatePicker';
import { ROW_FIELDS } from '@/components/items/ItemRowBase';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { FieldType, Property, PropertyValue, WorkItem, WorkItemType } from '@/types';

export interface Column {
  /** The display field: `state`, `property:customer`. */
  field: string;
  label: string;
  /** In rem. */
  width: number;
  /** Enter edits it; otherwise it only shows. */
  editable: boolean;
  /** Numbers stand on the right. */
  numeric: boolean;
  property?: Property;
}

const WIDTHS: Record<string, number> = { state: 10, assignee: 11, priority: 8, labels: 13, start_date: 8.5, due_date: 10, project: 8, created_at: 7, updated_at: 7 };
const PROPERTY_WIDTHS: Record<FieldType, number> = { dropdown: 10, member: 11, date: 9, boolean: 6.5, number: 7.5, text: 12, url: 13, rich_text: 14 };
const READ_ONLY = new Set(['project', 'created_at', 'updated_at']);

/** The columns for the display fields, in their order; the key and the title live in the first column. */
export function tableColumns(fields: readonly string[], properties: readonly Property[]): Column[] {
  return fields.flatMap((field): Column[] => {
    if (field === 'key' || field === 'title') return [];
    if (field.startsWith('property:')) {
      const property = properties.find((entry) => `property:${entry.key}` === field);
      return property ? [{ field, label: property.label, width: PROPERTY_WIDTHS[property.field_type], editable: true, numeric: property.field_type === 'number', property }] : [];
    }
    return ROW_FIELDS[field] ? [{ field, label: ROW_FIELDS[field], width: WIDTHS[field] ?? 9, editable: !READ_ONLY.has(field), numeric: false }] : [];
  });
}

/** Whether the item's type has the property; without it the cell is a dash and nothing to edit. */
export function typeHasProperty(types: readonly WorkItemType[] | undefined, item: WorkItem, property: Property): boolean {
  return types?.find((type) => type.id === item.type_id)?.properties.some((entry) => entry.property_id === property.id) ?? false;
}

/* ------------------------------------------------------------------------- read only */

function NotApplicable() {
  return (
    <span className="px-1 text-faint">
      <Minus className="size-3.5" aria-hidden="true" />
      <span className="sr-only">gilt nicht für diesen Typ</span>
    </span>
  );
}

function ProjectCell({ item }: { item: WorkItem }) {
  const project = useProjects({ include_archived: true }).data?.items.find((entry) => entry.id === item.project_id);
  if (!project) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 px-1">
      <ProjectBadge project={project} className="size-4" />
      <span translate="no" className="truncate font-semibold tabular-nums">
        {project.identifier}
      </span>
    </span>
  );
}

const stampFormats = new Map<string, Intl.DateTimeFormat>();
function StampCell({ value }: { value: string }) {
  const timeZone = useOrganization().data?.timezone ?? 'Europe/Berlin';
  let format = stampFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone });
    stampFormats.set(timeZone, format);
  }
  return <span className="px-1 tabular-nums">{format.format(new Date(value))}</span>;
}

/** Labels; without the right to change them an empty cell is a dash, not the picker's "+ Label". */
function LabelsCell({ item, editing, onEditingChange }: { item: WorkItem } & EditProps) {
  const reason = useEditReason(item);
  if (reason && item.label_ids.length === 0) return <span className="px-1 text-muted">—</span>;
  return <LabelsPicker item={item} look="bare" tabIndex={-1} open={editing} onOpenChange={onEditingChange} />;
}

/* ----------------------------------------------------------------------------- dates */

const DATE_LABELS = { start_date: 'Start-Date', due_date: 'Due-Date' } as const;

/**
 * Start and due date: the calendar of the date fields, with a dash for no date (the field's own "Kein Due-Date" is too
 * long for a column). The same rule as DateField: the start must not lie after the due date.
 */
function CoreDateCell({ item, field, editing, onEditingChange }: { item: WorkItem; field: 'start_date' | 'due_date' } & EditProps) {
  const { today } = useToday();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const overdue = useOverdue(item) && field === 'due_date';
  const value = item[field];
  const label = DATE_LABELS[field];

  function choose(next: string | null): string | null {
    if (next === value) return null;
    if (next && field === 'start_date' && item.due_date && next > item.due_date) {
      return `Der Start liegt nach dem Due-Date (${formatDay(item.due_date)}). Wähle einen Tag bis dahin oder verschiebe zuerst das Due-Date.`;
    }
    if (next && field === 'due_date' && item.start_date && next < item.start_date) {
      return `Das Due-Date liegt vor dem Start (${formatDay(item.start_date)}). Wähle einen Tag ab dann oder verschiebe zuerst den Start.`;
    }
    update.mutate({ id: item.id, patch: { [field]: next } });
    return null;
  }

  return (
    <DatePopover
      look="bare"
      className="w-full px-1"
      label={label}
      value={value}
      onChoose={choose}
      display={value ? <DayValue value={value} today={today} overdue={overdue} short empty="" /> : <span className="text-muted">—</span>}
      displayText={value ? `${formatDay(value)}${overdue ? ', überfällig' : ''}` : 'nicht gesetzt'}
      disabledReason={reason}
      pending={update.isPending}
      tabIndex={-1}
      open={editing}
      onOpenChange={onEditingChange}
    />
  );
}

/* ------------------------------------------------------------------------ properties */

type EditProps = { editing: boolean; onEditingChange: (editing: boolean) => void };
type PropertyCellProps = EditProps & { item: WorkItem; property: Property };

function useSave(item: WorkItem, property: Property) {
  const update = useUpdateWorkItem();
  return { pending: update.isPending, save: (value: PropertyValue) => update.mutate({ id: item.id, patch: { values: { [property.key]: value } } }) };
}

const idsOf = (value: PropertyValue | undefined): string[] => (Array.isArray(value) ? value.map(String) : typeof value === 'string' && value !== '' ? [value] : []);

/** Names in a cell: the first one, then "+N". */
function Names({ entries }: { entries: { key: string; icon: ReactNode; label: string }[] }) {
  if (entries.length === 0) return <span className="text-muted">—</span>;
  const [first, ...rest] = entries;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {first.icon}
      </span>
      <span className="truncate">{first.label}</span>
      {rest.length > 0 && <span className="shrink-0 text-muted tabular-nums">+{rest.length}</span>}
    </span>
  );
}

function OptionCell({ item, property, editing, onEditingChange }: PropertyCellProps) {
  const reason = useEditReason(item);
  const { save, pending } = useSave(item, property);
  const ids = idsOf(item.values[property.key]);
  const multiple = property.settings.multiple === true;
  const options: PickerOption[] = property.options
    .filter((option) => option.archived_at === null || ids.includes(option.id))
    .sort((a, b) => a.position - b.position)
    .map((option) => ({ value: option.id, label: option.label, hint: option.archived_at ? 'archiviert' : undefined, icon: <ToneDot tone={option.color} className="size-2" /> }));
  const chosen = options.filter((option) => ids.includes(option.value));
  const common = {
    look: 'bare' as const,
    className: 'w-full px-1',
    label: property.label,
    display: <Names entries={chosen.map((option) => ({ key: option.value, icon: option.icon, label: option.label }))} />,
    displayText: chosen.map((option) => option.label).join(', ') || 'keine Auswahl',
    placeholder: 'Option suchen …',
    disabledReason: reason,
    pending,
    tabIndex: -1,
    open: editing,
    onOpenChange: onEditingChange,
  };
  if (multiple) return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => save(next.length > 0 ? next : null)} />;
  return <Picker {...common} options={[{ value: '', label: 'Keine Auswahl', icon: <span className="size-2 rounded-full border border-dashed border-faint" /> }, ...options]} value={ids[0] ?? ''} onValueChange={(next) => save(next || null)} />;
}

function MemberCell({ item, property, editing, onEditingChange }: PropertyCellProps) {
  const reason = useEditReason(item);
  const { save, pending } = useSave(item, property);
  const { people, isLoading, error, retry, retrying } = useProjectPeople(item.project_id);
  const users = useUserMap();
  const ids = idsOf(item.values[property.key]);
  const multiple = property.settings.multiple === true;
  const chosen = ids.flatMap((id) => users.get(id) ?? []);
  const common = {
    look: 'bare' as const,
    className: 'w-full px-1',
    label: property.label,
    display: <Names entries={chosen.map((user) => ({ key: user.id, icon: <Avatar user={user} size="sm" decorative />, label: user.name }))} />,
    displayText: chosen.map((user) => user.name).join(', ') || 'niemand',
    placeholder: 'Person suchen …',
    load: { isLoading, error, retry, retrying },
    disabledReason: reason,
    pending,
    tabIndex: -1,
    open: editing,
    onOpenChange: onEditingChange,
  };
  const options = (people ?? []).map(personOption);
  if (multiple) return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => save(next.length > 0 ? next : null)} />;
  return <Picker {...common} options={[{ value: '', label: 'Niemand', icon: <UnassignedAvatar /> }, ...options]} value={ids[0] ?? ''} onValueChange={(next) => save(next || null)} />;
}

function DateCell({ item, property, editing, onEditingChange }: PropertyCellProps) {
  const reason = useEditReason(item);
  const { save, pending } = useSave(item, property);
  const { today } = useToday();
  const value = item.values[property.key];
  const day = typeof value === 'string' ? value : null;
  return (
    <DatePopover
      look="bare"
      className="w-full px-1"
      label={property.label}
      value={day}
      onChoose={(next) => {
        if (next !== day) save(next);
      }}
      display={<DayValue value={day} today={today} overdue={false} short empty="—" />}
      displayText={day ? formatDay(day) : 'kein Datum'}
      disabledReason={reason}
      pending={pending}
      tabIndex={-1}
      open={editing}
      onOpenChange={onEditingChange}
    />
  );
}

function BooleanCell({ item, property, editing, onEditingChange }: PropertyCellProps) {
  const reason = useEditReason(item);
  const { save, pending } = useSave(item, property);
  const on = item.values[property.key] === true;
  const content = on ? (
    <>
      <Check className="size-3.5 text-st-completed" aria-hidden="true" />
      Ja
    </>
  ) : (
    <span className="text-muted">Nein</span>
  );
  // Enter switches it, like a click
  const switched = useRef(false);
  useEffect(() => {
    if (!editing) {
      switched.current = false;
      return;
    }
    if (switched.current) return;
    switched.current = true;
    if (!reason) save(!on);
    onEditingChange(false);
  }, [editing, reason, on, save, onEditingChange]);

  if (reason) {
    return (
      <ReadOnlyTrigger look="bare" className="px-1" name={`${property.label}: ${on ? 'Ja' : 'Nein'}`} reason={reason} tabIndex={-1}>
        {content}
      </ReadOnlyTrigger>
    );
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      role="switch"
      aria-checked={on}
      aria-label={property.label}
      aria-busy={pending || undefined}
      onClick={() => save(!on)}
      className={triggerClass('bare', { className: 'gap-1 px-1' })}
    >
      {content}
    </button>
  );
}

/** Text, number, link and plain rich text: a small editor in a popover, saved on Enter (or when the focus leaves). */
function TypedCell({ item, property, editing, onEditingChange, required }: PropertyCellProps & { required: boolean }) {
  const reason = useEditReason(item);
  const { save, pending } = useSave(item, property);
  const users = useUserMap();
  const value = item.values[property.key];
  const text = formatPropertyValue(property, value, (id) => users.get(id)?.name ?? 'Unbekannt');
  const shown = <span className={cx('truncate', property.field_type === 'number' && 'tabular-nums', !text && 'text-muted')}>{text || '—'}</span>;

  if (reason) {
    return (
      <ReadOnlyTrigger look="bare" className={cx('w-full px-1', property.field_type === 'number' && 'justify-end')} name={`${property.label}: ${text || 'kein Wert'}`} reason={reason} tabIndex={-1}>
        {shown}
      </ReadOnlyTrigger>
    );
  }
  return (
    <Popover open={editing} onOpenChange={onEditingChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${property.label}: ${text || 'kein Wert'}`}
            aria-busy={pending || undefined}
            className={triggerClass('bare', { className: cx('w-full px-1', property.field_type === 'number' && 'justify-end') })}
          />
        }
      >
        {shown}
      </PopoverTrigger>
      <PopoverContent title={property.label} className="w-[min(20rem,calc(100vw-2rem))] p-3">
        <div className="mt-2">
          <PropertyValueInput
            property={property}
            value={value}
            onChange={() => undefined}
            onCommit={(next) => {
              save(next);
              onEditingChange(false);
            }}
            projectId={item.project_id}
            required={required}
            hideLabel
            hint={property.field_type === 'rich_text' ? 'Mit ⌘↵ bzw. Strg+↵ speichern, Esc bricht ab.' : 'Enter speichert, Esc bricht ab.'}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PropertyCell(props: PropertyCellProps) {
  const { item, property } = props;
  const types = useWorkItemTypes().data?.items;
  const assignment = types?.find((type) => type.id === item.type_id)?.properties.find((entry) => entry.property_id === property.id);
  if (!assignment) return <NotApplicable />;
  switch (property.field_type) {
    case 'dropdown':
      return <OptionCell {...props} />;
    case 'member':
      return <MemberCell {...props} />;
    case 'date':
      return <DateCell {...props} />;
    case 'boolean':
      return <BooleanCell {...props} />;
    default:
      return <TypedCell {...props} required={assignment.required} />;
  }
}

/* ---------------------------------------------------------------------------- a cell */

type CellProps = EditProps & { item: WorkItem; column: Column };

export function Cell({ item, column, editing, onEditingChange }: CellProps) {
  const picker = { tabIndex: -1, open: editing, onOpenChange: onEditingChange } as const;
  switch (column.field) {
    case 'state':
      return <StatePicker item={item} look="bare" {...picker} />;
    case 'assignee':
      return <AssigneePicker item={item} look="bare" {...picker} />;
    case 'priority':
      return <PriorityPicker item={item} look="bare" {...picker} />;
    case 'labels':
      return <LabelsCell item={item} editing={editing} onEditingChange={onEditingChange} />;
    case 'start_date':
    case 'due_date':
      return <CoreDateCell item={item} field={column.field} editing={editing} onEditingChange={onEditingChange} />;
    case 'project':
      return <ProjectCell item={item} />;
    case 'created_at':
    case 'updated_at':
      return <StampCell value={item[column.field]} />;
    default:
      return column.property ? <PropertyCell item={item} property={column.property} editing={editing} onEditingChange={onEditingChange} /> : null;
  }
}
