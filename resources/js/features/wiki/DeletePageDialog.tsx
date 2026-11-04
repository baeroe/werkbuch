/*
 * The question before a page is deleted (spec 4.15 "mit Bestätigung", 5.1; ported from the clickdummy's WikiScreen):
 * it is asked on every way to delete. It names what goes along: the subpages, at most five by their titles
 * (`Intl.ListFormat`), and how many more; and that the delete can be taken back for five seconds. The button says how
 * many pages go: "Seite löschen", or ":count Seiten löschen".
 */

import type { RefObject } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { intlLocale, t } from '@/lib/i18n';
import type { PageNode } from '@/types';
import { subpages } from './format';
import { flattenPages } from './tree';

/** How many subpages the question names by their titles. */
const NAMED = 5;

export interface DeletePageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page to delete; it stays set while the dialog closes. */
  page: PageNode | null;
  onConfirm: () => void;
  /** Where the focus goes when the question closes. */
  finalFocus?: RefObject<HTMLElement | null>;
}

const quoted = (title: string) => t('wiki.delete.quoted', { title });

/** What goes along with a page, in words, and how long it can be taken back. */
function consequence(page: PageNode): string {
  const below = flattenPages(page.children).map((row) => quoted(row.node.title));
  const later = t('wiki.delete.later');
  if (below.length === 0) return later;
  if (below.length === 1) return `${t('wiki.delete.below_one', { title: below[0] })} ${later}`;
  const list = new Intl.ListFormat(intlLocale(), { type: 'conjunction' });
  const names = below.length > NAMED ? t('wiki.delete.more', { names: below.slice(0, NAMED).join(', '), count: below.length - NAMED }) : list.format(below);
  return `${t('wiki.delete.below', { subpages: subpages(below.length), names })} ${later}`;
}

/** The page and every page below it. */
export const pageCount = (page: PageNode): number => flattenPages([page]).length;

export function DeletePageDialog({ open, onOpenChange, page, onConfirm, finalFocus }: DeletePageDialogProps) {
  const count = page ? pageCount(page) : 0;
  return (
    <AlertDialog
      open={open && page !== null}
      onOpenChange={onOpenChange}
      title={page ? (count > 1 ? t('wiki.delete.title_with', { title: page.title, subpages: subpages(count - 1) }) : t('wiki.delete.title', { title: page.title })) : ''}
      description={page ? consequence(page) : ''}
      confirmLabel={count > 1 ? t('wiki.delete.confirm_many', { count }) : t('wiki.delete.confirm')}
      onConfirm={onConfirm}
      finalFocus={finalFocus}
    />
  );
}
