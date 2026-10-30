import { t } from '@/lib/i18n';
import type { Priority } from '@/types';
import { cx } from './cx';

/** Display names as in the spec (4.8). */
export const PRIORITY_LABELS: Record<Priority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'None' };

const FILLED: Record<Exclude<Priority, 'urgent'>, number> = { none: 0, low: 1, medium: 2, high: 3 };
const STROKE_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5'];

/** Three slanted pen strokes filled by level; Urgent is a red square with "!". Always with an accessible name. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const label = t('ui.priority_icon.label', { priority: PRIORITY_LABELS[priority] });

  if (priority === 'urgent') {
    return (
      <span
        role="img"
        aria-label={label}
        className={cx('inline-flex size-3.5 shrink-0 items-center justify-center rounded-chip bg-danger text-2xs leading-none font-semibold text-on-danger', className)}
      >
        !
      </span>
    );
  }

  return (
    <span role="img" aria-label={label} className={cx('inline-flex h-3.5 shrink-0 items-end gap-0.5', className)}>
      {STROKE_HEIGHTS.map((height, index) => (
        <span key={height} className={cx('w-1 -skew-x-12 rounded-full', height, index < FILLED[priority] ? 'bg-muted' : 'bg-line-strong')} />
      ))}
    </span>
  );
}
