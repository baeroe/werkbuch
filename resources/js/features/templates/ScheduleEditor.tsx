/*
 * The schedule of a template (spec 4.12), ported from the clickdummy: a switch "Nach Zeitplan anlegen", the schedule as
 * a sentence (`describeSchedule`), its settings (`ScheduleFields`) and the next five terms the server counts
 * (`NextRuns`). Without a schedule a template is applied by hand only. Switched off and on again, the schedule it had
 * comes back; the first one runs every week on today's weekday at 09:00 (`defaultSchedule`).
 *
 * Whoever may not manage templates reads the sentence, start, end and the organisation's zone, and the next terms. The
 * server's refusals (`schedule.<field>`) stand at their field; those without one shown (another frequency, the whole
 * schedule) stand below the settings, where the template editor's focus finds them (`data-refused`).
 */

import { CalendarClock, Pause } from 'lucide-react';
import { useId, useRef } from 'react';
import { formatDay } from '@/components/fields/format';
import { useToday } from '@/components/fields/itemData';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Switch } from '@/components/ui/Switch';
import { t, tn } from '@/lib/i18n';
import type { Schedule } from '@/types';
import { useTemplateTimes } from './format';
import { NextRuns } from './NextRuns';
import { defaultSchedule } from './scheduleForm';
import { ScheduleFields } from './ScheduleFields';
import { describeSchedule } from './scheduleText';

export type ScheduleEditorProps = {
  schedule: Schedule | null;
  onChange: (schedule: Schedule | null) => void;
  /** Viewers see the schedule, not its settings. */
  readOnly: boolean;
  /** The runs the template has had on its schedule. */
  runCount: number;
  /** The server's refusals by path (`schedule.time`, `schedule`, …). */
  errors?: Record<string, string>;
  /** The title of the template's items: the next terms ask with it, as the title's preview does. */
  title?: string;
  /** The id of the control of a field by its path (`schedule.time`). */
  fieldId: (path: string) => string;
  /** A typed field shows a text it cannot read (a message), or none any more (null). */
  onUnreadable?: (path: string, message: string | null) => void;
  className?: string;
};

/** The paths of the refusals the settings show at a field of theirs. */
function fieldPaths(s: Schedule): Set<string> {
  const paths = ['schedule.interval', 'schedule.time', 'schedule.starts_on'];
  if (s.ends.type !== 'never') paths.push('schedule.ends');
  if (s.frequency === 'monthly') paths.push(s.nth_weekday ? 'schedule.nth_weekday' : 'schedule.month_day');
  if (s.frequency === 'yearly') paths.push('schedule.yearly_date');
  return new Set(paths);
}

export function ScheduleEditor({ schedule, onChange, readOnly, runCount, errors = {}, title, fieldId, onUnreadable, className }: ScheduleEditorProps) {
  const headingId = useId();
  const { today } = useToday();
  const { zone } = useTemplateTimes();
  /** The schedule as it was before it was switched off, to come back with. */
  const lastSchedule = useRef<Schedule | null>(schedule);
  if (schedule) lastSchedule.current = schedule;

  const atFields = schedule && !readOnly ? fieldPaths(schedule) : new Set<string>();
  const others = Object.entries(errors).filter(([path]) => !atFields.has(path));

  return (
    <section aria-labelledby={headingId} className={cx('min-w-0 rounded-card border border-line bg-surface shadow-elev-1', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 md:px-5">
        <h2 id={headingId} className="font-display text-lg font-bold tracking-title text-ink">
          {t('templates.editor.schedule')}
        </h2>
        {!readOnly && (
          <Switch
            checked={schedule !== null}
            onCheckedChange={(on) => onChange(on ? (lastSchedule.current ?? defaultSchedule(today)) : null)}
            label={t('schedule.editor.switch')}
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
            {schedule.paused && <Chip icon={<Pause className="size-3" />}>{t('templates.paused')}</Chip>}
          </div>
          {readOnly ? (
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 pb-4 text-ui md:px-5">
              <dt className="text-muted">{t('schedule.editor.start')}</dt>
              <dd className="tabular-nums">{formatDay(schedule.starts_on)}</dd>
              <dt className="text-muted">{t('schedule.editor.end.label')}</dt>
              <dd className="tabular-nums">
                {schedule.ends.type === 'never'
                  ? t('schedule.editor.end.never')
                  : schedule.ends.type === 'on'
                    ? formatDay(schedule.ends.date)
                    : tn('schedule.editor.after_runs', schedule.ends.count)}
              </dd>
              <dt className="text-muted">{t('schedule.editor.timezone')}</dt>
              <dd>{zone}</dd>
            </dl>
          ) : (
            <ScheduleFields schedule={schedule} onChange={onChange} runCount={runCount} zone={zone} errors={errors} fieldId={fieldId} onUnreadable={onUnreadable} />
          )}
        </>
      ) : (
        <p className="flex items-start gap-2 px-4 pt-2 pb-4 text-ui text-pretty text-muted md:px-5">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('schedule.editor.none')}
        </p>
      )}
      {/* what the server refuses without a field shown here */}
      <div aria-live="polite">
        {others.length > 0 && (
          <div data-refused="" tabIndex={-1} className="mx-4 mb-4 flex flex-col gap-1 rounded-ctl outline-none focus-visible:outline-2 focus-visible:outline-(--focus-ring) md:mx-5">
            {others.map(([path, message]) => (
              <p key={path} className="text-sm font-medium text-pretty text-danger">
                {message}
              </p>
            ))}
          </div>
        )}
      </div>
      {schedule && <NextRuns schedule={schedule} runCount={runCount} title={title} />}
    </section>
  );
}
