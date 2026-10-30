import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import { keptSide, popupFocus, popupSurface } from './styles';

/*
 * Popover on tracing paper for content that belongs to its trigger (date picker, filter, emoji picker):
 *   <Popover><PopoverTrigger render={<Button …/>} /><PopoverContent title="…">…</PopoverContent></Popover>
 */
export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverClose = BasePopover.Close;

type PopoverContentProps = {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Keep the preferred side even without room. */
  keepSide?: boolean;
  /** Where the focus goes on open (an input, or false to leave it where it is); by default into the popover. */
  initialFocus?: ComponentProps<typeof BasePopover.Popup>['initialFocus'];
  /** Width and padding; default 18 rem with 12 px padding. */
  className?: string;
};

export function PopoverContent({ title, description, children, side = 'bottom', align = 'start', sideOffset = 6, keepSide, initialFocus, className }: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} collisionAvoidance={keepSide ? keptSide : undefined} className="z-50 outline-none">
        <BasePopover.Popup {...popupFocus} initialFocus={initialFocus} className={cx(popupSurface, 'max-w-[var(--available-width)]', className ?? 'w-72 p-3')}>
          {title && <BasePopover.Title className="font-display text-md font-bold tracking-title text-ink">{title}</BasePopover.Title>}
          {description && <BasePopover.Description className="mt-0.5 text-sm text-pretty text-muted">{description}</BasePopover.Description>}
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
