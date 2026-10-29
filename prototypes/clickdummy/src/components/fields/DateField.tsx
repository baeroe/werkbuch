/*
 * Dates of an item (spec 4.8): start and due date, picked in a calendar on tracing paper (arrows, Page Up/Down and
 * Enter work it, see `Calendar`). The start must not lie after the due date: such a day is refused in place, with the
 * fix. An open item whose due date has passed is overdue: danger colour, its own icon and the word "überfällig".
 */

import { CalendarDays, CalendarX2, ChevronDown, CircleAlert } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Calendar } from '@/components/ui/Calendar';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { isClosedCategory } from '@/domain/workflow';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import type { WorkItem } from '@/types';
import { formatDay, formatShortDay, relativeDay } from './format';
import { useEditReason, useItemWorkflow, useToday } from './itemData';
import { PendingMark, ReadOnlyTrigger, triggerClass, withTooltip, type PickerExtras } from './Picker';

type DatePopoverProps = PickerExtras & {
  /** The field: "Due-Date"; the trigger is named "<label>: <displayText>". */
  label: string;
  value: string | null;
  /** A day was picked (null: removed). Answer a message to refuse it: the calendar stays open and shows it. */
  onChoose: (value: string | null) => string | null | void;
  display: ReactNode;
  displayText: string;
  /** Ids of the hint or error under the field (aria-describedby). */
  describedBy?: string;
  disabledReason?: string | null;
  pending?: boolean;
  invalid?: boolean;
  className?: string;
};

/**
 * Mounted while the calendar is open: its days hold the focus like a dialog does, so the page's shortcuts (p, s,
 * mod+backspace of the item) wait instead of acting on the item behind it.
 */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

/** A date trigger with its calendar; DateField and date properties use it. */
export function DatePopover({
  label,
  value,
  onChoose,
  display,
  displayText,
  describedBy,
  look = 'field',
  shortcut,
  disabledReason,
  pending = false,
  invalid = false,
  className,
  open,
  onOpenChange,
  defaultOpen,
  modal,
  keepSide,
  tabIndex,
  id,
}: DatePopoverProps) {
  const { today, weekStart } = useToday();
  const [innerOpen, setInnerOpen] = useState(defaultOpen ?? false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const days = useRef<HTMLDivElement>(null);
  // a calendar that starts open (the gallery's specimens) leaves the focus where it is that first time
  const startsOpen = useRef(Boolean(defaultOpen));
  const shown = open ?? innerOpen;
  const show = (next: boolean) => {
    if (open === undefined) setInnerOpen(next);
    if (next) setRefusal(null);
    onOpenChange?.(next);
  };
  const name = `${label}: ${displayText}`;
  const content = (
    <>
      {display}
      {pending && <PendingMark />}
      {look === 'form' && <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform duration-160 group-data-popup-open:rotate-180" aria-hidden="true" />}
    </>
  );

  if (disabledReason) {
    return (
      <ReadOnlyTrigger look={look} className={className} name={name} reason={disabledReason} tabIndex={tabIndex} id={id}>
        {content}
      </ReadOnlyTrigger>
    );
  }

  return (
    <Popover open={shown} onOpenChange={show} modal={modal}>
      {withTooltip(
        <PopoverTrigger
          render={
            <button
              type="button"
              id={id}
              aria-label={name}
              aria-describedby={describedBy}
              aria-busy={pending || undefined}
              aria-invalid={invalid || undefined}
              aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
              tabIndex={tabIndex}
              className={cx('group', triggerClass(look, { invalid, className }))}
            />
          }
        >
          {content}
        </PopoverTrigger>,
        shortcut ? `${label} setzen` : null,
        shortcut,
      )}
      {/* the focus starts on the chosen day (or today), so the arrows work at once */}
      <PopoverContent
        keepSide={keepSide}
        className="w-auto p-3"
        initialFocus={() => {
          if (startsOpen.current) {
            startsOpen.current = false;
            return false;
          }
          return days.current?.querySelector<HTMLElement>('[data-day][tabindex="0"]') ?? true;
        }}
      >
        <PausePageShortcuts />
        <div ref={days}>
          <Calendar
            value={value}
            today={today}
            weekStartsOn={weekStart}
            label={label}
            onChange={(next) => {
              const refused = onChoose(next);
              if (refused) setRefusal(refused);
              else show(false);
            }}
          />
        </div>
        {/* polite and always there, so a refusal that appears is announced */}
        <div aria-live="polite">
          {refusal && (
            <p className="mt-2 flex max-w-72 items-start gap-1.5 text-sm font-medium text-pretty text-danger">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {refusal}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A day as the trigger shows it: long with the distance to today, or short in a chip. Overdue in the danger colour. */
export function DayValue({ value, today, overdue, short = false, empty }: { value: string | null; today: string; overdue: boolean; short?: boolean; empty: string }) {
  const Icon = overdue ? CalendarX2 : CalendarDays;
  if (!value) {
    return (
      <>
        <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate text-muted">{empty}</span>
      </>
    );
  }
  return (
    <>
      <Icon className={cx('shrink-0', short ? 'size-3.5' : 'size-4', overdue ? 'text-danger' : 'text-muted')} aria-hidden="true" />
      <span className={cx('tabular-nums', overdue && 'font-medium text-danger')}>{short ? formatShortDay(value) : formatDay(value)}</span>
      {/* overdue is never colour alone: the word stands beside the day, in chips and cards too */}
      {overdue ? <span className="truncate font-medium text-danger">überfällig</span> : !short && <span className="truncate text-muted">{relativeDay(value, today)}</span>}
    </>
  );
}

const FIELDS = {
  start_date: { label: 'Start-Date', shortcut: 'shift+d', empty: 'Kein Start-Date' },
  due_date: { label: 'Due-Date', shortcut: 'd', empty: 'Kein Due-Date' },
} as const;

type DateFieldProps = PickerExtras & {
  item: WorkItem;
  field: 'start_date' | 'due_date';
};

/** Whether an item is overdue: an open item whose due date lies before today (the filter's `overdue`). */
export function useOverdue(item: WorkItem): boolean {
  const { today } = useToday();
  const { workflow } = useItemWorkflow(item);
  const category = workflow?.states.find((state) => state.id === item.state_id)?.category;
  return item.due_date !== null && item.due_date < today && category !== undefined && !isClosedCategory(category);
}

export function DateField({ item, field, look = 'field', shortcut, ...extras }: DateFieldProps) {
  const { today } = useToday();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const overdue = useOverdue(item) && field === 'due_date';
  const { label, empty } = FIELDS[field];
  const value = item[field];

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
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? FIELDS[field].shortcut : undefined)}
      label={label}
      value={value}
      onChoose={choose}
      display={<DayValue value={value} today={today} overdue={overdue} short={look !== 'field' && look !== 'form'} empty={empty} />}
      displayText={value ? `${formatDay(value)}${overdue ? ', überfällig' : ''}` : 'nicht gesetzt'}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
