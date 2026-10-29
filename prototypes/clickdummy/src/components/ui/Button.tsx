import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cx } from './cx';
import { ariaKeyshortcuts, Kbd } from './Kbd';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';
type ButtonState = 'idle' | 'pending' | 'disabled';

const VARIANTS: Record<ButtonVariant, { look: string; hover: string; icon: string; kbd: 'muted' | 'current' }> = {
  primary: { look: 'bg-accent text-on-accent shadow-elev-1', hover: 'hover:bg-accent-hover', icon: '', kbd: 'current' },
  // hover: the sunken fill alone would sit closer to the paper, so the edge darkens as well
  secondary: { look: 'border border-line-strong bg-surface text-ink shadow-elev-1', hover: 'hover:border-line-input hover:bg-sunken', icon: 'text-muted', kbd: 'muted' },
  ghost: { look: 'text-ink', hover: 'hover:bg-hover', icon: 'text-muted', kbd: 'muted' },
  danger: { look: 'bg-danger text-on-danger shadow-elev-1', hover: 'hover:bg-danger-hover', icon: '', kbd: 'current' },
};

// 44 px touch targets on small screens, the denser desktop height from md on
const SIZES: Record<ButtonSize, string> = {
  md: 'h-11 gap-2 px-3 text-ui md:h-8',
  sm: 'h-11 gap-1.5 px-2.5 text-sm md:h-7',
};

/** The button look, also for links that act as buttons. */
export function buttonClass({ variant, size = 'md', state = 'idle' }: { variant: ButtonVariant; size?: ButtonSize; state?: ButtonState }, extra?: string): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center rounded-ctl font-semibold whitespace-nowrap no-underline transition-colors duration-120 select-none',
    SIZES[size],
    VARIANTS[variant].look,
    state === 'idle' && cx('cursor-pointer', VARIANTS[variant].hover),
    state === 'pending' && 'cursor-progress',
    state === 'disabled' && 'cursor-not-allowed opacity-50',
    extra,
  );
}

type ButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  variant: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Register notation ("c", "mod+backspace"); shown as kbd and exposed as aria-keyshortcuts. */
  shortcut?: string;
  /**
   * A running mutation: busy, the icon turns into a spinner, and a click does nothing. The button stays focusable
   * (`aria-disabled`, not `disabled`), so a focused button keeps the focus through the call.
   */
  pending?: boolean;
  /**
   * Not allowed right now: stays focusable and explains why (tooltip, aria-describedby). Pass it on every render of a
   * button that can be blocked, also as null: the button then sits in its tooltip throughout and stays the same
   * element, with the focus, when the reason comes and goes.
   */
  disabledReason?: string | null;
  children: ReactNode;
};

export function Button(props: ButtonProps) {
  const { variant, size = 'md', icon: Icon, shortcut, pending = false, disabledReason, disabled, onClick, className, children, type = 'button', ...rest } = props;
  const reasonId = useId();
  const blocked = Boolean(disabledReason) && !disabled && !pending;
  const state: ButtonState = pending ? 'pending' : disabled || blocked ? 'disabled' : 'idle';
  // Chromium moves the focus of a button that turns `disabled` to <body>: pending and blocked only look and act disabled
  const inert = pending || blocked;

  const button = (
    <button
      type={type}
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-disabled={inert || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
      // preventDefault also keeps a submit button from sending its form (a click, or Enter in one of its fields)
      onClick={inert ? (event) => event.preventDefault() : onClick}
      className={buttonClass({ variant, size, state }, cx(shortcut && (size === 'md' ? 'pr-2' : 'pr-1.5'), className))}
      {...rest}
    >
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon className={cx('size-4', VARIANTS[variant].icon)} aria-hidden="true" />
      )}
      {children}
      {shortcut && <Kbd keys={shortcut} tone={VARIANTS[variant].kbd} aria-hidden="true" />}
      {blocked && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
    </button>
  );

  if (!('disabledReason' in props)) return button;
  return (
    <Tooltip content={disabledReason} disabled={!blocked}>
      {button}
    </Tooltip>
  );
}
