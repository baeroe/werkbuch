/*
 * Typed fields of a schedule, ported from the clickdummy: a text that reports only values that fit (`useTypedText`),
 * its error line, and the time of the runs (`TimeField`). A text that does not fit is marked once the field is left or
 * Enter is pressed, not at every key on the way; the template editor hears at once that the field holds a text it
 * cannot read (`onUnreadable`), so it saves nothing meanwhile and puts the focus there. A field that goes (the schedule
 * switched off, another end) takes back what it could not read.
 */

import { CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { normalizeTime } from './scheduleForm';

type TypedText<T> = {
  value: T;
  show: (value: T) => string;
  parse: (text: string) => T | null;
  /** What to do when the text does not fit. */
  refusal: string;
  /** The path of the field in the API (`schedule.time`): the editor hears under it. */
  path: string;
  onUnreadable?: (path: string, message: string | null) => void;
};

/** A typed text that reports only values that fit; `error` is its own refusal once the field was left. */
export function useTypedText<T>({ value, show, parse, refusal, path, onUnreadable }: TypedText<T>) {
  const [text, setText] = useState(() => show(value));
  const [touched, setTouched] = useState(false);
  const latest = useRef({ text, parse, path, onUnreadable });
  latest.current = { text, parse, path, onUnreadable };
  const invalid = parse(text) === null;

  // a value from outside (another frequency, a saved template) shows, unless the field means it already
  useEffect(() => {
    const { text: shown, parse: read, path: at, onUnreadable: report } = latest.current;
    const meant = read(shown);
    if (meant === value) return;
    setText(show(value));
    setTouched(false);
    if (meant === null) report?.(at, null);
    // only a new value from outside resets the field
  }, [value]);

  // a field that goes takes back what it could not read
  useEffect(
    () => () => {
      const { text: shown, parse: read, path: at, onUnreadable: report } = latest.current;
      if (read(shown) === null) report?.(at, null);
    },
    [],
  );

  return {
    text,
    invalid: touched && invalid,
    error: touched && invalid ? refusal : null,
    change: (next: string, report: (value: T) => void) => {
      setText(next);
      const parsed = parse(next);
      if (parsed !== null) report(parsed);
      onUnreadable?.(path, parsed === null ? refusal : null);
    },
    touch: () => setTouched(true),
  };
}

/** The error under a field: a polite live region that stays, so an error that appears is announced. */
export function FieldError({ id, error }: { id: string; error: string | null | undefined }) {
  return (
    <div aria-live="polite">
      {error && (
        <p id={id} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

type TimeFieldProps = {
  id: string;
  value: string;
  /** The organisation's time zone the runs keep. */
  zone: string;
  onChange: (time: string) => void;
  /** The server's refusal of the time. */
  error?: string;
  onUnreadable?: (path: string, message: string | null) => void;
};

/**
 * The time of day of the runs, in the organisation's zone, typed as 24-hour time ("9", "9:5", "0930" are read too). A
 * text field instead of a time input: that one shows the browser's own 12-hour clock in some languages.
 */
export function TimeField({ id, value, zone, onChange, error, onUnreadable }: TimeFieldProps) {
  const field = useTypedText({ value, show: (time: string) => time, parse: normalizeTime, refusal: t('schedule.editor.time_invalid'), path: 'schedule.time', onUnreadable });
  return (
    <Input
      id={id}
      label={t('schedule.editor.time')}
      name="time"
      inputMode="numeric"
      autoComplete="off"
      placeholder="09:00"
      value={field.text}
      hint={t('schedule.editor.time_hint', { zone })}
      error={field.error ?? error}
      onChange={(event) => field.change(event.target.value, onChange)}
      onBlur={field.touch}
      onKeyDown={(event) => event.key === 'Enter' && field.touch()}
      className="max-w-28 tabular-nums"
    />
  );
}
