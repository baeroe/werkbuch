/*
 * The inbox (spec 4.14, 5.2), ported from the clickdummy's InboxScreen: the notifications of the signed-in person,
 * grouped by item. Every item is an index card with its tab; the notifications stand in it, newest first. Unread ones
 * have the ink-blue dot. The filters "Ungelesen" and "Erwähnungen" live in the address (`?unread=1&mentions=1`), so a
 * link keeps them; changing them replaces the address without a visit (the server renders the same page).
 *
 * The screen holds the newest fifty (P1); older ones move up as these are done, and a line says how many there are.
 * The head counts the unread ones with the query of the sidebar's badge (both always agree) and announces the count
 * politely, so a live notification is heard. "Alle als gelesen markieren" marks what the filter "Erwähnungen" shows,
 * or everything (A291).
 *
 * States: a skeleton in the shape of the cards while the first answer is on its way; an empty inbox per filter with the
 * next step; an error with "Erneut versuchen" only without a list (a reload that fails keeps the list under a banner).
 *
 * Opening: a plain click on a row (or Enter on it) opens the item in the preview (`useUiStore.openPeek`) beside the
 * list; what belongs to no item leads to its page. The cursor is the row that last had the focus; the list is one stop
 * in the tab order (the cursor's row, else the first). The keys, reading on open and deleting come with task 17.
 *
 * Live: `useLiveSync` (mounted in the shell) loads the inbox again on `notifications.changed`, so a new notification
 * appears and the counters, here and in the sidebar, change.
 */

import { Link, router, usePage } from '@inertiajs/react';
import { CheckCheck, Inbox, SlidersHorizontal } from 'lucide-react';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useMarkAllRead, useNotifications } from '@/hooks/notifications';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useRefetchFailed } from '@/hooks/retry';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { intlLocale, t, tn } from '@/lib/i18n';
import { paths, useSearchParam } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useUiStore } from '@/store/ui';
import type { Notification } from '@/types';
import { NotificationCard } from './NotificationCard';
import type { RowContext } from './NotificationRow';
import { groupNotifications } from './notifications';

/** The screen holds the newest fifty; older ones move up as these are done, so the list never gets long (P1). */
export const INBOX_PAGE_SIZE = 50;

type FilterValue = 'unread' | 'mentions';

/** The relative times ("vor 20 Min.") stay right while the screen is open: it draws again every minute. */
function useClock(): Date {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return new Date();
}

/** Two switches that may both be on: only unread, only mentions, or unread mentions. */
function FilterToggles({ value, onChange }: { value: FilterValue[]; onChange: (next: FilterValue[]) => void }) {
  const toggle = cx(
    'inline-flex h-11 cursor-pointer items-center rounded-chip px-2.5 text-ui font-medium text-muted transition-colors duration-120 hover:text-ink md:h-8',
    'data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-elev-1',
  );
  return (
    <ToggleGroup
      multiple
      aria-label={t('inbox.filter.label')}
      value={value}
      onValueChange={(next) => onChange(next as FilterValue[])}
      className="inline-flex max-w-full flex-wrap rounded-ctl border border-line bg-sunken p-1"
    >
      <Toggle value="unread" className={toggle}>
        {t('inbox.filter.unread')}
      </Toggle>
      <Toggle value="mentions" className={toggle}>
        {t('inbox.filter.mentions')}
      </Toggle>
    </ToggleGroup>
  );
}

/** The shape of the list while it loads: three cards with their tab, a title and a few rows. */
function InboxSkeleton() {
  return (
    <SkeletonGroup label={t('inbox.loading')} className="flex flex-col">
      {[3, 2, 1].map((rows, index) => (
        <div key={index} className="relative mt-5 rounded-card border border-line bg-surface p-3 shadow-elev-1">
          <span className="absolute bottom-full left-3">
            <Skeleton className="h-5 w-20 rounded-b-none" />
          </span>
          <Skeleton className="h-4 w-2/3" />
          <div className="mt-3 flex flex-col gap-3">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex items-start gap-2.5 px-2">
                <Skeleton className="mt-3 size-2 rounded-full" />
                <Skeleton className="size-7 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function InboxScreen() {
  useDocumentTitle(t('inbox.title'));
  const { url } = usePage();
  const unreadOnly = useSearchParam('unread') === '1';
  const mentionsOnly = useSearchParam('mentions') === '1';

  const list = useNotifications({ per_page: INBOX_PAGE_SIZE, ...(unreadOnly && { unread_only: true }), ...(mentionsOnly && { mentions_only: true }) });
  // the same query as the sidebar's badge, so both always agree
  const unreadQuery = useNotifications({ unread_only: true, per_page: 1 });
  const unreadCount = unreadQuery.data?.total ?? 0;
  const markAll = useMarkAllRead();
  // the banner's retry, like an error state's, fetches every failed query again (the sidebar failed as well)
  const refetchFailed = useRefetchFailed();

  const users = useUserMap();
  const projects = useProjects({ include_archived: true }).data?.items;
  const properties = useProperties().data?.items;
  const types = useWorkItemTypes().data?.items;
  const timeZone = useOrganization().data.timezone;
  const now = useClock();
  const previewId = useUiStore((state) => state.peekItemId);

  /** The row the cursor is on: the one that last had the focus. */
  const [cursorId, setCursorId] = useState<string | null>(null);

  const groups = useMemo(() => groupNotifications(list.data?.items ?? []), [list.data]);
  const order = groups.flatMap((group) => group.notifications.map((notification) => notification.id));
  const current = cursorId !== null && order.includes(cursorId) ? cursorId : null;
  // the list is one stop in the tab order: the row under the cursor, else the first
  const tabStop = current ?? order[0] ?? null;

  const ctx: RowContext = {
    users,
    propertyLabel: (key) => properties?.find((property) => property.key === key)?.label,
    project: (id) => projects?.find((project) => project.id === id),
    now,
    timeZone,
  };

  function setFilter(next: FilterValue[]) {
    const address = new URL(url, window.location.origin);
    for (const name of ['unread', 'mentions'] as const) {
      if (next.includes(name)) address.searchParams.set(name, '1');
      else address.searchParams.delete(name);
    }
    setCursorId(null);
    router.replace({ url: `${address.pathname}${address.search}`, preserveState: true, preserveScroll: true });
  }

  function open(notification: Notification, href: string) {
    setCursorId(notification.id);
    // the item opens beside the list; what belongs to no item leads to its page
    if (notification.work_item_id) useUiStore.getState().openPeek(notification.work_item_id);
    else router.visit(href);
  }

  async function markAllRead() {
    try {
      await markAll.mutateAsync(mentionsOnly ? { mentions_only: true } : {});
    } catch (error) {
      notifyError(t('inbox.read_all.failed'), error, () => void markAllRead());
    }
  }

  const count = new Intl.NumberFormat(intlLocale());
  let content;
  if (list.isPending) {
    content = <InboxSkeleton />;
  } else if (list.isError && !list.data) {
    content = (
      <ErrorState
        className="mt-5"
        title={t('inbox.load_failed')}
        description={list.error instanceof ApiError ? list.error.message : t('errors.no_answer')}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  } else if (groups.length === 0) {
    const reset = (
      <Button variant="secondary" onClick={() => setFilter([])}>
        {t(unreadOnly && !mentionsOnly ? 'inbox.empty.show_all' : 'inbox.empty.reset')}
      </Button>
    );
    if (!unreadOnly && !mentionsOnly) {
      content = (
        <EmptyState
          className="mt-5"
          icon={Inbox}
          badge={CheckCheck}
          title={t('inbox.empty.all.title')}
          description={t('inbox.empty.all.description')}
          actions={
            <>
              <Link href={paths.me('notifications')} className={buttonClass({ variant: 'secondary' })}>
                <SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />
                {t('inbox.empty.settings')}
              </Link>
              <Link href={paths.myItems()} className={buttonClass({ variant: 'ghost' }, 'text-accent-text!')}>
                {t('inbox.empty.my_items')}
              </Link>
            </>
          }
        />
      );
    } else if (!mentionsOnly) {
      content = (
        <EmptyState className="mt-5" icon={Inbox} badge={CheckCheck} title={t('inbox.empty.unread.title')} description={t('inbox.empty.unread.description')} actions={reset} />
      );
    } else {
      content = (
        <EmptyState
          className="mt-5"
          icon={Inbox}
          title={t(unreadOnly ? 'inbox.empty.unread_mentions.title' : 'inbox.empty.mentions.title')}
          description={t('inbox.empty.mentions.description')}
          actions={reset}
        />
      );
    }
  } else {
    content = (
      <>
        {list.isError && (
          <Banner
            tone="danger"
            role="alert"
            className="mt-5"
            title={t('inbox.stale.title')}
            action={
              <Button
                variant="secondary"
                size="sm"
                pending={list.isFetching}
                onClick={() => {
                  void list.refetch();
                  refetchFailed();
                }}
              >
                {t('common.retry')}
              </Button>
            }
          >
            {t('inbox.stale.description')}
          </Banner>
        )}
        <div className="flex flex-col">
          {groups.map((group) => (
            <NotificationCard
              key={group.key}
              group={group}
              ctx={ctx}
              types={types}
              current={current}
              tabStop={tabStop}
              previewed={group.itemId !== null && group.itemId === previewId}
              onOpen={open}
              onCursor={setCursorId}
            />
          ))}
        </div>
        {list.data && list.data.total > list.data.items.length && (
          <p className="mt-5 max-w-[65ch] text-sm text-pretty text-muted">{t('inbox.newest', { shown: count.format(list.data.items.length), total: count.format(list.data.total) })}</p>
        )}
      </>
    );
  }

  const filterValue: FilterValue[] = [...(unreadOnly ? (['unread'] as const) : []), ...(mentionsOnly ? (['mentions'] as const) : [])];

  return (
    // beside the open preview the list gives up the room the panel takes
    <div className={cx('max-w-3xl', previewId !== null && 'md:mr-[calc(var(--panel-w)+0.5rem)]')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-h-8 min-w-0 items-baseline gap-3">
          <h1 className="font-display text-lg font-bold tracking-title text-ink">{t('inbox.title')}</h1>
          {/* announced politely, so a live notification is heard */}
          <p role="status" className="text-ui text-muted tabular-nums">
            {unreadQuery.data ? (unreadCount > 0 ? tn('inbox.unread_count', unreadCount) : t('inbox.all_read')) : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterToggles value={filterValue} onChange={setFilter} />
          <Button
            variant="secondary"
            icon={CheckCheck}
            pending={markAll.isPending}
            disabledReason={unreadQuery.data && unreadCount === 0 ? t('inbox.read_all.none') : null}
            onClick={() => void markAllRead()}
          >
            {t('inbox.read_all.button')}
          </Button>
        </div>
      </div>
      {content}
    </div>
  );
}
