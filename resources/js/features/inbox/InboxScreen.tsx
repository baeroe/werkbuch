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
 * Keyboard (scope `list`, the catalog's `inbox.*`; the help `?` lists them): j/k and ↓/↑ move the cursor and the
 * focus with it (`useSelection`, without a selection), e marks the notification under the cursor read and u unread
 * again, ⇧E marks everything the filter "Erwähnungen" leaves read (A291) and says how many, # deletes with 5 seconds of
 * undo (⌘Z), Enter and the space bar open its item in the preview (`useUiStore.openPeek`) without leaving the list.
 * With the focus in the preview, e stays the preview's title (`previewKeysAct`). The palette offers the same for the
 * row with the cursor. The list is one stop in the tab order (the cursor's row, else the first); its buttons follow it.
 *
 * Opening reads (spec, changes of 2026-10-29): Enter and a click (the preview), a click with ⌘/Ctrl or ⇧ and a middle
 * click (the item's page in a new tab), the page of what belongs to no item, and the title of a card (the item's page:
 * all of the card's notifications). The cursor stays on the row; in the unread list the row leaves, the cursor and the
 * focus go on to the row that takes its place as after a delete, and the preview stays open.
 * A read mark shows at once, without a toast, and the count follows (`useReadMarks`); a delete hides the row at once
 * and runs when the undo toast ends. When no row is left, the focus goes to "Alle als gelesen markieren".
 *
 * Live: `useLiveSync` (mounted in the shell) loads the inbox again on `notifications.changed`, so a new notification
 * appears and the counters, here and in the sidebar, change.
 */

import { Link, router, usePage } from '@inertiajs/react';
import { Check, CheckCheck, CircleDot, Inbox, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { currentToasts, toast } from '@/components/ui/toast';
import { useSelection } from '@/features/items/selection/useSelection';
import { qk } from '@/hooks/keys';
import { UNREAD_COUNT_ARGS, useDeleteNotification, useNotifications } from '@/hooks/notifications';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useRefetchFailed } from '@/hooks/retry';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useCommand } from '@/lib/commands';
import { intlLocale, t, tn } from '@/lib/i18n';
import { paths, useSearchParam } from '@/lib/links';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { runWithUndo } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useUiStore } from '@/store/ui';
import type { Notification } from '@/types';
import { NotificationCard } from './NotificationCard';
import type { RowActions, RowContext } from './NotificationRow';
import { groupNotifications, type NotificationGroup } from './notifications';
import { useReadMarks } from './useReadMarks';

/** The screen holds the newest fifty; older ones move up as these are done, so the list never gets long (P1). */
export const INBOX_PAGE_SIZE = 50;

type FilterValue = 'unread' | 'mentions';

/** The query of the unread count: the sidebar's badge asks the same, so both always agree. */
/** The query of the count in the head: the badge's (T16-M7). */
const UNREAD = UNREAD_COUNT_ARGS;
/** The query of the unread mentions, for "Alle als gelesen markieren" in the filter "Erwähnungen" (A291). */
const UNREAD_MENTIONS = { unread_only: true, mentions_only: true, per_page: 1 } as const;

/** A popup that gives the focus back when it closes: the palette, the menu of a row. */
const inPopup = (element: Element | null) => Boolean(element?.closest('[role="dialog"], [role="menu"]'));

/**
 * Moves the focus to `target`; from a popup (a command of the palette, an entry of a row's menu) once it has closed.
 * The popup gives the focus back to what had it before, and that is often the row that just left the list: the focus
 * would fall to the page. So it waits until the focus has left the popup (at most 60 frames, the closing animation) and
 * takes it only when it fell to the page; somewhere else (the popup gave it to a row that is still there) it stays.
 */
export function focusLater(target: () => HTMLElement | null | undefined): void {
  if (!inPopup(document.activeElement)) {
    target()?.focus();
    return;
  }
  let frames = 0;
  const step = () => {
    const focus = document.activeElement;
    if (!focus || focus === document.body || !focus.isConnected) target()?.focus();
    else if (inPopup(focus) && frames++ < 60) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const without = (set: ReadonlySet<string>, ids: readonly string[]): Set<string> => new Set([...set].filter((id) => !ids.includes(id)));

/**
 * A hint is not shown twice at once. Toasts take three places at most: a key pressed again and again would fill them
 * with the same text and push out the others.
 */
function hint(title: string, description: string): void {
  if (currentToasts().some((item) => item.title === title)) return;
  toast({ title, description });
}

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

  const listArgs = { per_page: INBOX_PAGE_SIZE, ...(unreadOnly && { unread_only: true }), ...(mentionsOnly && { mentions_only: true }) };
  const list = useNotifications(listArgs);
  const unreadQuery = useNotifications(UNREAD);
  // what "Alle als gelesen markieren" marks: the unread mentions in the filter "Erwähnungen", else everything unread
  const scopeArgs = mentionsOnly ? UNREAD_MENTIONS : UNREAD;
  const scopeQuery = useNotifications(scopeArgs);
  const reads = useReadMarks([qk.notifications.list(listArgs), qk.notifications.list(UNREAD), qk.notifications.list(scopeArgs)]);
  const unreadCount = unreadQuery.data ? reads.unread(unreadQuery.data.total, qk.notifications.list(UNREAD)) : 0;
  const scopeUnread = scopeQuery.data ? reads.unread(scopeQuery.data.total, qk.notifications.list(scopeArgs), mentionsOnly ? (mark) => mark.mention : undefined) : null;
  const deletion = useDeleteNotification();
  // the banner's retry, like an error state's, fetches every failed query again (the sidebar failed as well)
  const refetchFailed = useRefetchFailed();

  const users = useUserMap();
  const projectsQuery = useProjects({ include_archived: true });
  const projects = projectsQuery.data?.items;
  const workflows = useWorkflows().data?.items;
  const properties = useProperties().data?.items;
  const types = useWorkItemTypes().data?.items;
  const timeZone = useOrganization().data.timezone;
  const now = useClock();
  const previewId = useUiStore((state) => state.peekItemId);

  /** The row the cursor is on (the keys act on it): the one that last had the focus. Rows waiting for their delete. */
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const readAllRef = useRef<HTMLButtonElement>(null);

  const stored = useMemo(() => list.data?.items ?? [], [list.data]);
  const storedOf = (id: string) => stored.find((notification) => notification.id === id);
  const visible = useMemo(() => {
    const markedAt = new Date().toISOString();
    return (
      stored
        .filter((notification) => !hidden.has(notification.id))
        .map((notification) => {
          const read = reads.isRead(notification);
          return read === (notification.read_at !== null) ? notification : { ...notification, read_at: read ? markedAt : null };
        })
        // in the unread list a notification that was just read leaves it
        .filter((notification) => !unreadOnly || notification.read_at === null)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reads.isRead` reads `reads.marks`
  }, [stored, hidden, reads.marks, unreadOnly]);
  const groups = useMemo(() => groupNotifications(visible), [visible]);
  const order = useMemo(() => groups.flatMap((group) => group.notifications.map((notification) => notification.id)), [groups]);
  const current = cursorId !== null && order.includes(cursorId) ? cursorId : null;
  // the list is one stop in the tab order: the row under the cursor, else the first
  const tabStop = current ?? order[0] ?? null;
  const cursorNotification = current === null ? undefined : visible.find((notification) => notification.id === current);

  const ctx: RowContext = {
    users,
    propertyLabel: (key) => properties?.find((property) => property.key === key)?.label,
    project: (id) => projects?.find((project) => project.id === id),
    projectsLoading: projectsQuery.isPending,
    stateIcon: (id) => workflows?.flatMap((workflow) => workflow.states).find((state) => state.id === id)?.icon,
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

  /* the cursor */

  function focusRow(id: string) {
    setCursorId(id);
    focusLater(() => links.current.get(id));
  }

  /**
   * The row the cursor takes over when the rows `ids` leave the list: the one that moves up into the place of the first
   * of them. The groups sort again without them (a group whose newest notification goes falls behind), so the row after
   * it in today's order can be far away by then; the row at the same place in the new order is where the eye is.
   */
  function survivorOf(ids: readonly string[]): string | null {
    const places = ids.map((id) => order.indexOf(id)).filter((index) => index >= 0);
    if (places.length === 0) return null;
    const left = groupNotifications(visible.filter((notification) => !ids.includes(notification.id))).flatMap((group) => group.notifications.map((notification) => notification.id));
    return left[Math.min(Math.min(...places), left.length - 1)] ?? null;
  }

  /**
   * The rows `ids` leave the list: the cursor and the focus go on to the row that takes their place (or the one before
   * at the end). When no row is left, a focus inside the list goes to "Alle als gelesen markieren" instead of falling to
   * the page.
   */
  function moveOn(ids: readonly string[]) {
    const next = survivorOf(ids);
    if (next) {
      focusRow(next);
      return;
    }
    setCursorId(null);
    if (listRef.current?.contains(document.activeElement) || inPopup(document.activeElement)) focusLater(() => readAllRef.current);
  }

  /**
   * Whether the focus is in the row of `id` (its link or one of its buttons) or in the open menu of the row: it goes on
   * with the row.
   */
  const focusIn = (id: string) => {
    const row = links.current.get(id)?.closest('li');
    return Boolean(row?.contains(document.activeElement) || row?.querySelector('[data-popup-open]'));
  };

  function noCursor() {
    hint(t('inbox.no_cursor.title'), t('inbox.no_cursor.description'));
  }

  /* actions */

  /** Marks read or unread (the notifications as the screen shows them); in the unread list a row read leaves. */
  function setRead(notifications: readonly Notification[], read: boolean) {
    const changing = notifications.filter((notification) => (notification.read_at === null) === read);
    if (changing.length === 0) return;
    const ids = changing.map((notification) => notification.id);
    if (read && unreadOnly && ids.some((id) => id === current || focusIn(id))) moveOn(ids);
    void reads.setRead(
      ids.flatMap((id) => storedOf(id) ?? []),
      read,
    );
  }

  async function markAll() {
    // only when the count is known to be zero: an unknown count (still loading, or failed) lets the call try
    if (scopeUnread === 0) {
      hint(t('inbox.all_read'), t(mentionsOnly ? 'inbox.read_all.none_mentions' : 'inbox.read_all.none'));
      return;
    }
    const shown = visible.filter((notification) => notification.read_at === null && (!mentionsOnly || notification.event === 'mentioned'));
    const ids = shown.map((notification) => notification.id);
    if (unreadOnly && ids.some((id) => id === current || focusIn(id))) moveOn(ids);
    const updated = await reads.readAll(
      ids.flatMap((id) => storedOf(id) ?? []),
      mentionsOnly ? { mentions_only: true } : {},
    );
    if (updated !== null) toast({ title: tn(mentionsOnly ? 'inbox.read_all.done_mentions' : 'inbox.read_all.done', updated) });
  }

  /** The row goes at once, the call follows when the toast runs out; "Rückgängig" (⌘Z) brings the row back. */
  function remove(id: string) {
    // the focus moves first, so removing the row does not drop it on the page
    if (current === id || focusIn(id)) moveOn([id]);
    setHidden((state) => new Set(state).add(id));
    runWithUndo({
      label: t('inbox.delete.done'),
      failureTitle: t('inbox.delete.failed'),
      undo: () => setHidden((state) => without(state, [id])),
      run: async () => {
        try {
          await deletion.mutateAsync(id);
        } catch (error) {
          setHidden((state) => without(state, [id]));
          throw error;
        }
      },
    });
  }

  /** The key acts on the row under the cursor; without one it says how to get one. */
  function onCursorRow(act: (notification: Notification) => void) {
    if (cursorNotification === undefined) noCursor();
    else act(cursorNotification);
  }

  /** Opening a notification reads it; the cursor stays on its row (in the unread list it goes on with the focus). */
  function readOpened(notification: Notification) {
    if (!(unreadOnly && notification.read_at === null)) setCursorId(notification.id);
    setRead([notification], true);
  }

  function open(notification: Notification, href: string) {
    readOpened(notification);
    // the item opens beside the list; what belongs to no item leads to its page
    if (notification.work_item_id) useUiStore.getState().openPeek(notification.work_item_id);
    else router.visit(href);
  }

  /** Enter and the space bar on the row under the cursor: the same as a click on it, with the focus on its row. */
  function openCursor() {
    const notification = cursorNotification!;
    links.current.get(notification.id)?.focus();
    open(notification, links.current.get(notification.id)?.getAttribute('href') ?? '');
  }

  /** The title of a card opened the item's page: every notification of the card is read. */
  function readItem(group: NotificationGroup, focused: boolean) {
    const unread = group.notifications.filter((notification) => notification.read_at === null);
    // in the unread list the card leaves: a focus on its title goes on as well
    if (unreadOnly && focused) moveOn(unread.map((notification) => notification.id));
    setRead(unread, true);
  }

  const actions: RowActions = {
    open,
    openedElsewhere: readOpened,
    cursor: setCursorId,
    markRead: (notification) => setRead([notification], true),
    markUnread: (notification) => setRead([notification], false),
    remove,
    register: (id, element) => {
      if (element) links.current.set(id, element);
      else links.current.delete(id);
    },
  };

  /* keys and palette */

  useSelection({
    order,
    cursorId,
    onCursor: setCursorId,
    onOpen: openCursor,
    // the space bar shows or hides the preview of the row's item
    onPeek: () => {
      if (cursorNotification?.work_item_id && cursorNotification.work_item_id === previewId) useUiStore.getState().openPeek(null);
      else openCursor();
    },
    focus: (id) => links.current.get(id)?.focus(),
    container: listRef,
  });
  const hasRows = () => order.length > 0;
  useShortcut('inbox.read', () => onCursorRow((notification) => setRead([notification], true)), { when: hasRows });
  useShortcut('inbox.unread', () => onCursorRow((notification) => setRead([notification], false)), { when: hasRows });
  useShortcut('inbox.delete', () => onCursorRow((notification) => remove(notification.id)), { when: hasRows });
  useShortcut('inbox.read_all', () => void markAll());

  const commandGroup = t('shortcuts.group.inbox');
  useCommand({
    id: 'inbox.read',
    label: t('inbox.command.read'),
    group: commandGroup,
    keys: 'e',
    icon: <Check />,
    keywords: ['inbox'],
    run: () => setRead([cursorNotification!], true),
    when: () => cursorNotification?.read_at === null,
  });
  useCommand({
    id: 'inbox.unread',
    label: t('inbox.command.unread'),
    group: commandGroup,
    keys: 'u',
    icon: <CircleDot />,
    keywords: ['inbox'],
    run: () => setRead([cursorNotification!], false),
    when: () => cursorNotification !== undefined && cursorNotification.read_at !== null,
  });
  useCommand({
    id: 'inbox.delete',
    label: t('inbox.command.delete'),
    group: commandGroup,
    keys: '#',
    icon: <Trash2 />,
    keywords: ['inbox'],
    run: () => remove(cursorNotification!.id),
    when: () => cursorNotification !== undefined,
  });
  useCommand({
    id: 'inbox.read_all',
    label: t(mentionsOnly ? 'inbox.command.read_all_mentions' : 'inbox.command.read_all'),
    group: commandGroup,
    keys: 'shift+e',
    icon: <CheckCheck />,
    keywords: ['inbox'],
    run: () => void markAll(),
    when: () => scopeUnread !== 0,
  });

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
        <div ref={listRef} className="flex flex-col">
          {groups.map((group) => (
            <NotificationCard
              key={group.key}
              group={group}
              ctx={ctx}
              types={types}
              current={current}
              tabStop={tabStop}
              previewed={group.itemId !== null && group.itemId === previewId}
              actions={actions}
              onOpenItem={readItem}
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
            ref={readAllRef}
            variant="secondary"
            icon={CheckCheck}
            shortcut="shift+e"
            pending={reads.readingAll}
            disabledReason={scopeUnread === 0 ? t(mentionsOnly ? 'inbox.read_all.none_mentions' : 'inbox.read_all.none') : null}
            onClick={() => void markAll()}
          >
            {t('inbox.read_all.button')}
          </Button>
        </div>
      </div>
      {content}
    </div>
  );
}
