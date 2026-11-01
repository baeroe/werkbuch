/*
 * What the create dialog holds while it is written, and what happens to it when the dialog closes with content (spec
 * 5.1): closing asks nothing; a toast offers to take it back ("Rückgängig", mod+z too), which opens the dialog with it
 * again. One draft is parked at a time, the newest.
 */

import { toast } from '@/components/ui/toast';
import { isEmptyDoc } from '@/editor/RichTextEditor';
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

/** Parks the draft and says so with a toast whose "Rückgängig" (mod+z too) opens the dialog with it again. */
export function park(draft: Draft): void {
  parked = draft;
  restoring = false;
  toast({
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
 * The parked draft when its toast reopened the dialog and its project still takes new items. Only reads: rendering may
 * run twice (StrictMode) or be thrown away; the form that shows it lets go of it with `parkedTaken`.
 */
export function parkedToRestore(projects: readonly Project[]): Draft | null {
  const draft = restoring ? parked : null;
  return draft && projects.some((project) => project.id === draft.projectId) ? draft : null;
}

/** A form appeared after "Rückgängig": the parked draft is its own now (or its project is gone), nothing is left to restore. */
export function parkedTaken(): void {
  if (!restoring) return;
  parked = null;
  restoring = false;
}
