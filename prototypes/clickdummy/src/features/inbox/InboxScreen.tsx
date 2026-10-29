/*
 * The inbox (spec 4.14, 5.2): the notifications of the signed-in person, grouped by item. Every item is an index card
 * with its tab; the notifications stand in it, newest first. Unread ones have the ink-blue dot. The filters
 * "Ungelesen" and "Erwähnungen" live in the URL (`?unread=1&mentions=1`), so a link keeps them.
 *
 * Keyboard (scope list; the help `?` lists them): j and k move the cursor and the focus with it, e marks the
 * notification under the cursor read, shift+e all of them, # deletes with 5 seconds of undo, Enter opens its item in
 * the preview. The preview is `useUiStore.openPeek`; opening it neither navigates nor marks anything read.
 * A notification marked read shows as read at once, without a toast (and is unread again, with a toast, if the server
 * refuses); a delete hides the row at once and runs when the undo toast ends.
 *
 * Live: `useLiveSync` (mounted in the shell) loads the list again on a live event, so a new notification appears and the
 * counters, here and in the sidebar, change. The profile menu's "Live-Ereignis simulieren" shows it.
 */

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Building2, CheckCheck, Inbox, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IndexCard } from '@/components/ui/IndexCard';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { currentToasts, toast } from '@/components/ui/toast';
import { useDeleteNotification, useMarkAllRead, useMarkRead, useNotifications } from '@/hooks/notifications';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useWorkItem } from '@/hooks/workItems';
import { now } from '@/lib/clock';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { runWithUndo } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useUiStore } from '@/store/ui';
import type { Notification } from '@/types';
import { groupNotifications, type NotificationGroup } from './notifications';
import { NotificationRow } from './NotificationRow';

const SHORTCUT_GROUP = 'Inbox';
/** The screen holds the newest fifty; older ones move up as these are done, so the list never gets long. */
const PAGE_SIZE = 50;
const count = new Intl.NumberFormat('de-DE');

/** The relative times ("vor 20 Min.") stay right while the screen is open: it draws again every minute. */
function useClock(): Date {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return now();
}

const without = (set: ReadonlySet<string>, ids: string[]): Set<string> => new Set([...set].filter((id) => !ids.includes(id)));

/**
 * A hint is not shown twice at once. Toasts take three places at most: a key pressed again and again would fill them
 * with the same text and push out the others, or, behind three undo toasts, queue copies that show long after.
 */
function hint(title: string, description: string): void {
  if (currentToasts().some((item) => item.title === title)) return;
  toast({ title, description });
}

/* --------------------------------------------------------------------- the pieces */

type FilterValue = 'unread' | 'mentions';

/** Two switches that may both be on: only unread, only mentions, or unread mentions. */
function FilterToggles({ value, onChange }: { value: FilterValue[]; onChange: (next: FilterValue[]) => void }) {
  const toggle = cx(
    'inline-flex h-11 cursor-pointer items-center rounded-chip px-2.5 text-ui font-medium text-muted transition-colors duration-120 hover:text-ink md:h-8',
    'data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-elev-1',
  );
  return (
    <ToggleGroup
      multiple
      aria-label="Filter"
      value={value}
      onValueChange={(next) => onChange(next as FilterValue[])}
      className="inline-flex max-w-full flex-wrap rounded-ctl border border-line bg-sunken p-1"
    >
      <Toggle value="unread" className={toggle}>
        Ungelesen
      </Toggle>
      <Toggle value="mentions" className={toggle}>
        Erwähnungen
      </Toggle>
    </ToggleGroup>
  );
}

/** The shape of the list while it loads: three cards with their tab, a title and a few rows. */
function InboxSkeleton() {
  return (
    <SkeletonGroup label="Inbox wird geladen …" className="flex flex-col">
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

type GroupCardProps = {
  group: NotificationGroup;
  current: string | null;
  tabStop: string | null;
  previewed: boolean;
  flashing: boolean;
  now: Date;
  timeZone: string;
  onOpen: (notification: Notification, href: string) => void;
  onCursor: (notificationId: string) => void;
  onMarkRead: (notificationId: string) => void;
  onDelete: (notificationId: string) => void;
  registerLink: (notificationId: string, element: HTMLAnchorElement | null) => void;
};

/** The notifications of one item on its index card; what belongs to no item stands on a plain card of its project. */
function GroupCard({ group, current, tabStop, previewed, flashing, now: at, timeZone, onOpen, onCursor, onMarkRead, onDelete, registerLink }: GroupCardProps) {
  const headingId = useId();
  const detail = useWorkItem(group.itemId);
  const projects = useProjects({ include_archived: true });
  const item = detail.data?.item;
  // null: the item is gone or the person no longer sees it; undefined: it is still loading
  const known = group.itemId === null ? undefined : detail.isError ? null : item;

  const rows = (
    <ul className="-mx-2 mt-1.5 flex flex-col">
      {group.notifications.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          item={known}
          current={current === notification.id}
          tabStop={tabStop === notification.id}
          flashing={flashing && notification.id === group.notifications[0].id}
          now={at}
          timeZone={timeZone}
          onOpen={onOpen}
          onCursor={onCursor}
          onMarkRead={onMarkRead}
          onDelete={onDelete}
          linkRef={(element) => registerLink(notification.id, element)}
        />
      ))}
    </ul>
  );

  if (group.itemId !== null) {
    const type = detail.data?.type;
    return (
      <IndexCard tone={type?.tone ?? 'slate'} icon={type?.icon ?? 'square-check'} tabLabel={item?.key ?? '…'} selected={previewed} aria-labelledby={headingId}>
        <h2 id={headingId} className="text-ui font-medium text-pretty break-words text-ink">
          {item ? (
            // the padding makes the target taller without moving anything: 24 px on desktop, 44 px on a phone
            <Link to={`/items/${item.key}`} className="rounded-chip py-3.5 text-inherit no-underline hover:underline md:py-1">
              <span className="sr-only">{item.key}:</span> {item.title}
            </Link>
          ) : known === null ? (
            <span className="text-muted">Dieses Item gibt es nicht mehr, oder du siehst es nicht mehr.</span>
          ) : (
            <Skeleton className="my-0.5 h-4 w-2/3" />
          )}
        </h2>
        {rows}
      </IndexCard>
    );
  }

  const project = projects.data?.items.find((entry) => entry.id === group.projectId);
  return (
    <section aria-labelledby={headingId} className="relative mt-5 rounded-card border border-line bg-surface p-3 shadow-elev-1">
      <h2 id={headingId} className="flex items-center gap-2 text-ui font-medium text-ink">
        {project ? (
          <>
            <ProjectBadge project={project} />
            <span className="min-w-0 truncate">{project.name}</span>
          </>
        ) : (
          <>
            <Building2 className="size-4 text-muted" aria-hidden="true" />
            Organisation
          </>
        )}
      </h2>
      {rows}
    </section>
  );
}

/* ------------------------------------------------------------------------ the screen */

export function InboxScreen() {
  useDocumentTitle('Inbox');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const unreadOnly = params.get('unread') === '1';
  const mentionsOnly = params.get('mentions') === '1';
  const filtered = unreadOnly || mentionsOnly;

  const list = useNotifications({ per_page: PAGE_SIZE, ...(unreadOnly && { unread_only: true }), ...(mentionsOnly && { mentions_only: true }) });
  // the same query as the sidebar's badge, so both always agree
  const unreadQuery = useNotifications({ unread_only: true, per_page: 1 });
  const timeZone = useOrganization().data?.timezone ?? 'Europe/Berlin';
  const at = useClock();
  const previewId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);

  const markReadMutation = useMarkRead();
  const markAllMutation = useMarkAllRead();
  const deleteMutation = useDeleteNotification();

  /**
   * The cursor (the row the keys act on); rows waiting for their delete; what is marked read and not yet confirmed. A
   * notification marked read shows as read at once and goes back to unread when the server refuses.
   */
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(() => new Set());
  // calls of "all read" that are on their way (a count, so that one that ends does not end the mark of another)
  const [allReadCalls, setAllReadCalls] = useState(0);
  const allReadNow = allReadCalls > 0;
  const links = useRef(new Map<string, HTMLAnchorElement>());

  // what the server counts, less what is marked read and not yet confirmed
  const unreadCount = allReadNow ? 0 : Math.max(0, (unreadQuery.data?.total ?? 0) - readNow.size);

  const visible = useMemo(() => {
    const markedAt = now().toISOString();
    return (list.data?.items ?? [])
      .filter((notification) => !hidden.has(notification.id))
      .map((notification) => (notification.read_at === null && (allReadNow || readNow.has(notification.id)) ? { ...notification, read_at: markedAt } : notification))
      // in the unread list a notification that was just read leaves it
      .filter((notification) => !unreadOnly || notification.read_at === null);
  }, [list.data, hidden, readNow, allReadNow, unreadOnly]);
  const groups = useMemo(() => groupNotifications(visible), [visible]);
  const order = useMemo(() => groups.flatMap((group) => group.notifications.map((notification) => notification.id)), [groups]);
  const current = cursorId !== null && order.includes(cursorId) ? cursorId : null;
  // the list is one stop in the tab order: the row under the cursor, else the first
  const tabStop = current ?? order[0] ?? null;

  const registerLink = (id: string, element: HTMLAnchorElement | null) => {
    if (element) links.current.set(id, element);
    else links.current.delete(id);
  };

  function focusRow(id: string) {
    setCursorId(id);
    links.current.get(id)?.focus();
  }

  /**
   * The row the cursor takes over when `id` leaves the list: the one that moves up into its place. The groups sort again
   * without it (a group whose newest notification goes falls behind), so the row after it in today's order can be far
   * away by then; the row at the same place in the new order is where the eye is.
   */
  function survivorOf(id: string): string | null {
    const index = order.indexOf(id);
    const left = groupNotifications(visible.filter((notification) => notification.id !== id)).flatMap((group) => group.notifications.map((notification) => notification.id));
    return left[Math.min(index, left.length - 1)] ?? null;
  }

  function move(step: 1 | -1) {
    if (order.length === 0) return;
    if (current === null) {
      focusRow(step === 1 ? order[0] : order[order.length - 1]);
      return;
    }
    const next = order[order.indexOf(current) + step];
    if (next) focusRow(next);
  }

  function noCursor() {
    hint('Keine Benachrichtigung ausgewählt', 'Wähle eine mit J und K, oder klicke sie an.');
  }

  function setFilter(next: FilterValue[]) {
    const search = new URLSearchParams(params);
    for (const name of ['unread', 'mentions'] as const) {
      if (next.includes(name)) search.set(name, '1');
      else search.delete(name);
    }
    setParams(search, { replace: true });
    setCursorId(null);
  }

  /* actions */

  /**
   * The notifications show as read at once; no toast for it, as a refusal alone is worth one (spec 5.1). Every call
   * ends itself (`mutateAsync`): the callbacks of `mutate` only belong to the last of several calls on one hook, so the
   * mark of an earlier call would stay on, and its refusal would go unsaid.
   */
  async function markRead(ids: string[]) {
    setReadNow((state) => new Set([...state, ...ids]));
    try {
      await markReadMutation.mutateAsync(ids);
    } catch (error) {
      // the notifications are unread as before (the mark goes in the `finally`)
      notifyError('Nicht als gelesen markiert', error, () => void markRead(ids));
    } finally {
      // success: the lists have loaded again and say it
      setReadNow((state) => without(state, ids));
    }
  }

  async function markAll() {
    // only when the count is known to be zero: an unknown count (still loading, or failed) lets the call try
    if (unreadQuery.data && unreadCount === 0) {
      hint('Alles gelesen', 'Es gibt keine ungelesenen Benachrichtigungen.');
      return;
    }
    setAllReadCalls((calls) => calls + 1);
    try {
      await markAllMutation.mutateAsync();
    } catch (error) {
      notifyError('Nicht als gelesen markiert', error, () => void markAll());
    } finally {
      setAllReadCalls((calls) => calls - 1);
    }
  }

  /** The row goes at once, the call follows when the toast runs out; "Rückgängig" brings the row back. */
  function remove(id: string) {
    const next = survivorOf(id);
    if (current === id) {
      // the focus moves first, so removing the row does not drop it on the page
      if (next) focusRow(next);
      else setCursorId(null);
    }
    setHidden((state) => new Set(state).add(id));
    runWithUndo({
      label: 'Benachrichtigung gelöscht',
      failureTitle: 'Benachrichtigung nicht gelöscht',
      undo: () => setHidden((state) => without(state, [id])),
      run: async () => {
        try {
          await deleteMutation.mutateAsync(id);
        } catch (error) {
          setHidden((state) => without(state, [id]));
          throw error;
        }
      },
    });
  }

  function readCurrent() {
    if (current === null) {
      if (order.length > 0) noCursor();
      return;
    }
    const notification = visible.find((entry) => entry.id === current);
    if (!notification || notification.read_at !== null) return;
    // in the unread list the row is about to leave: the cursor goes on to the next one
    if (unreadOnly) {
      const next = survivorOf(current);
      if (next) focusRow(next);
      else setCursorId(null);
    }
    void markRead([current]);
  }

  function deleteCurrent() {
    if (current === null) {
      if (order.length > 0) noCursor();
      return;
    }
    remove(current);
  }

  function open(notification: Notification, href: string) {
    setCursorId(notification.id);
    // nothing navigates: the item opens beside the list; what belongs to no item leads to its page
    if (notification.work_item_id) useUiStore.getState().openPeek(notification.work_item_id);
    else void navigate(href);
  }

  /* shortcuts and palette */

  const rowHasFocus = () => [...links.current.values()].includes(document.activeElement as HTMLAnchorElement);
  /** Enter belongs to the list while nothing else holds the focus: a button or link elsewhere keeps its own Enter. */
  const listHasFocus = () => {
    const focus = document.activeElement;
    return !focus || focus === document.body || focus.id === 'main' || rowHasFocus();
  };
  const hasRows = () => order.length > 0;

  useShortcut({ id: 'inbox.next', keys: 'j', scope: 'list', label: 'Nächste Benachrichtigung', group: SHORTCUT_GROUP, repeat: true, when: hasRows, run: () => move(1) });
  useShortcut({ id: 'inbox.prev', keys: 'k', scope: 'list', label: 'Vorige Benachrichtigung', group: SHORTCUT_GROUP, repeat: true, when: hasRows, run: () => move(-1) });
  // the arrows move the cursor only while a row holds the focus, elsewhere they scroll
  useShortcut({ id: 'inbox.next.arrow', keys: 'arrowdown', scope: 'list', label: 'Nächste Benachrichtigung', group: SHORTCUT_GROUP, repeat: true, when: () => hasRows() && rowHasFocus(), run: () => move(1) });
  useShortcut({ id: 'inbox.prev.arrow', keys: 'arrowup', scope: 'list', label: 'Vorige Benachrichtigung', group: SHORTCUT_GROUP, repeat: true, when: () => hasRows() && rowHasFocus(), run: () => move(-1) });
  useShortcut({ id: 'inbox.read', keys: 'e', scope: 'list', label: 'Als gelesen markieren', group: SHORTCUT_GROUP, when: hasRows, run: readCurrent });
  useShortcut({ id: 'inbox.read_all', keys: 'shift+e', scope: 'list', label: 'Alle als gelesen markieren', group: SHORTCUT_GROUP, run: markAll });
  useShortcut({ id: 'inbox.delete', keys: '#', scope: 'list', label: 'Benachrichtigung löschen', group: SHORTCUT_GROUP, when: hasRows, run: deleteCurrent });
  useShortcut({
    id: 'inbox.open',
    keys: 'enter',
    scope: 'list',
    label: 'Item in der Vorschau öffnen',
    group: SHORTCUT_GROUP,
    when: () => hasRows() && listHasFocus(),
    run: () => {
      if (current === null) noCursor();
      // the same path as a click, so the cursor and the preview agree
      else links.current.get(current)?.click();
    },
  });
  useCommand({
    id: 'inbox.read_all',
    label: 'Alle Benachrichtigungen als gelesen markieren',
    group: SHORTCUT_GROUP,
    keys: 'shift+e',
    icon: <CheckCheck />,
    keywords: ['inbox', 'gelesen', 'erledigt'],
    run: markAll,
    when: () => unreadCount > 0,
  });

  /* the screen */

  // beside the open preview the list gives up the room the panel takes
  const previewMargin = previewId !== null && 'md:mr-[calc(var(--panel-w)+0.5rem)]';
  const filterValue: FilterValue[] = [...(unreadOnly ? (['unread'] as const) : []), ...(mentionsOnly ? (['mentions'] as const) : [])];

  let content;
  if (list.isPending) {
    content = <InboxSkeleton />;
  } else if (list.isError && !list.data) {
    content = (
      <ErrorState
        className="mt-5"
        title="Die Inbox konnte nicht geladen werden"
        description={list.error instanceof ApiError ? list.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  } else if (groups.length === 0) {
    const reset = (
      <Button variant="secondary" onClick={() => setFilter([])}>
        {unreadOnly && !mentionsOnly ? 'Alle anzeigen' : 'Filter zurücksetzen'}
      </Button>
    );
    content = !filtered ? (
      <EmptyState
        className="mt-5"
        icon={Inbox}
        badge={CheckCheck}
        title="Inbox ist leer"
        description="Erwähnungen, Zuweisungen und Änderungen an Items, die du beobachtest, landen hier."
        actions={
          <>
            <Link to="/me/notifications" className={buttonClass({ variant: 'secondary' })}>
              <SlidersHorizontal className="size-4 text-muted" aria-hidden="true" />
              Benachrichtigungen einstellen
            </Link>
            <Link to="/my-items" className={buttonClass({ variant: 'ghost' }, 'text-accent-text!')}>
              Meine Items öffnen
            </Link>
          </>
        }
      />
    ) : unreadOnly && !mentionsOnly ? (
      <EmptyState className="mt-5" icon={Inbox} badge={CheckCheck} title="Alles gelesen" description="Es gibt keine ungelesenen Benachrichtigungen." actions={reset} />
    ) : (
      <EmptyState
        className="mt-5"
        icon={Inbox}
        title={unreadOnly ? 'Keine ungelesenen Erwähnungen' : 'Keine Erwähnungen'}
        description="Wenn dich jemand in einer Beschreibung oder einem Kommentar erwähnt, steht es hier."
        actions={reset}
      />
    );
  } else {
    content = (
      <>
        {list.isError && (
          <Banner
            tone="danger"
            role="alert"
            className="mt-5"
            title="Die Inbox ist nicht auf dem neuesten Stand"
            action={
              <Button variant="secondary" size="sm" pending={list.isFetching} onClick={() => void list.refetch()}>
                Erneut versuchen
              </Button>
            }
          >
            Beim Aktualisieren ist ein Fehler aufgetreten. Die Liste zeigt den letzten Stand.
          </Banner>
        )}
        <div className="flex flex-col">
          {groups.map((group) => (
            <GroupCard
              key={group.key}
              group={group}
              current={current}
              tabStop={tabStop}
              previewed={group.itemId !== null && group.itemId === previewId}
              flashing={group.itemId !== null && flashIds.includes(group.itemId)}
              now={at}
              timeZone={timeZone}
              onOpen={open}
              onCursor={setCursorId}
              onMarkRead={(id) => void markRead([id])}
              onDelete={remove}
              registerLink={registerLink}
            />
          ))}
        </div>
        {list.data && list.data.total > list.data.items.length && (
          <p className="mt-5 max-w-[65ch] text-sm text-pretty text-muted">
            Die neuesten {count.format(list.data.items.length)} von {count.format(list.data.total)}&nbsp;Benachrichtigungen. Ältere erscheinen, sobald du neuere erledigt hast.
          </p>
        )}
      </>
    );
  }

  return (
    <div className={cx('max-w-3xl', previewMargin)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-h-8 min-w-0 items-baseline gap-3">
          <h1 className="font-display text-lg font-bold tracking-title text-ink">Inbox</h1>
          {/* announced politely, so a live notification is heard */}
          <p role="status" className="text-ui text-muted tabular-nums">
            {unreadQuery.data ? (unreadCount > 0 ? `${count.format(unreadCount)} ungelesen` : 'Alles gelesen') : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterToggles value={filterValue} onChange={setFilter} />
          <Button
            variant="secondary"
            icon={CheckCheck}
            shortcut="shift+e"
            pending={markAllMutation.isPending}
            disabledReason={unreadQuery.data && unreadCount === 0 ? 'Es gibt keine ungelesenen Benachrichtigungen.' : null}
            onClick={markAll}
          >
            Alle als gelesen markieren
          </Button>
        </div>
      </div>
      {content}
    </div>
  );
}
