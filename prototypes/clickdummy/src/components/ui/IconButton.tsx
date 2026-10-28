import type { LucideIcon } from 'lucide-react';
import { useId, type ComponentProps } from 'react';
import { cx } from './cx';
import { ariaKeyshortcuts } from './Kbd';
import { Tooltip } from './Tooltip';

type IconButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  icon: LucideIcon;
  /** Accessible name; also the tooltip text. */
  label: string;
  shortcut?: string;
  /** 44 px on phones; on desktop sm is 24 px (inline add buttons), md 28 px (toolbars, panel header). */
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
  disabledReason?: string | null;
  /** Show the label as tooltip (default). Off where the label is visible anyway. */
  tooltip?: boolean;
};

const SIZES = {
  sm: 'size-11 md:size-6 [&>svg]:size-3.5',
  md: 'size-11 md:size-7 [&>svg]:size-4',
};

export function IconButton({ icon: Icon, label, shortcut, size = 'md', variant = 'ghost', disabledReason, disabled, tooltip = true, onClick, className, type = 'button', ...rest }: IconButtonProps) {
  const reasonId = useId();
  const blocked = Boolean(disabledReason) && !disabled;

  const button = (
    <button
      type={type}
      aria-label={label}
      disabled={disabled}
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
      onClick={blocked ? (event) => event.preventDefault() : onClick}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-chip text-muted transition-colors duration-120 aria-pressed:text-accent-text',
        SIZES[size],
        variant === 'secondary' && 'border border-line bg-surface shadow-elev-1',
        disabled || blocked ? 'cursor-not-allowed opacity-50' : cx('cursor-pointer hover:text-ink', variant === 'ghost' ? 'hover:bg-hover' : 'hover:border-line-input hover:bg-sunken'),
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" />
      {blocked && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
    </button>
  );

  if (!tooltip && !blocked) return button;
  return (
    <Tooltip content={blocked ? disabledReason : label} shortcut={blocked ? undefined : shortcut}>
      {button}
    </Tooltip>
  );
}
