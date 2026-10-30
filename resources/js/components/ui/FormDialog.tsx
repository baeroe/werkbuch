/*
 * The dialog every edit of the settings happens in: title, the form, "Cancel" and the main action.
 * Enter in a text field and ⌘↵ anywhere in the dialog send the form. The button stays available until the request
 * starts and then shows the spinner; a refusal that belongs to a field stands next to it and takes the focus, one that
 * belongs to no field shows as a notice on top, where it cannot be missed. The form body is mounted only while the
 * dialog is open, so every opening starts from a fresh draft.
 */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { t } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog, DialogClose } from './Dialog';

/** Registers ⌘↵ for the dialog's form. Rendered inside the open dialog, so the shortcut lives exactly as long. */
function SubmitShortcut({ formId }: { formId: string }) {
  useShortcut('dialog.submit', () => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit());
  return null;
}

/**
 * When a request ends and the dialog is still open, it was refused: the first field that is marked invalid takes the
 * focus, so the person lands where the fix is (guidelines: "on submit, focus first error").
 */
function FocusFirstInvalid({ formId, pending }: { formId: string; pending: boolean }) {
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending) {
      requestAnimationFrame(() => document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
    wasPending.current = pending;
  }, [formId, pending]);
  return null;
}

type FormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** What the main button does: "Invite", "Save". */
  submitLabel: string;
  onSubmit: () => void;
  /** The call is running: the button shows it and a second send is ignored. */
  pending?: boolean;
  /** A refusal without a field of its own. */
  notice?: ReactNode;
  finalFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function FormDialog({ open, onOpenChange, title, description, size = 'md', submitLabel, onSubmit, pending = false, notice, finalFocus, children }: FormDialogProps) {
  const formId = useId();
  // two sends within one tick (a key pressed twice at once) are one intent; `pending` covers every later one
  const sending = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size={size}
      finalFocus={finalFocus}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
          <Button variant="primary" type="submit" form={formId} pending={pending} shortcut="mod+enter">
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // the dialog is a portal, but React still bubbles its events to the form of the page that opened it
          event.stopPropagation();
          if (pending || sending.current) return;
          sending.current = true;
          setTimeout(() => (sending.current = false), 0);
          onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <SubmitShortcut formId={formId} />
        <FocusFirstInvalid formId={formId} pending={pending} />
        {notice && (
          <Banner tone="danger" role="alert" title={t('ui.form_dialog.error_title')}>
            {notice}
          </Banner>
        )}
        {children}
      </form>
    </Dialog>
  );
}
