/*
 * An item as an index card (DESIGN.md, moodboard board), ported from the clickdummy: the tab in the type's tone with
 * icon and key, the title, the blocked hint, labels, the progress of an epic (or any item with children), then
 * priority, due date and assignee. Which of labels, priority, due date and assignee it shows follows the display fields
 * (`fields`, all four without them). None of it is a tab stop.
 *
 * With `showParent` a child item names its epic before the tab, as the path of the item page does („Relaunch Phase 1 ›
 * WEB-42“): muted, and it gives way first. Its key and title are in the tooltip, and the card says „Teil von …“ in its
 * own name (13c), so the caller adds nothing; what else the name says comes as `nameParts`. It is no link of its own. The row of the tab is part of the card: a
 * click there opens it, as one on the title does.
 *
 * The title is a link over the whole card; a plain click on it opens the preview (`onPeek`), without it the page. A
 * board with its own keyboard cursor passes `cursor` (true for its tab stop, false for the other cards): then the card
 * is the element of the cursor (`data-nav-target`), Enter opens the page (`onOpen`), and the link leaves the tab order.
 */

import { Archive, Ban, ChevronRight } from 'lucide-react';
import type { ComponentProps, KeyboardEvent, MouseEvent } from 'react';
import { DayValue, useOverdue } from '@/components/fields/DateField';
import { useToday, useUserMap } from '@/components/fields/itemData';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { IndexCard } from '@/components/ui/IndexCard';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useLabels } from '@/hooks/catalog';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import type { ItemRef, ListedItem } from '@/types';
import { BlockedHint } from './BlockedHint';
import { isPlainClick, ItemLink, linkFocusRing } from './ItemLink';
import { listItemName } from './names';

/** The fields of the display a card shows when it is given none. */
const CARD_FIELDS = ['labels', 'priority', 'due_date', 'assignee'];

type ItemCardProps = Omit<ComponentProps<'article'>, 'children' | 'aria-label'> & {
  item: ListedItem;
  /** The display fields (`Display.fields`): labels, priority, due_date and assignee show when they are among them. */
  fields?: readonly string[];
  /** Dense: the title on one line, no labels, the progress as a count (the timeline). */
  compact?: boolean;
  /** Enter on the card of a board with a cursor: the item's page. */
  onOpen: (itemId: string) => void;
  /** A plain click on the title or the tab: the preview. Without it the title leads to the page. */
  onPeek?: (itemId: string) => void;
  /** Part of the selection: stronger edge, the title under the highlighter. */
  selected?: boolean;
  /** Being dragged (see IndexCard). */
  lifted?: boolean;
  /** Names the epic of a child item before the key (the board, unless its columns are the epics). */
  showParent?: boolean;
  /** The card belongs to a board with a keyboard cursor: true for its tab stop, false for the other cards. */
  cursor?: boolean;
  /** More parts of the card's name after its key and title (the timeline: „ohne Datum“, the progress). */
  nameParts?: readonly string[];
};

/** The epic a card names before its key: the parent of a child item, as the item names it; null without one. */
export function cardEpic(item: Pick<ListedItem, 'parent' | 'parent_id'>): ItemRef | null {
  const { parent, parent_id } = item;
  return parent && parent.id === parent_id ? parent : null;
}

export function ItemCard({
  item,
  fields = CARD_FIELDS,
  compact = false,
  onOpen,
  onPeek,
  selected = false,
  lifted = false,
  showParent = false,
  cursor,
  nameParts = [],
  className,
  onClick,
  onKeyDown,
  ...rest
}: ItemCardProps) {
  const type = useWorkItemTypes().data?.items.find((entry) => entry.id === item.type_id);
  const labels = useLabels().data?.items;
  const users = useUserMap();
  const { today } = useToday();
  const overdue = useOverdue(item);
  const progress = item.children_progress;
  const blocked = item.blocked;
  const assignee = item.assignee_id ? users.get(item.assignee_id) : undefined;
  const itemLabels = fields.includes('labels') ? item.label_ids.flatMap((id) => labels?.find((label) => label.id === id) ?? []) : [];
  const navTarget = cursor !== undefined;
  const epic = showParent ? cardEpic(item) : null;
  const name = listItemName(item, selected, ...(epic ? [t('items.card.part_of', { key: epic.key, title: epic.title })] : []), ...nameParts);

  return (
    <IndexCard
      tone={type?.tone ?? 'slate'}
      icon={type?.icon ?? 'square-check'}
      tabLabel={item.key}
      tabPrefix={
        epic && (
          <span data-parent-crumb="" aria-hidden="true" title={`${epic.key} ${epic.title}`} className="flex min-w-0 items-center gap-0.5 pr-1 text-sm text-muted">
            <span className="min-w-0 truncate">{epic.title}</span>
            <ChevronRight className="size-3.5 shrink-0" />
          </span>
        )
      }
      selected={selected}
      lifted={lifted}
      aria-label={name}
      {...(navTarget && { 'data-nav-target': '', tabIndex: cursor ? 0 : -1 })}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(event);
        // Enter on the card opens the page; a click on the title opens the preview
        if (!event.defaultPrevented && navTarget && event.key === 'Enter' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
      onClick={(event: MouseEvent<HTMLElement>) => {
        onClick?.(event);
        // the tab and the epic before it lie above the card, outside the title's link: a plain click there opens the
        // card all the same (modifier clicks belong to the link)
        if (event.defaultPrevented || !isPlainClick(event)) return;
        if (event.target instanceof Element && event.target.closest('[data-tab-row]')) (onPeek ?? onOpen)(item.id);
      }}
      className={cx('hover:border-line-strong [&>[data-tab-row]]:cursor-pointer', compact && 'p-2.5', linkFocusRing, className)}
      {...rest}
    >
      <p className={cx('text-ui font-medium text-ink', compact ? 'truncate' : 'text-pretty', item.archived_at && 'text-muted')}>
        <ItemLink item={item} onOpen={onPeek} tabIndex={navTarget ? -1 : undefined} className="after:rounded-card">
          <span className="sr-only">
            {item.key}
            {type ? `, ${type.name}` : ''}:{' '}
          </span>
          <span className={cx(selected && 'hl')}>{item.title}</span>
        </ItemLink>
      </p>

      {!compact && blocked && <BlockedHint item={item} variant="card" className="mt-2" />}

      {!compact && itemLabels.length > 0 && (
        <ul aria-label={t('items.fields.labels.label')} className="mt-2 flex flex-wrap gap-1">
          {itemLabels.map((label) => (
            <li key={label.id} className="inline-flex h-5 max-w-full items-center gap-1 rounded-chip border border-line px-1.5 text-sm text-muted">
              <ToneDot tone={label.color} />
              <span className="truncate">{label.name}</span>
            </li>
          ))}
        </ul>
      )}

      {!compact && progress && <ProgressBar done={progress.done} total={progress.total} label={t('items.card.children')} tone={type?.tone} className="mt-2.5" />}

      <div className={cx('flex items-center gap-2 text-sm text-muted', compact ? 'mt-1.5' : 'mt-2.5')}>
        {fields.includes('priority') && <PriorityIcon priority={item.priority} />}
        {compact && blocked && (
          <span className="inline-flex items-center text-danger">
            <Ban className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t('items.blocked.label')}</span>
          </span>
        )}
        {compact && progress && (
          <span className="tabular-nums">
            <span className="sr-only">{t('items.row.children_done')} </span>
            {progress.done}/{progress.total}
          </span>
        )}
        {fields.includes('due_date') && item.due_date && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="sr-only">{t('items.card.due')}</span>
            <DayValue value={item.due_date} today={today} overdue={overdue} short empty="" />
          </span>
        )}
        {item.archived_at && (
          <span className="inline-flex items-center gap-1">
            <Archive className="size-3.5" aria-hidden="true" />
            {t('items.row.archived')}
          </span>
        )}
        {fields.includes('assignee') && <span className="ml-auto flex">{assignee ? <Avatar user={assignee} size="sm" /> : <UnassignedAvatar />}</span>}
      </div>
    </IndexCard>
  );
}
