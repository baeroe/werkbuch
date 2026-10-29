/*
 * The title of a card or row as a link that covers it: a plain click (or Enter) opens the item the way the screen wants
 * (`onOpen`: page or preview), a click with a modifier key lets the browser open the page in a new tab. The card or
 * row shows the focus ring of the link (`linkFocusRing`), and its own controls sit above the link (`relative z-10`).
 */

import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { hrefOf } from '@/lib/links';
import type { WorkItem } from '@/types';

/** The focus ring of the link, drawn around the card or row that holds it. */
export const linkFocusRing =
  'has-[[data-item-link]:focus-visible]:outline-2 has-[[data-item-link]:focus-visible]:outline-solid has-[[data-item-link]:focus-visible]:outline-(--focus-ring) has-[[data-item-link]:focus-visible]:[box-shadow:var(--focus-halo)]';

type ItemLinkProps = {
  item: Pick<WorkItem, 'id' | 'key'>;
  onOpen: (itemId: string) => void;
  /** -1 when the card or row is the tab stop itself (a list with its own keyboard cursor). */
  tabIndex?: number;
  /** The rounding of the area it covers, e.g. after:rounded-card. */
  className?: string;
  children: ReactNode;
};

export function ItemLink({ item, onOpen, tabIndex, className, children }: ItemLinkProps) {
  return (
    <a
      href={hrefOf(`/items/${item.key}`)}
      data-item-link=""
      data-focus-ring="none"
      tabIndex={tabIndex}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(item.id);
      }}
      className={cx('text-inherit no-underline outline-none after:absolute after:inset-0', className)}
    >
      {children}
    </a>
  );
}
