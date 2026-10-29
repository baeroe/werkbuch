import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { IconButton } from './IconButton';

// Days are calendar dates (YYYY-MM-DD), computed as UTC midnights so time zones and DST never shift them.
const DAY_MS = 86_400_000;
const toTime = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const toIso = (time: number) => new Date(time).toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => toIso(toTime(iso) + days * DAY_MS);
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
/** Same day in another month, cut to the month's last day (31 Jan + 1 month = 28/29 Feb). */
function addMonths(iso: string, months: number): string {
  const date = new Date(toTime(iso));
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toIso(target.getTime());
}
function deviceToday(): string {
  const now = new Date();
  return toIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

const monthTitle = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayName = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdayShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' });
const weekdayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' });

/** Six weeks from the start of the week that holds the 1st, so the height never jumps between months. */
function weeksOf(month: string, weekStartsOn: 0 | 1): string[][] {
  const first = toTime(month);
  const lead = (new Date(first).getUTCDay() - weekStartsOn + 7) % 7;
  const start = first - lead * DAY_MS;
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => toIso(start + (week * 7 + day) * DAY_MS)));
}

type CalendarProps = {
  /** Selected day as YYYY-MM-DD, or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** "Today" for the highlighter and the Heute button; the demo clock passes its date. */
  today?: string;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
  /** What is being picked, e.g. "Due-Date"; part of the grid's name. */
  label?: string;
  className?: string;
};

/**
 * Month grid. Arrow keys move by day and week, Home/End to the week's ends, Page Up/Down by month
 * (with Shift by year), Enter or Space picks. Today carries the highlighter, the chosen day ink blue.
 */
export function Calendar({ value, onChange, today = deviceToday(), weekStartsOn = 1, label = 'Datum', className }: CalendarProps) {
  const [focused, setFocused] = useState(value ?? today);
  const [month, setMonth] = useState(monthOf(value ?? today));
  const gridRef = useRef<HTMLTableElement>(null);
  const moveFocus = useRef(false);

  // a value set from outside (or by a click into the next month) brings its month into view
  useEffect(() => {
    if (!value) return;
    setFocused(value);
    setMonth(monthOf(value));
  }, [value]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused, month]);

  const goTo = (day: string) => {
    moveFocus.current = true;
    setFocused(day);
    setMonth(monthOf(day));
  };

  const pageMonth = (delta: number) => {
    setMonth(addMonths(month, delta));
    setFocused(addMonths(focused, delta));
  };

  const weekPosition = (day: string) => (new Date(toTime(day)).getUTCDay() - weekStartsOn + 7) % 7;

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const target: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekPosition(focused)),
      End: () => addDays(focused, 6 - weekPosition(focused)),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    const next = target[event.key];
    if (!next) return;
    event.preventDefault();
    goTo(next());
  };

  const weeks = weeksOf(month, weekStartsOn);
  const title = monthTitle.format(toTime(month));

  return (
    <div className={cx('w-fit max-w-full', className)}>
      <div className="flex items-center gap-1 pb-1">
        <p aria-live="polite" className="min-w-0 flex-1 pl-1 font-display text-md font-bold tracking-title text-ink">
          {title}
        </p>
        <IconButton icon={ChevronLeft} label="Voriger Monat" tooltip={false} onClick={() => pageMonth(-1)} />
        <IconButton icon={ChevronRight} label="Nächster Monat" tooltip={false} onClick={() => pageMonth(1)} />
      </div>
      {/* sized by its days, so it keeps its width inside a popup that fits its content */}
      <table ref={gridRef} role="grid" aria-label={`${label}, ${title}`} onKeyDown={onKeyDown} className="border-collapse">
        <thead>
          <tr>
            {weeks[0].map((day) => (
              <th key={day} scope="col" abbr={weekdayLong.format(toTime(day))} className="h-8 text-center text-sm font-medium text-muted">
                {weekdayShort.format(toTime(day)).replace('.', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const selected = day === value;
                const isToday = day === today;
                const inMonth = monthOf(day) === month;
                return (
                  <td key={day} role="gridcell" aria-selected={selected} className="p-px text-center">
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focused ? 0 : -1}
                      aria-label={dayName.format(toTime(day)) + (isToday ? ', heute' : '')}
                      aria-current={isToday ? 'date' : undefined}
                      onClick={() => {
                        setFocused(day);
                        onChange(day);
                      }}
                      className={cx(
                        'inline-flex size-11 cursor-pointer items-center justify-center rounded-ctl text-ui tabular-nums transition-colors duration-120 md:size-9',
                        selected ? 'bg-accent font-semibold text-on-accent' : cx('hover:bg-hover', inMonth ? 'text-ink' : 'text-muted'),
                      )}
                    >
                      <span className={cx(isToday && !selected && 'hl font-semibold')}>{Number(day.slice(8))}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            goTo(today);
            onChange(today);
          }}
        >
          Heute
        </Button>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Entfernen
          </Button>
        )}
      </div>
    </div>
  );
}
