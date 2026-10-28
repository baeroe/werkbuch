import type { TypeTone } from '@/types';
import { cx } from './cx';

const FILL: Record<TypeTone, string> = {
  sky: 'bg-sky',
  ochre: 'bg-ochre',
  moss: 'bg-moss',
  plum: 'bg-plum',
  sand: 'bg-sand',
  slate: 'bg-slate',
};

/** Up to this many parts the bar shows one segment per part; above it a continuous bar. */
const MAX_SEGMENTS = 12;

type ProgressBarProps = {
  done: number;
  total: number;
  /** What is being counted, e.g. "Kind-Items"; read out together with the numbers. */
  label: string;
  tone?: TypeTone;
  className?: string;
};

/** Progress of an epic: segments in the type's tone and the count in tabular figures. */
export function ProgressBar({ done, total, label, tone = 'moss', className }: ProgressBarProps) {
  const clamped = Math.min(Math.max(done, 0), total);
  const percent = total > 0 ? (clamped / total) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped} von ${total} fertig`}
      className={cx('flex items-center gap-2', className)}
    >
      {total > 0 && total <= MAX_SEGMENTS ? (
        <span className="grid flex-1 gap-0.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={cx('h-1.5 rounded-full', index < clamped ? FILL[tone] : 'bg-line')} />
          ))}
        </span>
      ) : (
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <span className={cx('absolute inset-y-0 left-0 rounded-full', FILL[tone])} style={{ width: `${percent}%` }} />
        </span>
      )}
      <span className="text-sm font-medium text-muted tabular-nums">
        {clamped}/{total}
      </span>
    </div>
  );
}
