/*
 * Placeholder until Task 8 replaces this file.
 *
 * Contract with `CreateHost` (src/app/CreateHost.tsx): the named export `CreateItemDialog({ open, defaults,
 * onOpenChange })` is the create dialog (`c`). The host mounts it lazily on the first open and keeps it mounted, so
 * the dialog can animate out; `defaults` are what `openCreate(defaults)` was given, e.g. the project and status of
 * the board column it was opened from. `onOpenChange(false)` closes it.
 */

import { SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import type { CreateDefaults } from '@/store/ui';

export type CreateItemDialogProps = {
  open: boolean;
  defaults: CreateDefaults | null;
  onOpenChange: (open: boolean) => void;
};

export function CreateItemDialog({ open, onOpenChange }: CreateItemDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Neues Item"
      footer={<DialogClose render={<Button variant="secondary">Schließen</Button>} />}
    >
      <EmptyState
        icon={SquarePen}
        title="Kommt in Task 8"
        description="Hier entsteht der Anlegen-Dialog: Projekt, Typ, Titel, Beschreibung, Properties und Vorlage, dazu „Weitere anlegen“ für mehrere Items nacheinander."
      />
    </Dialog>
  );
}
