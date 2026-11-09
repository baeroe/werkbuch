/*
 * Dates of an item (spec 4.8): start and due date, picked in a calendar on tracing paper (arrows, Page Up/Down and
 * Enter work it, see `Calendar`). The start must not lie after the due date: such a day is refused in place, with the
 * fix. When the server refuses it anyway (the other date changed meanwhile), its words show under the field; it names a
 * start after the due date at `due_date`, also when only the start was sent, so the start field reads that too. An open
 * item whose due date has passed is overdue: danger colour, its own icon and the word "überfällig".
 */

import { CalendarDays, CalendarX2, ChevronDown, CircleAlert } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Calendar } from '@/components/ui/Calendar';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { isClosedCategory } from '@/domain/workflow';
import { useSettle } from '@/hooks/mutation';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import type { ListedItem } from '@/types';
import { formatDay, formatLongDay, formatShortDay, relativeDay } from './format';
import { useEditReason, useItemWorkflow, useToday } from './itemData';
import { PendingMark, ReadOnlyTrigger, triggerClass, useFocusSwap, withTooltip, type PickerExtras } from './Picker';

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
  // a calendar that starts open leaves the focus where it is that first time
  const startsOpen = useRef(Boolean(defaultOpen));
  const shown = open ?? innerOpen;
  const show = (next: boolean) => {
    if (open === undefined) setInnerOpen(next);
    if (next) setRefusal(null);
    onOpenChange?.(next);
  };
  const name = t('items.fields.picker.name', { label, value: displayText });
  const content = (
    <>
      {display}
      {pending && <PendingMark />}
      {look === 'form' && <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform duration-160 group-data-popup-open:rotate-180" aria-hidden="true" />}
    </>
  );

  // the rights may arrive after the first render (or go): the focus stays on the trigger, also from an open calendar;
  // a calendar open when they go is closed, so it stays closed when they come back
  const { swap, popup } = useFocusSwap(Boolean(disabledReason), () => {
    if (shown) show(false);
  });

  if (disabledReason) {
    return (
      <ReadOnlyTrigger look={look} className={className} name={name} reason={disabledReason} tabIndex={tabIndex} id={id} swap={swap}>
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
              {...swap}
              className={cx('group', triggerClass(look, { invalid, className }))}
            />
          }
        >
          {content}
        </PopoverTrigger>,
        shortcut ? t('items.fields.date.set', { label }) : null,
        shortcut,
      )}
      {/* the focus starts on the chosen day (or today), so the arrows work at once */}
      <PopoverContent
        keepSide={keepSide}
        {...popup}
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

type DayShown = { value: string | null; today: string; overdue: boolean; short?: boolean; empty: string };

/**
 * The words DayValue shows, for the name of its trigger (`displayText`): a control's visible text stands in its name
 * (WCAG 2.5.3), so a field reads "Due date: 31/10/2026, in 3 days". A chip shows the day without its year: its name
 * adds the whole day in brackets, "Due date: 31/10 (31 October 2026), overdue" (axe leaves out what is in brackets
 * when it compares the visible text with the name).
 */
export function dayText({ value, today, overdue, short = false, empty }: DayShown): string {
  if (!value) return empty;
  const day = short ? t('items.fields.date.short_text', { day: formatShortDay(value), full: formatLongDay(value) }) : formatDay(value);
  if (overdue) return t('items.fields.date.overdue_text', { day });
  return short ? day : t('items.fields.date.relative_text', { day, relative: relativeDay(value, today) });
}

/** A day as the trigger shows it: long with the distance to today, or short in a chip. Overdue in the danger colour. */
export function DayValue({ value, today, overdue, short = false, empty }: DayShown) {
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
      {/* a space between the words, which the flex gap does not draw: read as text, the day and the word stay two
          words (axe joins the text of elements as it stands, "31.10.2026überfällig") */}
      {(overdue || !short) && ' '}
      {/* overdue is never colour alone: the word stands beside the day, in chips and cards too */}
      {overdue ? (
        <span className="truncate font-medium text-danger">{t('items.fields.date.overdue')}</span>
      ) : (
        !short && <span className="truncate text-muted">{relativeDay(value, today)}</span>
      )}
    </>
  );
}

const FIELDS = {
  start_date: { label: 'items.fields.date.start', shortcut: SHORTCUTS['item.start'].keys, empty: 'items.fields.date.no_start' },
  due_date: { label: 'items.fields.date.due', shortcut: SHORTCUTS['item.due'].keys, empty: 'items.fields.date.no_due' },
} as const;

type DateFieldProps = PickerExtras & {
  item: ListedItem;
  field: 'start_date' | 'due_date';
};

/** Whether an item is overdue: an open item whose due date lies before today in the organisation's zone. */
export function useOverdue(item: ListedItem): boolean {
  const { today } = useToday();
  const { workflow } = useItemWorkflow(item);
  const category = workflow?.states.find((state) => state.id === item.state_id)?.category;
  return item.due_date !== null && item.due_date < today && category !== undefined && !isClosedCategory(category);
}

export function DateField({ item, field, look = 'field', shortcut, ...extras }: DateFieldProps) {
  const settle = useSettle();
  const { today } = useToday();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const errorId = useId();
  // the server's refusal of the last change, under the field
  const [refusal, setRefusal] = useState<string | null>(null);
  const overdue = useOverdue(item) && field === 'due_date';
  const label = t(FIELDS[field].label);
  const value = item[field];
  const shown: DayShown = { value, today, overdue, short: look !== 'field' && look !== 'form', empty: t(FIELDS[field].empty) };

  function choose(next: string | null): string | null {
    if (next === value) return null;
    if (next && field === 'start_date' && item.due_date && next > item.due_date) {
      return t('items.fields.date.start_after_due', { day: formatDay(item.due_date) });
    }
    if (next && field === 'due_date' && item.start_date && next < item.start_date) {
      return t('items.fields.date.due_before_start', { day: formatDay(item.start_date) });
    }
    setRefusal(null);
    settle(update.mutateAsync({ id: item.id, patch: { [field]: next } }), {
      // the toast names the cause too; the field shows the server's words where the change was made
      onError: (failure) => {
        const errors = failure instanceof ApiError ? failure.errors : undefined;
        const message = (errors?.[field] ?? errors?.due_date)?.[0];
        if (message) setRefusal(message);
      },
    });
    return null;
  }

  return (
    <span className="inline-flex max-w-full min-w-0 flex-col items-start">
      <DatePopover
        {...extras}
        look={look}
        shortcut={shortcut ?? (look === 'field' ? FIELDS[field].shortcut : undefined)}
        label={label}
        value={value}
        onChoose={choose}
        display={<DayValue {...shown} />}
        displayText={dayText(shown)}
        describedBy={refusal ? errorId : undefined}
        invalid={refusal !== null}
        disabledReason={reason}
        pending={update.isPending}
      />
      <span aria-live="polite">
        {refusal && (
          <span id={errorId} className="mt-1 flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {refusal}
          </span>
        )}
      </span>
    </span>
  );
}
