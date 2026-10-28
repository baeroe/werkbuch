import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

type SwitchProps = Omit<ComponentProps<typeof BaseSwitch.Root>, 'className' | 'children' | 'onCheckedChange'> & {
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
};

/** On/off for settings that apply at once. Round track, ink blue when on. */
export function Switch({ label, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  const control = (
    <BaseSwitch.Root
      disabled={disabled}
      onCheckedChange={onCheckedChange ? (checked) => onCheckedChange(checked) : undefined}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full bg-line-input transition-colors duration-160 data-checked:bg-accent',
        // without a label row the track gets a larger hit area: 44 px high on phones, 24 px on desktop
        !label && 'after:absolute after:-inset-3 md:after:inset-x-0 md:after:-inset-y-0.5',
      )}
      {...rest}
    >
      <BaseSwitch.Thumb className="absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-elev-1 transition-transform duration-160 data-checked:translate-x-4" />
    </BaseSwitch.Root>
  );

  if (!label) return control;
  return (
    <label className={cx('flex min-h-11 items-center gap-3 text-ui text-ink md:min-h-8', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
      {control}
      {label}
    </label>
  );
}
