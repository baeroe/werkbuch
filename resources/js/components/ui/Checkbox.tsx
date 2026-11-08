import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

type CheckboxProps = Omit<ComponentProps<typeof BaseCheckbox.Root>, 'className' | 'children' | 'onCheckedChange'> & {
  /** Visible label; without it pass aria-label. */
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  /**
   * Not to be changed right now: the box keeps its tab stop and says why (tooltip, aria-describedby), like
   * `disabledReason` of a button. Pass it on every render of a box that can be blocked, also as null: the box then sits
   * in its tooltip throughout and stays the same element, with the focus, when the reason comes and goes.
   */
  disabledReason?: string | null;
};

/** Checkbox (radius 6) in ink blue when ticked, with the whole row as click target. */
export function Checkbox(props: CheckboxProps) {
  const { label, onCheckedChange, indeterminate, disabled, className, disabledReason, readOnly, 'aria-describedby': describedBy, ...rest } = props;
  const reasonId = useId();
  const blocked = Boolean(disabledReason) && !disabled;
  const locked = disabled || blocked;
  const box = (
    <BaseCheckbox.Root
      indeterminate={indeterminate}
      disabled={disabled}
      // readOnly, not disabled: it keeps the tab stop, and neither a click nor Space changes it
      readOnly={readOnly || blocked}
      aria-disabled={blocked || undefined}
      aria-describedby={[blocked ? reasonId : undefined, describedBy].filter(Boolean).join(' ') || undefined}
      onCheckedChange={onCheckedChange ? (checked) => onCheckedChange(checked) : undefined}
      className={cx(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-chip border border-line-input bg-surface text-on-accent transition-colors duration-120',
        'data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent aria-invalid:border-danger',
        !locked && 'data-unchecked:hover:border-ink',
        // a locked box looks locked, also without a label that dims with it (T18-M1); with one, the label dims both
        !label && 'data-disabled:opacity-50',
        !label && blocked && 'cursor-not-allowed opacity-50',
        // without a label row the 16 px box gets a larger hit area: 44 px on phones, 24 px on desktop
        !label && 'relative after:absolute after:-inset-3.5 md:after:-inset-1',
      )}
      {...rest}
    >
      <BaseCheckbox.Indicator className="flex">
        {indeterminate ? <Minus className="size-3" strokeWidth={3} aria-hidden="true" /> : <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
      </BaseCheckbox.Indicator>
      {blocked && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
    </BaseCheckbox.Root>
  );
  const shown =
    'disabledReason' in props ? (
      <Tooltip content={disabledReason} disabled={!blocked}>
        {box}
      </Tooltip>
    ) : (
      box
    );

  if (!label) return shown;
  return (
    <label className={cx('flex min-h-11 items-center gap-3 text-ui text-ink md:min-h-8', locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
      {shown}
      {label}
    </label>
  );
}
