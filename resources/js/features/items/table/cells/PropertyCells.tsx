/*
 * The cells of the properties (spec 4.11 "Inline-Bearbeitung mit der Tastatur"), ported from the clickdummy. They have
 * their own look here, because `PropertyField` only has the form look:
 * - dropdown and people open a picker, a date the calendar, yes/no switches with Enter;
 * - text, numbers, links and rich text open a small editor that saves on Enter (the rules of the property: numbers as
 *   people write them, http(s) only, a required value stays). Rich text only as plain paragraphs (spec "Änderungen vom
 *   2026-10-29", R17): a richer one shows read-only there, to be edited on the item.
 * A property the item's type does not have shows a dash. Every save is optimistic (`useUpdateWorkItem`); a refusal of
 * the server marks the cell with its words (the toast names it too), and the editor shows them at its field. The table
 * keeps those words per row (`useRefusals`), so a row that scrolls away and back still has them (T20-M5).
 */

import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { personOption } from '@/components/fields/AssigneePicker';
import { DatePopover, DayValue } from '@/components/fields/DateField';
import { cachedItems } from '@/components/fields/commands/context';
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
import { useSettle } from '@/hooks/mutation';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t, tx } from '@/lib/i18n';
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

/** The words of the server's refusal at a cell, kept by the table, and the way to follow a save of the cell. */
export interface CellRefusal {
  refusal: string | null;
  /** A save goes out: earlier words go, the words of this one stay once the server refuses it. */
  track: (call: Promise<unknown>) => void;
}

/** The words of a refusal and the `updated_at` of the item when the refusal came. */
interface Held {
  message: string;
  stamp: string;
}

/**
 * The refusals of the property cells of a table, by `<rowKey>:<property key>`: they live with the table, not with a
 * cell, so a row that scrolls away (the virtualizer unmounts it) still shows them when it comes back (T20-M5). Only the
 * newest save of a cell has its say (20a-M1: of two at once, a refused earlier one never marks a later one that went
 * through), and its words stay only while the item is as it stood when they came (20a-M2: a change from elsewhere,
 * live, the preview or another row of the item, makes them old).
 */
export function useRefusals(): (row: string, property: Property, item: ListedItem) => CellRefusal {
  const [words, setWords] = useState<ReadonlyMap<string, Held>>(() => new Map());
  /** The newest save of each cell. */
  const latest = useRef(new Map<string, object>());
  const queryClient = useQueryClient();
  const settle = useSettle();
  const put = useCallback((key: string, held: Held | null) => {
    setWords((current) => {
      if (held === null && !current.has(key)) return current;
      const next = new Map(current);
      if (held === null) next.delete(key);
      else next.set(key, held);
      return next;
    });
  }, []);
  return (row, property, item) => {
    const key = `${row}:${property.key}`;
    const held = words.get(key);
    return {
      refusal: held && held.stamp === item.updated_at ? held.message : null,
      track: (call) => {
        const token = {};
        latest.current.set(key, token);
        put(key, null);
        settle(call, {
          onError: (failure) => {
            if (latest.current.get(key) !== token) return;
            const message = failure instanceof ApiError ? failure.errors?.[`values.${property.key}`]?.[0] : undefined;
            if (!message) return;
            // the words belong to the item as it stands in the cache when they come, not as the save found it (an
            // earlier save of the cell may have gone through meanwhile, B1 review M1); read there, not in the render,
            // which may be one React drops or one of a row that scrolled away before live changed the item (B23-M2)
            const stamp = cachedItems(queryClient)(item.id)?.updated_at ?? item.updated_at;
            put(key, { message, stamp });
          },
        });
      },
    };
  };
}

function useSave(item: ListedItem, property: Property, { refusal, track }: CellRefusal): Saving {
  const update = useUpdateWorkItem();
  return {
    pending: update.isPending,
    refusal,
    save: (next) => {
      if (sameValue(next, item.values[property.key])) return;
      track(update.mutateAsync({ id: item.id, patch: { values: { [property.key]: next } } }));
    },
  };
}

type PropertyCellProps = EditProps & { item: ListedItem; property: Property; refusal: CellRefusal };
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

/**
 * Text, number, link and plain rich text: a small editor in a popover, saved on Enter (or when the focus leaves). A text
 * it cannot read keeps the popover open on a click beside it, with its error, as Enter does (T20-M10); Escape takes the
 * typing back first, then closes.
 */
function TypedCell({ item, property, editing, onEditingChange, saving, reason, required }: CellOf & { required: boolean }) {
  const users = useUserMap();
  /** The error of the typed text while it cannot be read. */
  const unreadable = useRef<string | null>(null);
  /** That error, shown since a click beside the editor was refused. */
  const [held, setHeld] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);
  // a closed editor forgets its text: the next one starts readable
  useEffect(() => {
    if (editing) return;
    unreadable.current = null;
    setHeld(null);
  }, [editing]);
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
    <Popover
      open={editing}
      onOpenChange={(open, details) => {
        if (!open && unreadable.current !== null) {
          details.cancel();
          setHeld(unreadable.current);
          // the focus stays in the field, as after Enter
          requestAnimationFrame(() => field.current?.querySelector<HTMLElement>('input, textarea')?.focus());
          return;
        }
        onEditingChange(open);
      }}
    >
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
        <div ref={field} className="mt-2">
          <PropertyValueInput
            property={property}
            value={value}
            onChange={() => undefined}
            onCommit={(next) => {
              saving.save(next);
              onEditingChange(false);
            }}
            onUnreadable={(message) => {
              unreadable.current = message;
              setHeld((shown) => (shown === null || message === null ? null : message));
            }}
            projectId={item.project_id}
            required={required}
            error={held ?? saving.refusal}
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
  const saving = useSave(item, property, props.refusal);
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
