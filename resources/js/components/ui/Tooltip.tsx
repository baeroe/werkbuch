import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';
import { Kbd } from './Kbd';

/** Shared delay: the first tooltip waits a moment, neighbours then open at once. Mount once around the app. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={500}>{children}</BaseTooltip.Provider>;
}

type TooltipProps = {
  content: ReactNode;
  /** Shortcut in register notation, shown as kbd after the text. */
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** The trigger; it must spread props and forward its ref. */
  children: ReactElement;
  disabled?: boolean;
  defaultOpen?: boolean;
};

/**
 * Ink label with an optional shortcut. Tooltips are visual only (Base UI): the trigger needs its own accessible
 * name, and anything essential must also reach screen readers another way.
 */
export function Tooltip({ content, shortcut, side = 'top', children, disabled, defaultOpen }: TooltipProps) {
  return (
    <BaseTooltip.Root disabled={disabled} defaultOpen={defaultOpen}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={8} className="z-50">
          <BaseTooltip.Popup className="popup-motion flex max-w-72 items-center gap-2 rounded-chip bg-ink px-2 py-1 text-sm font-medium text-paper shadow-elev-2">
            <span className="min-w-0 text-pretty">{content}</span>
            {shortcut && <Kbd keys={shortcut} tone="current" aria-hidden="true" />}
            <BaseTooltip.Arrow className="size-2 rotate-45 bg-ink data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1 data-[side=top]:-bottom-1" />
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
