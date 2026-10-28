import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { cx } from './cx';
import { IconButton } from './IconButton';

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/** Wrap a footer button that cancels: <DialogClose render={<Button variant="ghost">Abbrechen</Button>} /> */
export const DialogClose = BaseDialog.Close;

type FrameProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions at the bottom right; the primary one last. */
  footer?: ReactNode;
  size?: keyof typeof WIDTHS;
  /** Element to focus on open; by default the first field or button. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Close button at the top right (Dialog yes, AlertDialog no: it must be answered). */
  closable?: boolean;
};

/** Mounted inside the open popup: the shortcuts of the page behind it (list, detail) pause meanwhile. */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

/**
 * Portal, scrim and popup on strong tracing paper. Shared by Dialog and AlertDialog: Base UI's alert dialog
 * re-exports these dialog parts.
 */
export function DialogFrame({ title, description, children, footer, size = 'md', initialFocus, closable = true }: FrameProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-160 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain pt-[max(1rem,10vh)] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <BaseDialog.Popup
          initialFocus={initialFocus}
          data-focus-ring="none"
          className={cx('tracing-strong popup-motion relative w-full rounded-card text-ui text-ink outline-none', WIDTHS[size])}
        >
          <PausePageShortcuts />
          <div className={cx('px-5 pt-4', closable && 'pr-14', !children && !footer && 'pb-5')}>
            <BaseDialog.Title className="font-display text-xl font-bold tracking-title text-balance text-ink">{title}</BaseDialog.Title>
            {description && <BaseDialog.Description className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{description}</BaseDialog.Description>}
          </div>
          {children && <div className="px-5 pt-4 pb-5">{children}</div>}
          {footer && <div className={cx('flex flex-wrap items-center justify-end gap-2 px-5 py-3', children ? 'border-t border-edge' : 'pt-4')}>{footer}</div>}
          {/* last in the DOM, so the initial focus lands on the content and not on the close button */}
          {closable && <BaseDialog.Close render={<IconButton icon={X} label="Schließen" tooltip={false} className="absolute top-3 right-3" />} />}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

type DialogProps = Omit<FrameProps, 'closable'> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Element that opens the dialog (rendered as Dialog.Trigger). */
  trigger?: ReactElement;
};

/** Modal dialog above a light scrim; Escape, a click outside and the close button close it. */
export function Dialog({ open, onOpenChange, defaultOpen, trigger, ...frame }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined} defaultOpen={defaultOpen}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <DialogFrame {...frame} />
    </BaseDialog.Root>
  );
}
