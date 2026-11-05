/*
 * One template in the list of a project, ported from the clickdummy: the glyph of its type, its name as the link to
 * the template (it covers the whole row), its schedule in words (`describeSchedule`) or "only by hand", "Pausiert" for a
 * paused schedule, the title it gives its items, and its next run from `next_run_at` in the organisation's zone. The
 * last failed run is not shown per row (P4: that would ask once per template); the log of the template and the inbox
 * tell it. Whoever may manage templates gets "delete" after the link, a tab stop of its own.
 */

import { Link } from '@inertiajs/react';
import { CalendarClock, LayoutTemplate, Pause, Trash2 } from 'lucide-react';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/lib/i18n';
import type { Template, WorkItemType } from '@/types';
import { useTemplateTimes } from './format';
import { describeSchedule } from './scheduleText';

/** The row shows the focus ring of its link, which covers the whole row; its own controls sit above the link. */
const linkFocusRing =
  'has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-solid has-[[data-row-link]:focus-visible]:outline-(--focus-ring) has-[[data-row-link]:focus-visible]:[box-shadow:var(--focus-halo)]';

type TemplateRowProps = {
  template: Template;
  href: string;
  /** The type of its items, or undefined while the types load (or for a type that is gone). */
  type: WorkItemType | undefined;
  /** Deletes the template; without it (no right) the row has no delete. */
  onDelete?: (template: Template) => void;
};

export function TemplateRow({ template, href, type, onDelete }: TemplateRowProps) {
  const times = useTemplateTimes();
  const { schedule } = template;
  const next = template.next_run_at;

  return (
    <li
      className={cx(
        'relative grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-ctl bg-surface px-3 py-3 shadow-elev-1 transition-colors duration-120 hover:bg-sunken',
        'md:grid-cols-[2rem_minmax(0,1fr)_13rem_auto]',
        linkFocusRing,
      )}
    >
      <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-ctl border border-line bg-surface shadow-elev-1">
        {type ? <TypeGlyph type={type} /> : <LayoutTemplate className="size-4 text-muted" />}
      </span>
      <div className="min-w-0">
        <Link
          href={href}
          data-row-link=""
          data-focus-ring="none"
          className="block truncate rounded-chip text-ui font-semibold text-ink no-underline outline-none after:absolute after:inset-0 after:rounded-ctl"
        >
          {template.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{schedule ? describeSchedule(schedule) : t('templates.no_schedule')}</span>
          {schedule?.paused && <Chip icon={<Pause className="size-3" />}>{t('templates.paused')}</Chip>}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted">
          {t('templates.row.title')}{' '}
          <span translate="no" className="text-ink">
            {template.payload.title}
          </span>
        </p>
      </div>
      <div className="col-start-2 text-sm md:col-start-3 md:text-right">
        <p className="text-muted">{t('templates.row.next')}</p>
        <p className="font-medium text-ink tabular-nums">
          {next ? <time dateTime={next}>{times.moment(next)}</time> : schedule?.paused ? t('templates.paused') : t('templates.row.none_planned')}
        </p>
      </div>
      {onDelete && (
        <div className="relative z-10 col-start-2 flex items-center justify-end md:col-start-4 md:self-center">
          <IconButton icon={Trash2} label={t('templates.row.delete', { name: template.name })} onClick={() => onDelete(template)} />
        </div>
      )}
    </li>
  );
}
