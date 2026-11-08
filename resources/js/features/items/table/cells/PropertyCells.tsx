/*
 * The cells of the properties (spec 4.11 "Inline-Bearbeitung mit der Tastatur"), ported from the clickdummy. They have
 * their own look here, because `PropertyField` only has the form look:
 * - dropdown and people open a picker, a date the calendar, yes/no switches with Enter;
 * - text, numbers, links and rich text open a small editor that saves on Enter (the rules of the property: numbers as
 *   people write them, http(s) only, a required value stays). Rich text only as plain paragraphs (spec "Änderungen vom
 *   2026-10-29", R17): a richer one shows read-only there, to be edited on the item.
 * A property the item's type does not have shows a dash. Every save is optimistic (`useUpdateWorkItem`); a refusal of
 * the server marks the cell with its words (the toast names it too), and the editor shows them at its field.
 */

import { Check, CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { personOption } from '@/components/fields/AssigneePicker';
import { DatePopover, DayValue } from '@/components/fields/DateField';
import { formatDay, formatPropertyValue } from '@/components/fields/format';
import { useEditReason, useProjectPeople, useToday, useUserMap } from '@/components/fields/itemData';
import { Picker, ReadOnlyTrigger, triggerClass, type PickerOption } from '@/components/fields/Picker';
import { idsOf, sameValue } from '@/components/fields/property/parse';
import { PropertyValueInput } from '@/components/fields/property/PropertyValueInput';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/Kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { tx } from '@/features/item-detail/activity/phrases';
import { useSettle } from '@/hooks/mutation';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import type { ListedItem, Property, PropertyValue } from '@/types';
import { typePropertyOf } from '../columns';
import type { EditProps } from './CoreCells';
import { NotApplicable } from './NotApplicable';

/** Saving the value of a cell: only a change goes out; the server's words of a refusal stay at the cell. */
interface Saving {
  save: (value: PropertyValue) => void;
  pending: boolean;
  refusal: string | null;
}

function useSave(item: ListedItem, property: Property): Saving {
  const settle = useSettle();
  const update = useUpdateWorkItem();
  const [refusal, setRefusal] = useState<string | null>(null);
  return {
    pending: update.isPending,
    refusal,
    save: (next) => {
      if (sameValue(next, item.values[property.key])) return;
      setRefusal(null);
      settle(update.mutateAsync({ id: item.id, patch: { values: { [property.key]: next } } }), {
        onError: (failure) => {
          const message = failure instanceof ApiError ? failure.errors?.[`values.${property.key}`]?.[0] : undefined;
          if (message) setRefusal(message);
        },
      });
    },
  };
}

type PropertyCellProps = EditProps & { item: ListedItem; property: Property };
type CellOf = PropertyCellProps & { saving: Saving; reason: string | null };

/** Names in a cell: the first one, then "+N". */
function Names({ entries }: { entries: { key: string; icon: ReactNode; label: string }[] }) {
  const [first, ...rest] = entries;
  if (!first) return <span className="text-muted">—</span>;
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

function OptionCell({ item, property, editing, onEditingChange, saving, reason }: CellOf) {
  const { save, pending } = saving;
  const ids = idsOf(item.values[property.key]);
  const options: PickerOption[] = property.options
    .filter((option) => option.archived_at === null || ids.includes(option.id))
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      value: option.id,
      label: option.label,
      hint: option.archived_at ? t('items.fields.property.archived') : undefined,
      icon: <ToneDot tone={option.color} className="size-2" />,
    }));
  const chosen = options.filter((option) => ids.includes(option.value));
  const common = {
    look: 'bare' as const,
    className: 'w-full px-1',
    label: property.label,
    display: <Names entries={chosen.map((option) => ({ key: option.value, icon: option.icon, label: option.label }))} />,
    displayText: chosen.map((option) => option.label).join(', ') || t('items.fields.property.no_choice_text'),
    placeholder: t('items.fields.property.search_option'),
    disabledReason: reason,
    pending,
    tabIndex: -1,
    open: editing,
    onOpenChange: onEditingChange,
  };
  if (property.settings.multiple === true) {
    return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => save(next.length > 0 ? next : null)} />;
  }
  const none = { value: '', label: t('items.fields.property.no_choice'), icon: <span className="size-2 rounded-full border border-dashed border-faint" /> };
  return <Picker {...common} options={[none, ...options]} value={ids[0] ?? ''} onValueChange={(next) => save(next || null)} />;
}

function MemberCell({ item, property, editing, onEditingChange, saving, reason }: CellOf) {
  const { save, pending } = saving;
  const { people, isLoading, error, retry, retrying } = useProjectPeople(item.project_id);
  const users = useUserMap();
  const ids = idsOf(item.values[property.key]);
  const chosen = ids.flatMap((id) => users.get(id) ?? []);
  const common = {
    look: 'bare' as const,
    className: 'w-full px-1',
    label: property.label,
    display: <Names entries={chosen.map((user) => ({ key: user.id, icon: <Avatar user={user} size="sm" decorative />, label: user.name }))} />,
    displayText: chosen.map((user) => user.name).join(', ') || t('items.fields.property.nobody_text'),
    placeholder: t('items.fields.property.search_person'),
    load: { isLoading, error, retry, retrying },
    disabledReason: reason,
    pending,
    tabIndex: -1,
    open: editing,
    onOpenChange: onEditingChange,
  };
  // people set before who are no longer offered (left the project, deactivated) stay while they are set
  const offered = people ?? [];
  const kept = chosen.filter((user) => !offered.some((entry) => entry.id === user.id)).map((user) => ({ ...personOption(user), hint: t('items.fields.property.not_offered') }));
  const options = [...offered.map(personOption), ...kept];
  if (property.settings.multiple === true) {
    return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => save(next.length > 0 ? next : null)} />;
  }
  const nobody = { value: '', label: t('items.fields.property.nobody'), icon: <UnassignedAvatar /> };
  return <Picker {...common} options={[nobody, ...options]} value={ids[0] ?? ''} onValueChange={(next) => save(next || null)} />;
}

function DateCell({ item, property, editing, onEditingChange, saving, reason }: CellOf) {
  const { today } = useToday();
  const value = item.values[property.key];
  const day = typeof value === 'string' ? value : null;
  return (
    <DatePopover
      look="bare"
      className="w-full px-1"
      label={property.label}
      value={day}
      onChoose={(next) => saving.save(next)}
      display={day ? <DayValue value={day} today={today} overdue={false} short empty="" /> : <span className="text-muted">—</span>}
      displayText={day ? formatDay(day) : t('items.fields.property.no_date')}
      disabledReason={reason}
      pending={saving.pending}
      tabIndex={-1}
      open={editing}
      onOpenChange={onEditingChange}
    />
  );
}

/** Yes/no: Enter on the cell switches it, like a click; off reads "Nein" with and without a value (A89). */
function BooleanCell({ item, property, editing, onEditingChange, saving, reason }: CellOf) {
  const on = item.values[property.key] === true;
  const word = on ? t('items.fields.yes') : t('items.fields.no');
  const content = on ? (
    <>
      <Check className="size-3.5 text-st-completed" aria-hidden="true" />
      {word}
    </>
  ) : (
    <span className="text-muted">{word}</span>
  );
  // the table opens the "editor" of the cell: that is one switch, then it is closed again
  const switched = useRef(false);
  useEffect(() => {
    if (!editing) {
      switched.current = false;
      return;
    }
    if (switched.current) return;
    switched.current = true;
    saving.save(!on);
    onEditingChange(false);
  }, [editing, on, saving, onEditingChange]);

  const name = t('items.fields.picker.name', { label: property.label, value: word });
  if (reason) {
    return (
      <ReadOnlyTrigger look="bare" className="gap-1 px-1" name={name} reason={reason} tabIndex={-1}>
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
      aria-busy={saving.pending || undefined}
      onClick={() => saving.save(!on)}
      className={triggerClass('bare', { className: 'gap-1 px-1' })}
    >
      {content}
    </button>
  );
}

/** Mounted while the editor of a cell is open: the page's shortcuts wait, as they do behind a dialog. */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

/** Text, number, link and plain rich text: a small editor in a popover, saved on Enter (or when the focus leaves). */
function TypedCell({ item, property, editing, onEditingChange, saving, reason, required }: CellOf & { required: boolean }) {
  const users = useUserMap();
  const value = item.values[property.key];
  const text = formatPropertyValue(property, value, (id) => users.get(id)?.name ?? t('items.fields.property.unknown_person'));
  const numeric = property.field_type === 'number';
  const shown = <span className={cx('truncate', numeric && 'tabular-nums', !text && 'text-muted')}>{text || '—'}</span>;
  const name = t('items.fields.picker.name', { label: property.label, value: text || t('items.fields.property.no_value_text') });

  if (reason) {
    return (
      <ReadOnlyTrigger look="bare" className={cx('w-full px-1', numeric && 'justify-end')} name={name} reason={reason} tabIndex={-1}>
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
            aria-label={name}
            aria-busy={saving.pending || undefined}
            aria-invalid={saving.refusal !== null || undefined}
            className={triggerClass('bare', { className: cx('w-full px-1', numeric && 'justify-end') })}
          />
        }
      >
        {shown}
      </PopoverTrigger>
      <PopoverContent title={property.label} className="w-[min(20rem,calc(100vw-2rem))] p-3">
        <PausePageShortcuts />
        <div className="mt-2">
          <PropertyValueInput
            property={property}
            value={value}
            onChange={() => undefined}
            onCommit={(next) => {
              saving.save(next);
              onEditingChange(false);
            }}
            projectId={item.project_id}
            required={required}
            error={saving.refusal}
            hideLabel
            hint={
              property.field_type === 'rich_text'
                ? tx('items.table.edit_hint_rich', { keys: <Kbd keys={SHORTCUTS['dialog.submit'].keys} /> })
                : tx('items.table.edit_hint', { keys: <Kbd keys="enter" /> })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The cell of a property: the dash when the type does not have it, else the editor of its field type. */
export function PropertyCell(props: PropertyCellProps) {
  const { item, property } = props;
  const types = useWorkItemTypes().data?.items;
  const saving = useSave(item, property);
  const reason = useEditReason(item);
  const assignment = typePropertyOf(types, item, property);
  if (!assignment) return <NotApplicable />;
  const cell = { ...props, saving, reason };
  let editor: ReactNode;
  switch (property.field_type) {
    case 'dropdown':
      editor = <OptionCell {...cell} />;
      break;
    case 'member':
      editor = <MemberCell {...cell} />;
      break;
    case 'date':
      editor = <DateCell {...cell} />;
      break;
    case 'boolean':
      editor = <BooleanCell {...cell} />;
      break;
    default:
      editor = <TypedCell {...cell} required={assignment.required} />;
  }
  if (saving.refusal === null) return editor;
  return (
    <span className="flex w-full min-w-0 items-center gap-1">
      <span className="flex min-w-0 flex-1">{editor}</span>
      <CircleAlert className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
      <span className="sr-only">{saving.refusal}</span>
    </span>
  );
}
