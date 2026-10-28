import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TypeTone } from '@/types';
import { cx } from './cx';

const DOTS: Record<TypeTone, string> = {
  sky: 'bg-sky',
  ochre: 'bg-ochre',
  moss: 'bg-moss',
  plum: 'bg-plum',
  sand: 'bg-sand',
  slate: 'bg-slate',
};

/** Colour dot of a label or dropdown option. */
export function ToneDot({ tone, className }: { tone: TypeTone; className?: string }) {
  return <span className={cx('size-1.5 shrink-0 rounded-full', DOTS[tone], className)} aria-hidden="true" />;
}

type ChipProps = {
  children: ReactNode;
  /** Leading icon (status, priority …). It is decorative: the chip's text says the same. */
  icon?: ReactNode;
  /** Colour dot of a label or option. */
  dot?: TypeTone;
  /** Shows a remove button with the accessible name `removeLabel`. */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
};

/** Chip for status, priority, label and option values: 6 px radius, line, surface. */
export function Chip({ children, icon, dot, onRemove, removeLabel, className }: ChipProps) {
  return (
    // removable chips grow to 44 px on phones, so the remove button is a real touch target
    <span className={cx('inline-flex max-w-full min-w-0 items-center gap-1 rounded-chip border border-line bg-surface px-1.5 text-sm text-ink', onRemove ? 'h-11 pr-0 md:h-6' : 'h-6', className)}>
      {dot && <ToneDot tone={dot} />}
      {icon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-6"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
