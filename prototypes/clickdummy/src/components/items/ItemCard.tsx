/*
 * An item as an index card (DESIGN.md, moodboard board): the tab in the type's tone with icon and key, the title, the
 * blocked hint, labels, the progress of an epic (or any item with children), then priority, due date and assignee.
 * With `showParent` a child item names its epic before the tab, as the path of the item page does („Relaunch Phase 1 ›
 * WEB-42“): muted, and it gives way first. Its full name is in the tooltip and belongs in the card's name (`partOf`);
 * it is no link of its own.
 * The title is a link over the whole card. A board with its own keyboard cursor and drag and drop passes `tabIndex`
 * (and the drag listeners) to the card: then the card is the tab stop, Enter opens it, and the link leaves the tab order.
 */

import { Archive, Ban, ChevronRight } from 'lucide-react';
import type { ComponentProps, KeyboardEvent } from 'react';
import { DayValue, useOverdue } from '@/components/fields/DateField';
import { useToday, useUserMap } from '@/components/fields/itemData';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { IndexCard } from '@/components/ui/IndexCard';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useLabels } from '@/hooks/catalog';
import { useWorkItemMeta } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { ItemRef, WorkItem } from '@/types';
import { BlockedHint } from './BlockedHint';
import { ItemLink, linkFocusRing } from './ItemLink';

type ItemCardProps = Omit<ComponentProps<'article'>, 'children'> & {
  item: WorkItem;
  /** Dense: the title on one line, no labels, the progress as a count. */
  compact?: boolean;
  onOpen: (itemId: string) => void;
  /** Part of the selection: stronger edge, the title under the highlighter. */
  selected?: boolean;
  /** Being dragged (see IndexCard). */
  lifted?: boolean;
  /** Names the epic of a child item before the key (the board, unless its columns are the epics). */
  showParent?: boolean;
};

/** The epic a card names before its key: the parent of a child item, as the item names it; null without one. */
export function cardEpic(item: WorkItem): ItemRef | null {
  const { parent, parent_id } = item;
  return parent && parent.id === parent_id ? parent : null;
}

/** The epic in the words of a card's name: „Teil von WEB-30 Relaunch Phase 1“. */
export const partOf = (epic: ItemRef): string => `Teil von ${epic.key} ${epic.title}`;

export function ItemCard({ item, compact = false, onOpen, selected = false, lifted = false, showParent = false, className, onKeyDown, tabIndex, ...rest }: ItemCardProps) {
  const type = useWorkItemTypes().data?.items.find((entry) => entry.id === item.type_id);
  const labels = useLabels().data?.items;
  const users = useUserMap();
  const meta = useWorkItemMeta().data;
  const { today } = useToday();
  const overdue = useOverdue(item);
  const progress = meta?.progress[item.id];
  const blocked = meta?.blocked.includes(item.id) ?? false;
  const assignee = item.assignee_id ? users.get(item.assignee_id) : undefined;
  const itemLabels = item.label_ids.flatMap((id) => labels?.find((label) => label.id === id) ?? []);
  // the card is the tab stop itself: Enter opens it
  const cardFocus = tabIndex !== undefined;
  const epic = showParent ? cardEpic(item) : null;

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
      tabIndex={tabIndex}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && cardFocus && event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
      className={cx('hover:border-line-strong', compact && 'p-2.5', linkFocusRing, className)}
      {...rest}
    >
      <p className={cx('text-ui font-medium text-ink', compact ? 'truncate' : 'text-pretty', item.archived_at && 'text-muted')}>
        <ItemLink item={item} onOpen={onOpen} tabIndex={cardFocus ? -1 : undefined} className="after:rounded-card">
          <span className="sr-only">
            {item.key}
            {type ? `, ${type.name}` : ''}:{' '}
          </span>
          <span className={cx(selected && 'hl')}>{item.title}</span>
        </ItemLink>
      </p>

      {!compact && blocked && <BlockedHint item={item} variant="card" className="mt-2" />}

      {!compact && itemLabels.length > 0 && (
        <ul aria-label="Labels" className="mt-2 flex flex-wrap gap-1">
          {itemLabels.map((label) => (
            <li key={label.id} className="inline-flex h-5 max-w-full items-center gap-1 rounded-chip border border-line px-1.5 text-sm text-muted">
              <ToneDot tone={label.color} />
              <span className="truncate">{label.name}</span>
            </li>
          ))}
        </ul>
      )}

      {!compact && progress && <ProgressBar done={progress.done} total={progress.total} label="Kind-Items" tone={type?.tone} className="mt-2.5" />}

      <div className={cx('flex items-center gap-2 text-sm text-muted', compact ? 'mt-1.5' : 'mt-2.5')}>
        <PriorityIcon priority={item.priority} />
        {compact && blocked && (
          <span className="inline-flex items-center text-danger">
            <Ban className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Blockiert</span>
          </span>
        )}
        {compact && progress && (
          <span className="tabular-nums">
            <span className="sr-only">Kind-Items fertig: </span>
            {progress.done}/{progress.total}
          </span>
        )}
        {item.due_date && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="sr-only">Fällig am</span>
            <DayValue value={item.due_date} today={today} overdue={overdue} short empty="" />
          </span>
        )}
        {item.archived_at && (
          <span className="inline-flex items-center gap-1">
            <Archive className="size-3.5" aria-hidden="true" />
            Archiviert
          </span>
        )}
        <span className="ml-auto flex">{assignee ? <Avatar user={assignee} size="sm" /> : <UnassignedAvatar />}</span>
      </div>
    </IndexCard>
  );
}
