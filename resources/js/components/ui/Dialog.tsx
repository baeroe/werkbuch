import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { t } from '@/lib/i18n';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { Button } from './Button';
import { cx } from './cx';
import { IconButton } from './IconButton';

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/** Wrap a footer button that cancels: <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} /> */
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
  /** Element to focus on close; by default the one that had the focus before (gone after a closing menu). */
  finalFocus?: RefObject<HTMLElement | null>;
  /** Close button at the top right (Dialog yes, AlertDialog no: it must be answered). */
  closable?: boolean;
  /** Rendered inside the popup after everything else, e.g. a question that belongs to this dialog. */
  nested?: ReactNode;
  /** A dialog over a dialog: its scrim covers the one below too (Base UI leaves it out for nested dialogs). */
  stacked?: boolean;
};

/**
 * Mounted inside the open popup: meanwhile only `dialog` shortcuts and the global mod+k, escape and mod+enter run; the
 * shortcuts of the page behind it pause.
 */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

/**
 * Portal, scrim and popup on strong tracing paper. Shared by Dialog and AlertDialog: Base UI's alert dialog
 * re-exports these dialog parts.
 */
export function DialogFrame({ title, description, children, footer, size = 'md', initialFocus, finalFocus, closable = true, nested, stacked = false }: FrameProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        forceRender={stacked}
        className="fixed inset-0 z-50 bg-scrim transition-opacity duration-160 data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain pt-[max(1rem,10vh)] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <BaseDialog.Popup
          initialFocus={initialFocus}
          finalFocus={finalFocus}
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
          {closable && <BaseDialog.Close render={<IconButton icon={X} label={t('common.close')} tooltip={false} className="absolute top-3 right-3" />} />}
          {nested}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

/** The question before a dialog with something shown once closes by Escape. */
export interface ConfirmClose {
  /** e.g. "Close without a copy?" */
  title: string;
  /** What is lost: that it cannot be shown again. */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

type DialogProps = Omit<FrameProps, 'closable' | 'nested'> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** After the closing (or opening) animation, e.g. to let go of what the dialog showed. */
  onOpenChangeComplete?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Element that opens the dialog (rendered as Dialog.Trigger). */
  trigger?: ReactElement;
  /**
   * For what is shown only once (a new token, a webhook secret, spec 4.2): a click outside does not close the dialog,
   * and Escape asks this question first. Its own buttons (and the close button) close it as always.
   */
  confirmClose?: ConfirmClose;
};

/**
 * Modal dialog above a light scrim; Escape, a click outside and the close button close it. With `confirmClose` only a
 * button of its own does, or Escape once the person has said yes.
 */
export function Dialog({ open, onOpenChange, onOpenChangeComplete, defaultOpen, trigger, confirmClose, ...frame }: DialogProps) {
  const [asking, setAsking] = useState(false);
  const actions = useRef<BaseDialog.Root.Actions>(null);
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      actionsRef={actions}
      disablePointerDismissal={confirmClose !== undefined}
      onOpenChange={(next, details) => {
        if (!next && confirmClose && details.reason === 'escape-key') {
          // the dialog stays; the question decides
          details.cancel();
          setAsking(true);
          return;
        }
        onOpenChange?.(next);
      }}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <DialogFrame
        {...frame}
        nested={
          confirmClose && (
            <BaseAlertDialog.Root open={asking} onOpenChange={setAsking}>
              <DialogFrame
                title={confirmClose.title}
                description={confirmClose.description}
                size="sm"
                closable={false}
                stacked
                footer={
                  <>
                    <BaseAlertDialog.Close render={<Button variant="secondary">{confirmClose.cancelLabel ?? t('common.back')}</Button>} />
                    <Button
                      variant="danger"
                      onClick={() => {
                        setAsking(false);
                        actions.current?.close();
                      }}
                    >
                      {confirmClose.confirmLabel ?? t('common.close')}
                    </Button>
                  </>
                }
              />
            </BaseAlertDialog.Root>
          )
        }
      />
    </BaseDialog.Root>
  );
}
