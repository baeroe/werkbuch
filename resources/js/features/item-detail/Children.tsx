/*
 * The children of an item (spec 4.8): their progress (closed of all, `children_progress`, the bar in the type's tone)
 * and each child in a line with its status, key, title and assignee that opens it. "Kind-Item" opens the create dialog
 * with this item as parent and a type that may have a parent (`useChildType`); without such a type the button says why.
 * Only epics have children (two levels, `domain/hierarchy`): other items have no section. Without children and without
 * the right to create one (a viewer, an archived item or project), the section is left out as well.
 *
 * How many children there are says `children_progress.total` (archived ones included), never the length of the list:
 * the detail embeds at most the first 100 (A449). When there are more, the section reads them from the item list with
 * the item as parent instead (archived ones included, manual order, pages of 100) and offers the next page with
 * "Weitere Kind-Items laden"; until its first page is there, it shows the embedded ones, which are the same.
 */

import { Plus, RotateCw } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useUserMap } from '@/components/fields/itemData';
import { canHaveChildren } from '@/domain/hierarchy';
import { useInfiniteWorkItems } from '@/hooks/workItems';
import { intlLocale, t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { ListedItem, SortSpec, WorkItemDetail } from '@/types';
import { LinkedItem, Section, useChildType } from './shared';

/** The order the detail embeds the children in: manual (`rank`, then the ULID on the server). */
const MANUAL: SortSpec = { field: 'rank', direction: 'asc' };

export function Children({ detail }: { detail: WorkItemDetail }) {
  const { item, children, type } = detail;
  const { reason } = usePermissions();
  const users = useUserMap();
  const childType = useChildType(item.project_id);
  const progress = item.children_progress;
  const total = progress?.total ?? 0;
  // the detail did not embed them all: the list with the item as parent pages through every one
  const paged = total > children.length;
  const pages = useInfiniteWorkItems(
    { parent_id: item.id, include_archived: true, show_sub_items: true, sort: MANUAL, lean: true },
    { enabled: paged && canHaveChildren(type) },
  );
  const list = useRef<HTMLUListElement>(null);
  /** How many children were shown when "Weitere Kind-Items laden" was pressed last; null without such a press. */
  const pressedAt = useRef<number | null>(null);
  const rows: ListedItem[] = paged ? (pages.data?.items ?? children) : children;
  // the first page failed, or a further one: the same button offers it again (and keeps the focus)
  const failed = pages.isError || pages.moreError !== null;
  const offersMore = paged && (pages.data === undefined || pages.hasMore || pages.isError);

  // the button goes with the last page, however long that takes: the focus it had moves on to the first child that
  // came; a focus that went elsewhere meanwhile stays where it is
  useLayoutEffect(() => {
    if (offersMore || pressedAt.current === null) return;
    const shown = pressedAt.current;
    pressedAt.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    list.current?.querySelectorAll<HTMLElement>('a[href]')[shown]?.focus();
  }, [offersMore]);

  const canCreate = item.archived_at === null && reason('item.create', item.project_id) === null;
  if (!canHaveChildren(type) || (total === 0 && !canCreate)) return null;

  const count = (value: number) => new Intl.NumberFormat(intlLocale()).format(value);

  function more() {
    pressedAt.current = rows.length;
    if (pages.isError) void pages.refetch();
    else pages.loadMore();
  }

  return (
    <Section
      title={t('items.detail.children.title')}
      aside={total > 0 ? <span className="tabular-nums">{count(total)}</span> : null}
      actions={
        canCreate && (
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            disabledReason={childType.reason}
            onClick={() => childType.typeId && useUiStore.getState().openCreate({ project_id: item.project_id, parent_id: item.id, type_id: childType.typeId })}
          >
            {t('items.detail.children.add')}
          </Button>
        )
      }
    >
      {total > 0 ? (
        <>
          {progress && <ProgressBar done={progress.done} total={progress.total} label={t('items.detail.children.progress')} tone={type.tone} className="mt-2" />}
          <ul ref={list} className="-mx-2 mt-2 flex flex-col">
            {rows.map((child) => {
              const assignee = child.assignee_id ? users.get(child.assignee_id) : undefined;
              return (
                <li key={child.id}>
                  <LinkedItem item={child} trailing={assignee ? <Avatar user={assignee} size="sm" /> : <UnassignedAvatar />} />
                </li>
              );
            })}
          </ul>
          {paged && (
            <div className={cx('flex flex-wrap items-center gap-2', offersMore && 'mt-2')}>
              {offersMore && (
                <Button variant="ghost" size="sm" icon={failed ? RotateCw : undefined} pending={pages.loadingMore || (pages.data === undefined && !pages.isError)} onClick={more}>
                  {failed ? t('common.retry') : t('items.detail.children.more')}
                </Button>
              )}
              {/* one region for the whole time the list pages: a failure and the count are said, also the last change */}
              <span data-children-status="" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
                {offersMore && failed && <span className="text-danger">{t('items.list.not_loaded')}</span>}
                {offersMore && (
                  <span className="text-muted tabular-nums">{t('items.detail.children.shown', { shown: count(rows.length), total: count(pages.data?.total ?? total) })}</span>
                )}
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="mt-1 text-ui text-pretty text-muted">{t('items.detail.children.empty')}</p>
      )}
    </Section>
  );
}
