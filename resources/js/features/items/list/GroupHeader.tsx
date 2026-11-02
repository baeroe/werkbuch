/*
 * The heading of a group in the list: a button that folds the group away and opens it again (`aria-expanded`), with
 * the group's mark, name and count. The count is the server's (what the group holds, not what is loaded). The button
 * is no tab stop of its own (13c): the list reaches it with the arrow keys (see ListLayout).
 */

import { ChevronDown } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { cx } from '@/components/ui/cx';
import { intlLocale, tn } from '@/lib/i18n';
import type { GroupBy } from '@/types';
import { GroupIcon } from '../display/GroupIcon';
import type { GroupData } from '../layouts';

interface GroupHeaderProps {
  group: GroupData;
  groupBy: GroupBy;
  expanded: boolean;
  onToggle(): void;
  /** The list's tab stop while no item row is there to take it (every group folded or still loading). */
  tabStop: boolean;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}

export function GroupHeader({ group, groupBy, expanded, onToggle, tabStop, onKeyDown }: GroupHeaderProps) {
  return (
    <h2>
      <button
        type="button"
        aria-expanded={expanded}
        tabIndex={tabStop ? 0 : -1}
        data-group-key={group.key}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-ctl px-2 text-left text-ui transition-colors duration-120 hover:bg-hover sm:h-9"
      >
        <ChevronDown className={cx('size-3.5 shrink-0 text-muted transition-transform duration-160', !expanded && '-rotate-90')} aria-hidden="true" />
        <GroupIcon groupBy={groupBy} groupKey={group.key} />
        <span className="min-w-0 truncate font-semibold text-ink">{group.label}</span>
        <span className="shrink-0 text-muted tabular-nums">
          <span aria-hidden="true">{new Intl.NumberFormat(intlLocale()).format(group.count)}</span>
          <span className="sr-only">, {tn('items.group.count', group.count)}</span>
        </span>
      </button>
    </h2>
  );
}
