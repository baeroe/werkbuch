/*
 * The schedule of a template (spec 4.12): frequency, interval, weekdays, day of the month or n-th weekday, date of the
 * year, time, start, end and pause. Above the settings the schedule stands as a sentence (`describeSchedule`), below
 * them the next five runs (`nextOccurrences`, in the organisation's zone) with the title each run gives its item
 * (`renderTitle`). Without a schedule a template is applied by hand only.
 *
 * Typed numbers and the time report only valid values; a field that shows a text it refuses is marked invalid and the
 * editor around it does not save meanwhile (see TemplateEditor).
 */

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { CalendarClock, CalendarDays, CircleAlert, Pause } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { DatePopover } from '@/components/fields/DateField';
import { formatDay } from '@/components/fields/format';
import { useToday } from '@/components/fields/itemData';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { fieldClass, fieldSize, labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { renderTitle } from '@/domain/placeholders';
import { nextOccurrences } from '@/domain/recurrence';
import { addDays, daysInMonth, parseDate, parseTime, weekdayOf } from '@/domain/tz';
import { now } from '@/lib/clock';
import type { Schedule, ScheduleEnd, Weekday } from '@/types';
import { useOrgClock, useRunFormats } from './format';
import { defaultSchedule, withFrequency } from './scheduleForm';
import { describeSchedule, monthName, weekdayName } from './scheduleText';

const FREQUENCIES: SegmentOption<Schedule['frequency']>[] = [
  { value: 'daily', label: 'Täglich' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'monthly', label: 'Monatlich' },
  { value: 'yearly', label: 'Jährlich' },
];

/** Singular and plural of the unit the interval counts. */
const UNITS: Record<Schedule['frequency'], [string, string]> = {
  daily: ['Tag', 'Tage'],
  weekly: ['Woche', 'Wochen'],
  monthly: ['Monat', 'Monate'],
  yearly: ['Jahr', 'Jahre'],
};

/** The week as it is counted here: Monday first. */
const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const SHORT_WEEKDAY: Record<Weekday, string> = { 0: 'So', 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa' };

const ORDINAL_OPTIONS = [
  { value: '1', label: 'Erste' },
  { value: '2', label: 'Zweite' },
  { value: '3', label: 'Dritte' },
  { value: '4', label: 'Vierte' },
  { value: '-1', label: 'Letzte' },
];
const WEEKDAY_OPTIONS = WEEK.map((day) => ({ value: String(day), label: weekdayName(day) }));
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: monthName(index + 1) }));
const dayOptions = (days: number) => Array.from({ length: days }, (_, index) => ({ value: String(index + 1), label: `${index + 1}.` }));

const END_OPTIONS: SegmentOption<ScheduleEnd['type']>[] = [
  { value: 'never', label: 'Nie' },
  { value: 'on', label: 'Am Datum' },
  { value: 'count', label: 'Nach Läufen' },
];

const MONTH_MODES: SegmentOption<'day' | 'nth'>[] = [
  { value: 'day', label: 'Tag im Monat' },
  { value: 'nth', label: 'Wochentag im Monat' },
];

const pad = (value: number) => String(value).padStart(2, '0');

/** Whether the schedule can be read at all: a real start, time and end day. */
export function readableSchedule(s: Schedule): boolean {
  return parseDate(s.starts_on) !== null && parseTime(s.time) !== null && (s.ends.type !== 'on' || parseDate(s.ends.date) !== null);
}

/* -------------------------------------------------------------------------- typed fields */

type WholeNumberProps = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** The field's name in the form: "interval". */
  name: string;
  /** The accessible name: "Intervall in Wochen". */
  label: string;
  /** What to do when the text does not fit: "Eine ganze Zahl von 1 bis 99." */
  refusal: string;
  /** The id of the error under the field. */
  errorId: string;
  onError: (error: string | null) => void;
};

/** The error under a field: a polite live region that stays, so an error that appears is announced. */
function FieldError({ id, error }: { id: string; error: string | null | undefined }) {
  return (
    <div aria-live="polite">
      {error && (
        <p id={id} className="flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A typed text that reports only values that fit. A text that does not fit is marked (and its error shown under the
 * field) once the field is left or Enter is pressed, not at every key on the way.
 */
function useTypedText<T>(value: T, show: (value: T) => string, parse: (text: string) => T | null, refusal: string, onError: (error: string | null) => void) {
  const [text, setText] = useState(() => show(value));
  const [touched, setTouched] = useState(false);
  const latestText = useRef(text);
  latestText.current = text;
  const invalid = touched && parse(text) === null;

  useEffect(() => {
    onError(invalid ? refusal : null);
    // the error line follows the field's verdict
  }, [invalid]);

  // a value from outside (another frequency, a reload) shows unless the field means it already
  useEffect(() => {
    if (parse(latestText.current) !== value) {
      setText(show(value));
      setTouched(false);
    }
    // only a new value from outside resets the field
  }, [value]);

  return {
    text,
    invalid,
    onChange: (next: string, report: (value: T) => void) => {
      setText(next);
      const parsed = parse(next);
      if (parsed !== null) report(parsed);
    },
    touch: () => setTouched(true),
  };
}

/** A whole number typed: reports only values in range. */
function WholeNumber({ value, min, max, onChange, name, label, refusal, errorId, onError }: WholeNumberProps) {
  const field = useTypedText(
    value,
    String,
    (text) => (/^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= max ? Number(text) : null),
    refusal,
    onError,
  );
  return (
    <input
      type="text"
      name={name}
      inputMode="numeric"
      autoComplete="off"
      value={field.text}
      aria-label={label}
      aria-invalid={field.invalid || undefined}
      aria-describedby={field.invalid ? errorId : undefined}
      onChange={(event) => field.onChange(event.target.value, onChange)}
      onBlur={field.touch}
      onKeyDown={(event) => event.key === 'Enter' && field.touch()}
      className={cx(fieldClass(field.invalid), fieldSize, 'max-w-20 text-center tabular-nums')}
    />
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
function DateShown({ value, empty }: { value: string | null; empty: string }) {
  return (
    <>
      <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className={cx('truncate tabular-nums', !value && 'text-muted')}>{value ? formatDay(value) : empty}</span>
    </>
  );
}

/* ---------------------------------------------------------------------------- next runs */

type NextRunsProps = { schedule: Schedule; title: string; runCount: number };

/** The next five runs as leaves of a tear-off calendar, each with the title its item gets. */
export function NextRuns({ schedule, title, runCount }: NextRunsProps) {
  const { zone, locale } = useOrgClock();
  const formats = useRunFormats();
  const headingId = useId();
  const runs = readableSchedule(schedule) ? nextOccurrences(schedule, now(), 5, zone, runCount) : [];
  const shownTitle = title.trim() || 'Ohne Titel';

  let note: string | null = null;
  if (schedule.paused) note = 'Pausiert: Solange er pausiert, legt der Zeitplan keine Items an. „Jetzt ausführen“ geht trotzdem.';
  else if (!readableSchedule(schedule)) note = 'Der Zeitplan lässt sich so nicht lesen. Prüfe Beginn, Uhrzeit und Ende.';
  else if (runs.length === 0) note = 'Der Zeitplan ist zu Ende und legt keine Items mehr an. Ein späteres Ende oder mehr Läufe setzen ihn fort.';

  return (
    <div className="border-t border-line px-4 py-4 md:px-5">
      <h3 id={headingId} className="font-display text-md font-bold tracking-title text-ink">
        Nächste Termine
      </h3>
      {note ? (
        <p className="mt-2 flex items-start gap-2 text-ui text-pretty text-muted">
          {schedule.paused ? <Pause className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
          {note}
        </p>
      ) : (
        <ol aria-labelledby={headingId} className="mt-3 flex flex-col gap-2.5">
          {runs.map((at) => {
            const leaf = formats.leaf(at);
            return (
              <li key={at.toISOString()} className="flex items-center gap-3">
                <span aria-hidden="true" className="flex w-12 shrink-0 flex-col items-center rounded-ctl border border-line bg-surface py-1 leading-none shadow-elev-1">
                  <span className="text-2xs font-semibold text-muted">{leaf.weekday}</span>
                  <span className="mt-0.5 font-display text-lg leading-6 font-bold text-ink tabular-nums">{leaf.day}</span>
                  <span className="text-2xs text-muted">{leaf.month}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <time dateTime={at.toISOString()} className="block text-sm text-muted tabular-nums">
                    {formats.full(at)}
                  </time>
                  <span className="block truncate text-ui font-medium text-ink">{renderTitle(shownTitle, at, locale, zone)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------- editor */

type ScheduleEditorProps = {
  schedule: Schedule | null;
  onChange: (schedule: Schedule | null) => void;
  /** Viewers see the schedule, not its settings. */
  readOnly: boolean;
  /** The title of the template's items, for the titles of the next runs. */
  title: string;
  runCount: number;
  /** The server's refusal of the schedule. */
  error?: string | null;
  className?: string;
};

export function ScheduleEditor({ schedule, onChange, readOnly, title, runCount, error, className }: ScheduleEditorProps) {
  const headingId = useId();
  const errorId = useId();
  const { today } = useToday();
  const { zone } = useOrgClock();
  /** The schedule as it was before it was switched off, to come back with. */
  const lastSchedule = useRef<Schedule | null>(schedule);
  if (schedule) lastSchedule.current = schedule;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const fieldError = (key: string) => (error: string | null) => setFieldErrors((current) => (current[key] === error ? current : { ...current, [key]: error }));

  const set = (patch: Partial<Schedule>) => schedule && onChange({ ...schedule, ...patch });

  let settings: ReactNode = null;
  if (schedule && !readOnly) {
    const [unitOne, unitMany] = UNITS[schedule.frequency];
    const monthMode = schedule.nth_weekday ? 'nth' : 'day';
    const yearly = /^(\d{2})-(\d{2})$/.exec(schedule.yearly_date ?? '');
    const yearMonth = yearly ? Number(yearly[1]) : (parseDate(schedule.starts_on)?.month ?? 1);
    const yearDay = yearly ? Number(yearly[2]) : (parseDate(schedule.starts_on)?.day ?? 1);
    const endDate = schedule.ends.type === 'on' ? schedule.ends.date : null;

    settings = (
      <div data-typed="" className="flex flex-col gap-4 px-4 pb-4 md:px-5">
        <SegmentedControl label="Frequenz" value={schedule.frequency} onValueChange={(frequency) => onChange(withFrequency(schedule, frequency))} options={FREQUENCIES} className="self-start" />

        <Row label="Intervall">
          <div className="flex items-center gap-2 text-ui text-ink">
            <span aria-hidden="true">Alle</span>
            <WholeNumber
              value={schedule.interval}
              min={1}
              max={99}
              onChange={(interval) => set({ interval })}
              name="interval"
              label={`Intervall in ${unitMany}`}
              refusal="Eine ganze Zahl von 1 bis 99."
              errorId={`${errorId}-interval`}
              onError={fieldError('interval')}
            />
            <span aria-hidden="true">{schedule.interval === 1 ? unitOne : unitMany}</span>
          </div>
          <FieldError id={`${errorId}-interval`} error={fieldErrors.interval} />
        </Row>

        {schedule.frequency === 'weekly' && (
          <Row label="Wochentage">
            <ToggleGroup
              multiple
              aria-label="Wochentage"
              value={(schedule.weekdays?.length ? schedule.weekdays : [weekdayOf(schedule.starts_on)]).map(String)}
              // a weekly schedule runs on at least one day: the last pressed day stays
              onValueChange={(values: string[]) => values.length > 0 && set({ weekdays: values.map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) as Weekday[] })}
              className="inline-flex max-w-full flex-wrap self-start rounded-ctl border border-line bg-sunken p-1"
            >
              {WEEK.map((day) => (
                <Toggle
                  key={day}
                  value={String(day)}
                  aria-label={weekdayName(day)}
                  className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-chip text-ui font-medium text-muted transition-colors duration-120 hover:text-ink data-pressed:bg-surface data-pressed:font-semibold data-pressed:text-ink data-pressed:shadow-elev-1 md:h-8 md:w-9"
                >
                  {SHORT_WEEKDAY[day]}
                </Toggle>
              ))}
            </ToggleGroup>
          </Row>
        )}

        {schedule.frequency === 'monthly' && (
          <div className="flex flex-col gap-3">
            <SegmentedControl
              label="Art des Monatstags"
              size="sm"
              value={monthMode}
              onValueChange={(mode) => {
                const { month_day: _day, nth_weekday: _nth, ...rest } = schedule;
                if (mode === 'nth') onChange({ ...rest, nth_weekday: { n: 1, weekday: parseDate(schedule.starts_on) ? weekdayOf(schedule.starts_on) : 1 } });
                else onChange({ ...rest, month_day: parseDate(schedule.starts_on)?.day ?? 1 });
              }}
              options={MONTH_MODES}
              className="self-start"
            />
            {monthMode === 'day' ? (
              <Select
                label="Tag"
                options={[...dayOptions(31), { value: 'last', label: 'Letzter Tag' }]}
                value={String(schedule.month_day ?? parseDate(schedule.starts_on)?.day ?? 1)}
                onValueChange={(next) => next && set({ month_day: next === 'last' ? 'last' : Number(next) })}
                hint={typeof schedule.month_day === 'number' && schedule.month_day > 28 ? 'Monate ohne diesen Tag nehmen ihren letzten Tag.' : undefined}
                className="max-w-48"
              />
            ) : (
              <div className="grid max-w-md grid-cols-2 gap-3">
                <Select
                  label="Woche im Monat"
                  options={ORDINAL_OPTIONS}
                  value={String(schedule.nth_weekday?.n ?? 1)}
                  onValueChange={(next) => next && schedule.nth_weekday && set({ nth_weekday: { ...schedule.nth_weekday, n: Number(next) as 1 | 2 | 3 | 4 | -1 } })}
                />
                <Select
                  label="Wochentag"
                  options={WEEKDAY_OPTIONS}
                  value={String(schedule.nth_weekday?.weekday ?? 1)}
                  onValueChange={(next) => next && schedule.nth_weekday && set({ nth_weekday: { ...schedule.nth_weekday, weekday: Number(next) as Weekday } })}
                />
              </div>
            )}
          </div>
        )}

        {schedule.frequency === 'yearly' && (
          <div className="grid max-w-md grid-cols-[6rem_minmax(0,1fr)] gap-3">
            <Select
              label="Tag"
              options={dayOptions(daysInMonth(2028, yearMonth))}
              value={String(Math.min(yearDay, daysInMonth(2028, yearMonth)))}
              onValueChange={(next) => next && set({ yearly_date: `${pad(yearMonth)}-${pad(Number(next))}` })}
            />
            <Select
              label="Monat"
              options={MONTH_OPTIONS}
              value={String(yearMonth)}
              onValueChange={(next) => next && set({ yearly_date: `${pad(Number(next))}-${pad(Math.min(yearDay, daysInMonth(2028, Number(next))))}` })}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TimeField value={schedule.time} zone={zone} onChange={(time) => set({ time })} error={fieldErrors.time} onError={fieldError('time')} />
          <Row label="Beginn">
            <DatePopover
              look="form"
              label="Beginn"
              value={schedule.starts_on}
              display={<DateShown value={parseDate(schedule.starts_on) ? schedule.starts_on : null} empty="Kein Beginn" />}
              displayText={parseDate(schedule.starts_on) ? formatDay(schedule.starts_on) : 'kein Beginn'}
              onChoose={(next) => {
                if (!next) return 'Ein Zeitplan braucht einen Beginn.';
                if (endDate && next > endDate) return `Der Beginn läge nach dem Ende (${formatDay(endDate)}). Wähle einen früheren Tag oder verschiebe zuerst das Ende.`;
                set({ starts_on: next });
                return null;
              }}
            />
          </Row>
        </div>

        <Row label="Ende">
          <SegmentedControl
            label="Ende"
            size="sm"
            value={schedule.ends.type}
            onValueChange={(type) => {
              if (type === 'never') set({ ends: { type: 'never' } });
              else if (type === 'on') set({ ends: { type: 'on', date: addDays(today > schedule.starts_on ? today : schedule.starts_on, 90) } });
              else set({ ends: { type: 'count', count: 12 } });
            }}
            options={END_OPTIONS}
            className="self-start"
          />
          {schedule.ends.type === 'on' && endDate && (
            <DatePopover
              look="form"
              label="Ende"
              value={endDate}
              display={<DateShown value={endDate} empty="Kein Ende" />}
              displayText={formatDay(endDate)}
              onChoose={(next) => {
                if (!next) return 'Wähle einen Tag, oder stell das Ende auf „Nie“.';
                if (next < schedule.starts_on) return `Das Ende läge vor dem Beginn (${formatDay(schedule.starts_on)}). Wähle einen Tag ab dann.`;
                set({ ends: { type: 'on', date: next } });
                return null;
              }}
              className="mt-1 max-w-64"
            />
          )}
          {schedule.ends.type === 'count' && (
            <div className="mt-1 flex items-center gap-2 text-ui text-ink">
              <span aria-hidden="true">Nach</span>
              <WholeNumber
                value={schedule.ends.count}
                min={1}
                max={999}
                onChange={(count) => set({ ends: { type: 'count', count } })}
                name="count"
                label="Anzahl der Läufe"
                refusal="Eine ganze Zahl von 1 bis 999."
                errorId={`${errorId}-count`}
                onError={fieldError('count')}
              />
              <span aria-hidden="true">{schedule.ends.count === 1 ? 'Lauf' : 'Läufen'}</span>
            </div>
          )}
          {schedule.ends.type === 'count' && <FieldError id={`${errorId}-count`} error={fieldErrors.count} />}
          {runCount > 0 && schedule.ends.type === 'count' && <p className="text-sm text-muted">Bisher {runCount === 1 ? 'ein Lauf' : `${runCount} Läufe`} nach Zeitplan.</p>}
        </Row>

        <Switch checked={schedule.paused} onCheckedChange={(paused) => set({ paused })} label="Pausiert" className="self-start" />

        {/* what the server refuses of the schedule as a whole */}
        <div aria-live="polite">
          {error && (
            <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cx('rounded-card border border-line bg-surface shadow-elev-1', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 md:px-5">
        <h2 id={headingId} className="font-display text-lg font-bold tracking-title text-ink">
          Zeitplan
        </h2>
        {!readOnly && (
          <Switch
            checked={schedule !== null}
            onCheckedChange={(on) => onChange(on ? (lastSchedule.current ?? defaultSchedule(today)) : null)}
            label="Nach Zeitplan anlegen"
            className="ml-auto"
          />
        )}
      </div>
      {schedule ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-2 pb-4 md:px-5">
            <p aria-live="polite" className="font-display text-xl font-bold tracking-title text-balance text-ink">
              {describeSchedule(schedule)}
            </p>
            {schedule.paused && <Chip icon={<Pause className="size-3" />}>Pausiert</Chip>}
          </div>
          {readOnly && (
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 pb-4 text-ui md:px-5">
              <dt className="text-muted">Beginn</dt>
              <dd className="tabular-nums">{parseDate(schedule.starts_on) ? formatDay(schedule.starts_on) : '–'}</dd>
              <dt className="text-muted">Ende</dt>
              <dd className="tabular-nums">{schedule.ends.type === 'never' ? 'Nie' : schedule.ends.type === 'on' ? formatDay(schedule.ends.date) : `Nach ${schedule.ends.count} Läufen`}</dd>
              <dt className="text-muted">Zeitzone</dt>
              <dd>{zone}</dd>
            </dl>
          )}
          {settings}
          <NextRuns schedule={schedule} title={title} runCount={runCount} />
        </>
      ) : (
        <p className="flex items-start gap-2 px-4 pt-2 pb-4 text-ui text-pretty text-muted md:px-5">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Ohne Zeitplan wird die Vorlage von Hand angewendet: im Anlegen-Dialog oder mit „Jetzt ausführen“.
        </p>
      )}
    </section>
  );
}

/** "9:00", "09.00" or "09:00" as 'HH:MM'; null for anything else. */
export function normalizeTime(text: string): string | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (!match) return null;
  const time = `${match[1].padStart(2, '0')}:${match[2]}`;
  return parseTime(time) ? time : null;
}

/**
 * The time of day of the runs, in the organisation's zone, typed as 24-hour time. A text field instead of a time input:
 * that one shows the browser's own 12-hour clock in some languages.
 */
type TimeFieldProps = { value: string; zone: string; onChange: (time: string) => void; error: string | null | undefined; onError: (error: string | null) => void };

function TimeField({ value, zone, onChange, error, onError }: TimeFieldProps) {
  const id = useId();
  const field = useTypedText(value, (time) => time, normalizeTime, 'Gib eine Uhrzeit als Stunden und Minuten an, zum Beispiel 09:00.', onError);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        Uhrzeit
      </label>
      <input
        id={id}
        type="text"
        name="time"
        inputMode="numeric"
        autoComplete="off"
        placeholder="09:00"
        value={field.text}
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.invalid ? `${id}-error` : `${id}-hint`}
        onChange={(event) => field.onChange(event.target.value, onChange)}
        onBlur={field.touch}
        onKeyDown={(event) => event.key === 'Enter' && field.touch()}
        className={cx(fieldClass(field.invalid), fieldSize, 'max-w-28 tabular-nums')}
      />
      {!field.invalid && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          24-Stunden-Zeit, Zeitzone {zone}
        </p>
      )}
      <FieldError id={`${id}-error`} error={field.invalid ? error : null} />
    </div>
  );
}
