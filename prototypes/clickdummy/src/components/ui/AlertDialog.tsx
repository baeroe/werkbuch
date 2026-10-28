import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';
import { DialogFrame } from './Dialog';

type AlertDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  trigger?: ReactElement;
  title: ReactNode;
  /** The consequence in plain words. */
  description: ReactNode;
  /** Names the action, e.g. "Projekt löschen". */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** The confirmed action is running. */
  pending?: boolean;
};

/**
 * Confirmation only for big consequences (delete a project, switch a workflow); everything else gets
 * 5 seconds of undo. The focus starts on "Abbrechen".
 */
export function AlertDialog({ open, onOpenChange, defaultOpen, trigger, title, description, confirmLabel, cancelLabel = 'Abbrechen', onConfirm, pending = false }: AlertDialogProps) {
  return (
    <BaseAlertDialog.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined} defaultOpen={defaultOpen}>
      {trigger && <BaseAlertDialog.Trigger render={trigger} />}
      <DialogFrame
        title={title}
        description={description}
        size="sm"
        closable={false}
        footer={
          <>
            <BaseAlertDialog.Close
              render={
                <Button variant="secondary" disabled={pending}>
                  {cancelLabel}
                </Button>
              }
            />
            <Button variant="danger" pending={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        }
      />
    </BaseAlertDialog.Root>
  );
}
