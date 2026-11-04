/*
 * What the create dialog holds while it is written, and what happens to it when the dialog closes with content (spec
 * 5.1): closing asks nothing; a toast offers to take it back ("Rückgängig", mod+z too), which opens the dialog with it
 * again. One draft is parked at a time, the newest.
 *
 * Pictures and files in a parked description stay uploaded: they belong to nobody until the item is created (A232), so
 * "Rückgängig" brings them back with the text. A draft whose undo ran out deletes none of them: the hourly job removes
 * uploads nobody owns after 24 hours (A239, ruling T17-I4), as for a comment thrown away.
 *
 * Who is signed in owns the parked draft: when the person changes (`resetForUser` → `drafts.clear()`), it is forgotten
 * with the names the forms saw, and its toast goes.
 */

import { dismissToast, toast } from '@/components/ui/toast';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import { drafts } from '@/lib/drafts';
import { t } from '@/lib/i18n';
import { undoLabel } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import type { Priority, PropertyValue, Project, RichText } from '@/types';

export interface Draft {
  projectId: string;
  typeId: string;
  title: string;
  description: RichText | null;
  /** null: the workflow's start state. */
  stateId: string | null;
  priority: Priority;
  assigneeId: string | null;
  labelIds: string[];
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** The values typed or chosen, by property key; a key that is missing takes the property's default on the server. */
  values: Record<string, PropertyValue>;
}

/** Whether the form holds something typed that closing it would throw away. */
export function hasContent(draft: Draft): boolean {
  return draft.title.trim() !== '' || !isEmptyDoc(draft.description) || Object.keys(draft.values).length > 0;
}

/** The draft of the next item after "Weitere anlegen": project, type, status and the fields stay; title, description and properties start empty. */
export function nextDraft(draft: Draft): Draft {
  return { ...draft, title: '', description: null, values: {} };
}

/** The draft of a dialog that was closed with content, until it is taken back or another one is parked. */
let parked: Draft | null = null;
/** "Rückgängig" was pressed: the next form starts from the parked draft. */
let restoring = false;

/** The toast of the parked draft, which goes with it when the person changes. */
let parkToast: number | null = null;

/** Parks the draft and says so with a toast whose "Rückgängig" (mod+z too) opens the dialog with it again. */
export function park(draft: Draft): void {
  parked = draft;
  restoring = false;
  parkToast = toast({
    title: t('items.create.parked'),
    description: draft.title.trim() || t('items.create.parked_untitled'),
    keep: true,
    action: {
      label: undoLabel(),
      onClick: () => {
        restoring = true;
        useUiStore.getState().openCreate(null);
      },
    },
  });
}

/**
 * The parked draft when its toast reopened the dialog, while some project takes new items. One whose own project went
 * meanwhile comes back all the same: the form moves it to the first project and says so (`items.create.draft_gone`, as
 * when the project goes while the dialog is open, T15-M3), instead of throwing the text away. Only reads: rendering
 * may run twice (StrictMode) or be thrown away; the form that shows it lets go of it with `parkedTaken`.
 */
export function parkedToRestore(projects: readonly Project[]): Draft | null {
  return restoring && projects.length > 0 ? parked : null;
}

/** Names of every project and type a form has seen, so the notice can still name one that left the lists. */
export const seenNames = new Map<string, string>();

/** A form appeared after "Rückgängig": the parked draft is its own now (or its project is gone), nothing is left to restore. */
export function parkedTaken(): void {
  if (!restoring) return;
  parked = null;
  restoring = false;
}

// another person signs in: nobody gets back what the one before wrote, nor learns the names of their projects
drafts.onClear(() => {
  parked = null;
  restoring = false;
  seenNames.clear();
  if (parkToast !== null) dismissToast(parkToast);
  parkToast = null;
});
