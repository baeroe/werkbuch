import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { ariaKeyshortcuts } from './Kbd';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** A single key, shown small after the label (e.g. "2" for Board). */
  shortcut?: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  /** Accessible name of the group. */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentOption<T>[];
  size?: 'sm' | 'md';
  /** Only icons; the labels become accessible names and tooltips are up to the caller. */
  iconOnly?: boolean;
  className?: string;
};

/** One of a few views or modes. Segments (radius 6) sit concentrically in a sunken well (radius 10, 4 px inset). */
export function SegmentedControl<T extends string>({ label, value, onValueChange, options, size = 'md', iconOnly = false, className }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      // pressing the active segment would empty the group; a segmented control always keeps one
      onValueChange={(next) => next[0] && onValueChange(next[0] as T)}
      className={cx('inline-flex max-w-full flex-wrap rounded-ctl border border-line bg-sunken p-1', className)}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, shortcut, disabled }) => (
        <Toggle
          key={optionValue}
          value={optionValue}
          disabled={disabled}
          aria-label={iconOnly ? optionLabel : undefined}
          aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
          className={cx(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-chip font-medium text-muted transition-colors duration-120 hover:text-ink',
            'data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-elev-1 data-disabled:cursor-not-allowed data-disabled:opacity-50',
            size === 'md' ? 'h-11 px-2.5 text-ui md:h-8' : 'h-11 px-2 text-sm md:h-6',
            iconOnly && (size === 'md' ? 'w-11 justify-center px-0 md:w-8' : 'w-11 justify-center px-0 md:w-6'),
          )}
        >
          {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
          {!iconOnly && optionLabel}
          {shortcut && !iconOnly && (
            <span aria-hidden="true" className="text-2xs font-semibold text-muted tabular-nums">
              {shortcut.toUpperCase()}
            </span>
          )}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
