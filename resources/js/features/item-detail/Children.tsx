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
import { useRef } from 'react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useUserMap } from '@/components/fields/itemData';
import { canHaveChildren } from '@/domain/hierarchy';
import { useInfiniteWorkItems } from '@/hooks/workItems';
import { focusWhenLost } from '@/lib/focusOrigin';
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
  const canCreate = item.archived_at === null && reason('item.create', item.project_id) === null;
  if (!canHaveChildren(type) || (total === 0 && !canCreate)) return null;

  const rows: ListedItem[] = paged ? (pages.data?.items ?? children) : children;
  const count = (value: number) => new Intl.NumberFormat(intlLocale()).format(value);
  // the first page failed, or a further one: the same button offers it again (and keeps the focus)
  const failed = pages.isError || pages.moreError !== null;
  const offersMore = paged && (pages.data === undefined || pages.hasMore || pages.isError);

  function more() {
    const shown = rows.length;
    if (pages.isError) void pages.refetch();
    else pages.loadMore();
    // the button goes once the last page is there: the focus moves on to the first child that came
    focusWhenLost(() => list.current?.querySelectorAll<HTMLElement>('a[href]')[shown], 2000);
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
          {offersMore && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" icon={failed ? RotateCw : undefined} pending={pages.loadingMore || (pages.data === undefined && !pages.isError)} onClick={more}>
                {failed ? t('common.retry') : t('items.detail.children.more')}
              </Button>
              {failed && <span className="text-sm text-danger">{t('items.list.not_loaded')}</span>}
              <span className="text-sm text-muted tabular-nums" aria-live="polite">
                {t('items.detail.children.shown', { shown: count(rows.length), total: count(pages.data?.total ?? total) })}
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
