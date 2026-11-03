/*
 * The create dialog (`c`, spec 5.2): project, type, title, description, the item's fields and the properties of the
 * type (`CreateForm`). Required fields are marked; what the server refuses shows at its field. "Weitere anlegen" keeps
 * the dialog open for the next item (project, type, status and the fields stay; title, description and properties
 * start empty). mod+enter creates, once per press.
 *
 * Contract with `CreateHost` (shell/CreateHost.tsx): `CreateItemDialog({ open, defaults, onOpenChange })`. The host
 * mounts it lazily on the first open and keeps it mounted, so the dialog can animate out and an answer that arrives
 * after closing still lands here; `defaults` are what `openCreate(defaults)` was given (the project, parent and type of
 * "Kind-Item"). `onOpenChange(false)` closes it.
 *
 * When it closes, the focus goes back to what had it when the dialog was asked for (`lib/focusOrigin.ts`): the element
 * before the palette when "Neues Item" came from there, the screen's focus origin or main area when that element went
 * away (a menu entry), never the body.
 *
 * Closing with content asks nothing: the draft is parked with a toast that brings it back (`draft.ts`). A dialog closed
 * while its item is on the way parks nothing once the item is created (its toast says so), and parks the draft when
 * the server refuses it.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import type { CreateWorkItemInput } from '@/api/workItems';
import { useCreateWorkItem } from '@/hooks/workItems';
import { notifyError } from '@/lib/errors';
import { createReturnFocus } from '@/lib/focusOrigin';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { CreateDefaults } from '@/store/ui';
import { useUiStore } from '@/store/ui';
import type { WorkItem } from '@/types';
import { CreateForm } from './CreateForm';
import { hasContent, park, type Draft } from './draft';

export type CreateItemDialogProps = {
  open: boolean;
  defaults: CreateDefaults | null;
  onOpenChange: (open: boolean) => void;
};

export function CreateItemDialog({ open, defaults, onOpenChange }: CreateItemDialogProps) {
  const formId = useId();
  const [another, setAnother] = useState(false);
  // why "Anlegen" cannot send yet: the form is loading, failed, or no project takes new items
  const [unavailable, setUnavailable] = useState<string | null>(null);
  // why the draft cannot go out yet: an upload runs, or pictures of another project are in the description
  const [held, setHeld] = useState<string | null>(null);
  const create = useCreateWorkItem();
  const title = useRef<HTMLInputElement>(null);
  /** What the form holds while it is shown and its item not yet created. */
  const unsaved = useRef<Draft | null>(null);
  /** The call that creates an item, while it runs. */
  const inFlight = useRef<Promise<WorkItem> | null>(null);
  const wasOpen = useRef(open);

  // Closing with typed text parks it. On the close itself, not when the form unmounts: StrictMode unmounts and mounts
  // every new form once more, which would park (and toast) a draft that "Rückgängig" just brought back.
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    const draft = unsaved.current;
    unsaved.current = null;
    if (!draft || !hasContent(draft)) return;
    const call = inFlight.current;
    if (!call) {
      park(draft);
      return;
    }
    // closed while the item is on the way: created, there is nothing to keep; refused, the draft comes back on undo
    void call.then(
      () => {},
      (error: unknown) => {
        park(draft);
        notifyError(t('items.create.failed'), error);
      },
    );
  }, [open]);

  /** Creates the item; its toast comes from here, so it shows also when the dialog was closed meanwhile. */
  function send(input: CreateWorkItemInput): Promise<WorkItem> {
    const call = create.mutateAsync(input);
    inFlight.current = call;
    void call.then(
      (item) => {
        inFlight.current = null;
        useUiStore.getState().flash(item.id);
        toast({
          title: t('items.create.created', { key: item.key }),
          description: item.title,
          tone: 'success',
          action: { label: t('items.create.open'), onClick: () => useUiStore.getState().openPeek(item.id) },
        });
      },
      () => {
        inFlight.current = null;
      },
    );
    return call;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('items.create.title')}
      initialFocus={title}
      // what had the focus when the dialog was asked for (`openCreate`), before the palette when it came from there;
      // taken in the store, not by Base UI in an effect, which is too late when the title takes the focus at once
      finalFocus={createReturnFocus}
      footer={
        <>
          <Switch label={t('items.create.another')} checked={another} onCheckedChange={setAnother} className="mr-auto" />
          <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
          <Button variant="primary" type="submit" form={formId} shortcut={SHORTCUTS['dialog.submit'].keys} pending={create.isPending} disabledReason={unavailable ?? held}>
            {t('items.create.submit')}
          </Button>
        </>
      }
    >
      <CreateForm
        formId={formId}
        defaults={defaults}
        another={another}
        titleRef={title}
        unsaved={unsaved}
        send={send}
        pending={create.isPending}
        onUnavailable={setUnavailable}
        onHold={setHeld}
        onClose={() => onOpenChange(false)}
      />
    </Dialog>
  );
}
