/*
 * The settings of a schedule (spec 4.12), ported from the clickdummy's ScheduleEditor: frequency, "alle N …", the
 * weekdays (Monday first; values 0 = Sunday), the day of the month (1–31 or "letzter") or its n-th weekday, the date of
 * the year, the time in the organisation's zone, start, end (never, on a day, after N runs) and pause. Every change
 * reports the whole schedule in the normal form the server keeps (`scheduleForm.ts`). The server's refusals stand at
 * the field of their path (`schedule.interval`, `schedule.time`, …); the editor around shows the others.
 */

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { DatePopover } from '@/components/fields/DateField';
import { formatDay } from '@/components/fields/format';
import { useToday } from '@/components/fields/itemData';
import { cx } from '@/components/ui/cx';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { fieldClass, fieldSize, labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { addDays, daysInMonth, parseDate, weekdayOf } from '@/domain/tz';
import { t, tn, type TranslationKey } from '@/lib/i18n';
import type { Schedule, Weekday } from '@/types';
import { sortedWeekdays, withFrequency } from './scheduleForm';
import { monthName, weekdayName } from './scheduleText';
import { FieldError, TimeField, useTypedText } from './TimeField';

/** The highest interval and count the server takes (`Schedule::MAX_INTERVAL`, `MAX_COUNT`). */
export const MAX_INTERVAL = 999;
export const MAX_COUNT = 9999;

type Frequency = Schedule['frequency'];

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
const FREQUENCY_LABEL: Record<Frequency, TranslationKey> = {
  daily: 'schedule.editor.frequency.daily',
  weekly: 'schedule.editor.frequency.weekly',
  monthly: 'schedule.editor.frequency.monthly',
  yearly: 'schedule.editor.frequency.yearly',
};
const INTERVAL_IN: Record<Frequency, TranslationKey> = {
  daily: 'schedule.editor.interval_in.daily',
  weekly: 'schedule.editor.interval_in.weekly',
  monthly: 'schedule.editor.interval_in.monthly',
  yearly: 'schedule.editor.interval_in.yearly',
};
const UNIT = {
  daily: 'schedule.editor.unit.daily',
  weekly: 'schedule.editor.unit.weekly',
  monthly: 'schedule.editor.unit.monthly',
  yearly: 'schedule.editor.unit.yearly',
} as const;

/** The week as it is counted here: Monday first. */
const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const SHORT_WEEKDAY: Record<Weekday, TranslationKey> = {
  0: 'schedule.editor.weekday_short.sunday',
  1: 'schedule.editor.weekday_short.monday',
  2: 'schedule.editor.weekday_short.tuesday',
  3: 'schedule.editor.weekday_short.wednesday',
  4: 'schedule.editor.weekday_short.thursday',
  5: 'schedule.editor.weekday_short.friday',
  6: 'schedule.editor.weekday_short.saturday',
};
const ORDINALS: { value: NonNullable<Schedule['nth_weekday']>['n']; label: TranslationKey }[] = [
  { value: 1, label: 'schedule.editor.ordinal.first' },
  { value: 2, label: 'schedule.editor.ordinal.second' },
  { value: 3, label: 'schedule.editor.ordinal.third' },
  { value: 4, label: 'schedule.editor.ordinal.fourth' },
  { value: -1, label: 'schedule.editor.ordinal.last' },
];

/** A year with 29 February: the date of a yearly schedule may be it (other years take the 28th). */
const LEAP_YEAR = 2028;

const pad = (value: number) => String(value).padStart(2, '0');
const dayOptions = (days: number) => Array.from({ length: days }, (_, index) => ({ value: String(index + 1), label: t('schedule.editor.day_option', { day: index + 1 }) }));

type WholeNumberProps = {
  id: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** The accessible name: "Intervall in Wochen". */
  label: string;
  /** The path of the field in the API. */
  path: string;
  /** The server's refusal of the field. */
  error?: string;
  onUnreadable?: (path: string, message: string | null) => void;
  /** The words around the number: "Alle" … "Wochen". */
  before: string;
  after: string;
};

/** A whole number from 1 to `max` between its words, typed: reports only values in range; its error below. */
function WholeNumber({ id, value, max, onChange, label, path, error, onUnreadable, before, after }: WholeNumberProps) {
  const field = useTypedText({
    value,
    show: String,
    parse: (text: string) => (/^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= max ? Number(text) : null),
    refusal: t('schedule.editor.whole_number', { max }),
    path,
    onUnreadable,
  });
  const shown = field.error ?? error;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 text-ui text-ink">
        <span aria-hidden="true">{before}</span>
        <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={field.text}
        aria-label={label}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? `${id}-error` : undefined}
        onChange={(event) => field.change(event.target.value, onChange)}
        onBlur={field.touch}
        onKeyDown={(event) => event.key === 'Enter' && field.touch()}
        className={cx(fieldClass(Boolean(shown)), fieldSize, 'max-w-20 text-center tabular-nums')}
        />
        <span aria-hidden="true">{after}</span>
      </div>
      <FieldError id={`${id}-error`} error={shown} />
    </div>
  );
}

function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <span aria-hidden="true" className={labelClass}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** A day in a date field: the date alone, the distance to today would not fit beside it. */
function DateShown({ value }: { value: string }) {
  return (
    <>
      <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="truncate tabular-nums">{formatDay(value)}</span>
    </>
  );
}

export type ScheduleFieldsProps = {
  schedule: Schedule;
  onChange: (schedule: Schedule) => void;
  /** The runs the template has had on its schedule. */
  runCount: number;
  /** The organisation's time zone. */
  zone: string;
  /** The server's refusals by path (`schedule.time`, …). */
  errors: Record<string, string>;
  fieldId: (path: string) => string;
  onUnreadable?: (path: string, message: string | null) => void;
};

export function ScheduleFields({ schedule, onChange, runCount, zone, errors, fieldId, onUnreadable }: ScheduleFieldsProps) {
  const { today } = useToday();
  const set = (patch: Partial<Schedule>) => onChange({ ...schedule, ...patch });
  const start = parseDate(schedule.starts_on);
  const monthMode = schedule.nth_weekday ? 'nth' : 'day';
  const yearly = /^(\d{2})-(\d{2})$/.exec(schedule.yearly_date ?? '');
  const yearMonth = yearly ? Number(yearly[1]) : (start?.month ?? 1);
  const yearDay = yearly ? Number(yearly[2]) : (start?.day ?? 1);
  const endDate = schedule.ends.type === 'on' ? schedule.ends.date : null;
  const startId = fieldId('schedule.starts_on');
  const endId = fieldId('schedule.ends');

  const frequencies: SegmentOption<Frequency>[] = FREQUENCIES.map((value) => ({ value, label: t(FREQUENCY_LABEL[value]) }));
  const monthModes: SegmentOption<'day' | 'nth'>[] = [
    { value: 'day', label: t('schedule.editor.month_mode.day') },
    { value: 'nth', label: t('schedule.editor.month_mode.nth') },
  ];
  const ends: SegmentOption<Schedule['ends']['type']>[] = [
    { value: 'never', label: t('schedule.editor.end.never') },
    { value: 'on', label: t('schedule.editor.end.on') },
    { value: 'count', label: t('schedule.editor.end.count') },
  ];
  const weekdayOptions = WEEK.map((day) => ({ value: String(day), label: weekdayName(day) }));
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: monthName(index + 1) }));

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 md:px-5">
      <SegmentedControl label={t('schedule.editor.frequency.label')} value={schedule.frequency} onValueChange={(frequency) => onChange(withFrequency(schedule, frequency))} options={frequencies} className="self-start" />

      <Row label={t('schedule.editor.interval')}>
        <WholeNumber
          id={fieldId('schedule.interval')}
          value={schedule.interval}
          max={MAX_INTERVAL}
          onChange={(interval) => set({ interval })}
          label={t(INTERVAL_IN[schedule.frequency])}
          path="schedule.interval"
          error={errors['schedule.interval']}
          onUnreadable={onUnreadable}
          before={t('schedule.editor.every')}
          after={tn(UNIT[schedule.frequency], schedule.interval)}
        />
      </Row>

      {schedule.frequency === 'weekly' && (
        <Row label={t('schedule.editor.weekdays')}>
          <ToggleGroup
            multiple
            aria-label={t('schedule.editor.weekdays')}
            value={(schedule.weekdays?.length ? schedule.weekdays : [weekdayOf(schedule.starts_on)]).map(String)}
            // a weekly schedule runs on at least one day: the last pressed day stays
            onValueChange={(values: string[]) => values.length > 0 && set({ weekdays: sortedWeekdays(values.map(Number) as Weekday[]) })}
            className="inline-flex max-w-full flex-wrap self-start rounded-ctl border border-line bg-sunken p-1"
          >
            {WEEK.map((day) => (
              <Toggle
                key={day}
                value={String(day)}
                // the short day leads the name, so the name holds what the button shows (WCAG 2.5.3)
                aria-label={t('schedule.editor.weekday_name', { short: t(SHORT_WEEKDAY[day]), day: weekdayName(day) })}
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-chip text-ui font-medium text-muted transition-colors duration-120 hover:text-ink data-pressed:bg-surface data-pressed:font-semibold data-pressed:text-ink data-pressed:shadow-elev-1 md:h-8 md:w-9"
              >
                {t(SHORT_WEEKDAY[day])}
              </Toggle>
            ))}
          </ToggleGroup>
        </Row>
      )}

      {schedule.frequency === 'monthly' && (
        <div className="flex flex-col gap-3">
          <SegmentedControl
            label={t('schedule.editor.month_mode.label')}
            size="sm"
            value={monthMode}
            onValueChange={(mode) => {
              const { month_day: _day, nth_weekday: _nth, ...rest } = schedule;
              onChange(withFrequency(mode === 'nth' ? { ...rest, nth_weekday: { n: 1, weekday: weekdayOf(schedule.starts_on) } } : { ...rest, month_day: start?.day ?? 1 }, 'monthly'));
            }}
            options={monthModes}
            className="self-start"
          />
          {monthMode === 'day' ? (
            <Select
              id={fieldId('schedule.month_day')}
              label={t('schedule.editor.day')}
              options={[...dayOptions(31), { value: 'last', label: t('schedule.editor.last_day') }]}
              value={String(schedule.month_day ?? start?.day ?? 1)}
              onValueChange={(next) => next && set({ month_day: next === 'last' ? 'last' : Number(next) })}
              hint={typeof schedule.month_day === 'number' && schedule.month_day > 28 ? t('schedule.editor.day_falls_back') : undefined}
              error={errors['schedule.month_day']}
              className="max-w-48"
            />
          ) : (
            <div className="grid max-w-md grid-cols-2 gap-3">
              <Select
                id={fieldId('schedule.nth_weekday')}
                label={t('schedule.editor.week_of_month')}
                options={ORDINALS.map(({ value, label }) => ({ value: String(value), label: t(label) }))}
                value={String(schedule.nth_weekday!.n)}
                onValueChange={(next) => next && set({ nth_weekday: { ...schedule.nth_weekday!, n: Number(next) as 1 | 2 | 3 | 4 | -1 } })}
                error={errors['schedule.nth_weekday']}
              />
              <Select
                label={t('schedule.editor.weekday')}
                options={weekdayOptions}
                value={String(schedule.nth_weekday!.weekday)}
                onValueChange={(next) => next && set({ nth_weekday: { ...schedule.nth_weekday!, weekday: Number(next) as Weekday } })}
              />
            </div>
          )}
        </div>
      )}

      {schedule.frequency === 'yearly' && (
        <div className="grid max-w-md grid-cols-[6rem_minmax(0,1fr)] gap-3">
          <Select
            label={t('schedule.editor.day')}
            options={dayOptions(daysInMonth(LEAP_YEAR, yearMonth))}
            value={String(Math.min(yearDay, daysInMonth(LEAP_YEAR, yearMonth)))}
            onValueChange={(next) => next && set({ yearly_date: `${pad(yearMonth)}-${pad(Number(next))}` })}
          />
          <Select
            id={fieldId('schedule.yearly_date')}
            label={t('schedule.editor.month')}
            options={monthOptions}
            value={String(yearMonth)}
            onValueChange={(next) => next && set({ yearly_date: `${pad(Number(next))}-${pad(Math.min(yearDay, daysInMonth(LEAP_YEAR, Number(next))))}` })}
            error={errors['schedule.yearly_date']}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TimeField id={fieldId('schedule.time')} value={schedule.time} zone={zone} onChange={(time) => set({ time })} error={errors['schedule.time']} onUnreadable={onUnreadable} />
        <Row label={t('schedule.editor.start')}>
          <DatePopover
            id={startId}
            look="form"
            label={t('schedule.editor.start')}
            value={schedule.starts_on}
            display={<DateShown value={schedule.starts_on} />}
            displayText={formatDay(schedule.starts_on)}
            invalid={Boolean(errors['schedule.starts_on'])}
            describedBy={errors['schedule.starts_on'] ? `${startId}-error` : undefined}
            onChoose={(next) => {
              if (!next) return t('schedule.editor.start_required');
              if (endDate && next > endDate) return t('schedule.editor.start_after_end', { date: formatDay(endDate) });
              set({ starts_on: next });
              return null;
            }}
          />
          <FieldError id={`${startId}-error`} error={errors['schedule.starts_on']} />
        </Row>
      </div>

      <Row label={t('schedule.editor.end.label')}>
        <SegmentedControl
          label={t('schedule.editor.end.label')}
          size="sm"
          value={schedule.ends.type}
          onValueChange={(type) => {
            if (type === 'never') set({ ends: { type: 'never' } });
            else if (type === 'on') set({ ends: { type: 'on', date: addDays(today > schedule.starts_on ? today : schedule.starts_on, 90) } });
            else set({ ends: { type: 'count', count: 12 } });
          }}
          options={ends}
          className="self-start"
        />
        {endDate && (
          <>
            <DatePopover
              id={endId}
              look="form"
              label={t('schedule.editor.end.label')}
              value={endDate}
              display={<DateShown value={endDate} />}
              displayText={formatDay(endDate)}
              invalid={Boolean(errors['schedule.ends'])}
              describedBy={errors['schedule.ends'] ? `${endId}-error` : undefined}
              onChoose={(next) => {
                if (!next) return t('schedule.editor.end_required');
                if (next < schedule.starts_on) return t('schedule.editor.end_before_start', { date: formatDay(schedule.starts_on) });
                set({ ends: { type: 'on', date: next } });
                return null;
              }}
              className="mt-1 max-w-64"
            />
            <FieldError id={`${endId}-error`} error={errors['schedule.ends']} />
          </>
        )}
        {schedule.ends.type === 'count' && (
          <div className="mt-1">
            <WholeNumber
              id={endId}
              value={schedule.ends.count}
              max={MAX_COUNT}
              onChange={(count) => set({ ends: { type: 'count', count } })}
              label={t('schedule.editor.count')}
              path="schedule.ends"
              error={errors['schedule.ends']}
              onUnreadable={onUnreadable}
              before={t('schedule.editor.after')}
              after={tn('schedule.editor.runs_unit', schedule.ends.count)}
            />
          </div>
        )}
        {runCount > 0 && schedule.ends.type === 'count' && <p className="text-sm text-muted">{tn('schedule.editor.runs_so_far', runCount)}</p>}
      </Row>

      <Switch checked={schedule.paused} onCheckedChange={(paused) => set({ paused })} label={t('templates.paused')} className="self-start" />
    </div>
  );
}
