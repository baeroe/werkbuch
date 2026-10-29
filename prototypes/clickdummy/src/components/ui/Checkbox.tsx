import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

type CheckboxProps = Omit<ComponentProps<typeof BaseCheckbox.Root>, 'className' | 'children' | 'onCheckedChange'> & {
  /** Visible label; without it pass aria-label. */
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
};

/** Checkbox (radius 6) in ink blue when ticked, with the whole row as click target. */
export function Checkbox({ label, onCheckedChange, indeterminate, disabled, className, ...rest }: CheckboxProps) {
  const box = (
    <BaseCheckbox.Root
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={onCheckedChange ? (checked) => onCheckedChange(checked) : undefined}
      className={cx(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-chip border border-line-input bg-surface text-on-accent transition-colors duration-120',
        'data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent aria-invalid:border-danger',
        !disabled && 'data-unchecked:hover:border-ink',
        // without a label row the 16 px box gets a larger hit area: 44 px on phones, 24 px on desktop
        !label && 'relative after:absolute after:-inset-3.5 md:after:-inset-1',
      )}
      {...rest}
    >
      <BaseCheckbox.Indicator className="flex">
        {indeterminate ? <Minus className="size-3" strokeWidth={3} aria-hidden="true" /> : <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) return box;
  return (
    <label className={cx('flex min-h-11 items-center gap-3 text-ui text-ink md:min-h-8', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
      {box}
      {label}
    </label>
  );
}
