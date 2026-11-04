/*
 * One notification of the inbox (spec 4.14), ported from the clickdummy's NotificationRow: who did what, an excerpt for
 * comments and mentions, how long ago, and the two things you do with it: mark it read (or unread again, once it is
 * read) and delete it. A row with an unread notification has the ink-blue dot and the word "Ungelesen" for screen
 * readers. The whole row is the link: a plain click (or Enter) opens the item in the preview, a click with ⌘/Ctrl or ⇧
 * and a middle click are the browser's (the item's page in a new tab); either way the screen reads the notification
 * (Alt saves the link: nothing opens, nothing is read). What belongs to no item leads to its page.
 *
 * Keyboard: the list is one stop in the tab order (`tabStop`, roving over `data-nav-target`); the row's two buttons
 * follow it in the tab order (13c "Zeilenaktionen per Tab"), named with the key of the card ("Löschen: WEB-47"). With a
 * mouse they take the place of the time while the pointer, the focus or the cursor is on the row; on a phone they show
 * on the row with the cursor. Under that row a hint names the key that changes it (13c: e for an unread one, u for a
 * read one).
 *
 * Who: the actor's avatar and name (a bot with the word "Bot"), an account the list does not know as "Jemand"; a
 * reminder has nobody behind it and reads as werkbuch, a failed template or a switched-off webhook says what happened
 * without anyone. The states of a status change are named as they were at the move (`data.from`/`data.to`), so a
 * renamed or removed status still reads.
 */

import { CalendarClock, CalendarSync, Check, CircleDot, Trash2, Webhook, type LucideIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { botWord, formatDay } from '@/components/fields/format';
import { linkFocusRing } from '@/components/items/ItemLink';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { formatMoment } from '@/features/item-detail/activity/when';
import { tx } from '@/features/item-detail/activity/phrases';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Notification, Project, StateSnapshot, User } from '@/types';
import { changedFields, opensElsewhere, timeAgo } from './notifications';

/** What every row reads from the catalogs; the screen loads them once. */
export interface RowContext {
  users: ReadonlyMap<string, User>;
  propertyLabel: (key: string) => string | undefined;
  project: (id: string | null) => Project | undefined;
  now: Date;
  timeZone: string;
}

/** What the rows do; the screen acts on the notification. */
export interface RowActions {
  /** A plain click or Enter: the screen opens the item in the preview, or the page of what belongs to no item. */
  open: (notification: Notification, href: string) => void;
  /** The browser opens the page in a new tab or window (⌘/Ctrl- or ⇧-click, middle click): the screen reads it. */
  openedElsewhere: (notification: Notification) => void;
  /** The link got the focus: the cursor follows. */
  cursor: (notificationId: string) => void;
  markRead: (notification: Notification) => void;
  markUnread: (notification: Notification) => void;
  remove: (notificationId: string) => void;
  /** The row's link, for the keys that move the focus. */
  register: (notificationId: string, element: HTMLAnchorElement | null) => void;
}

/** With a mouse: what shows (the buttons) and what goes (the time) while the pointer, the focus or the cursor is on a row. */
const SHOW_ON_ROW =
  'md:pointer-events-none md:opacity-0 md:group-hover/row:pointer-events-auto md:group-hover/row:opacity-100 md:group-focus-within/row:pointer-events-auto md:group-focus-within/row:opacity-100 md:group-data-[current]/row:pointer-events-auto md:group-data-[current]/row:opacity-100';
const HIDE_ON_ROW = 'md:group-hover/row:opacity-0 md:group-focus-within/row:opacity-0 md:group-data-[current]/row:opacity-0';

/** The lead of a row without a person behind it: a reminder or something the system did. */
const SYSTEM_ICONS: Partial<Record<Notification['event'], LucideIcon>> = {
  due: CalendarClock,
  template_run_failed: CalendarSync,
  webhook_disabled: Webhook,
};

/**
 * Where a notification leads: its item, the project of a failed template, the organisation's settings for a webhook
 * (until phases 10 and 11 bring the pages of templates and webhooks; the demo rows name neither).
 */
export function hrefOf(notification: Notification, project: Project | undefined): string {
  if (notification.work_item_id) return paths.item(notification.item?.key ?? notification.work_item_id);
  if (notification.event === 'template_run_failed') return project ? paths.project(project.identifier) : paths.projects();
  return paths.settings();
}

/** Who did it: the name, a bot with the word "Bot" beside it. */
function Who({ user, unread }: { user: User | undefined; unread: boolean }) {
  const word = user && botWord(user);
  return (
    <>
      <span className={cx(unread ? 'font-semibold' : 'font-medium', 'text-ink')}>{user?.name ?? t('items.someone')}</span>
      {word && (
        <>
          {' '}
          <span className="rounded-chip bg-sunken px-1 py-px align-[1px] text-xs font-semibold text-muted">{word}</span>
        </>
      )}
    </>
  );
}

function StateName({ state, fallback }: { state: StateSnapshot | null | undefined; fallback: string }) {
  return <span className="font-medium text-ink">{state?.name ?? fallback}</span>;
}

/** The sentence of a notification and the excerpt below it. */
function sentenceOf(notification: Notification, ctx: RowContext): { sentence: ReactNode; excerpt: string | null } {
  const { data } = notification;
  const unread = notification.read_at === null;
  const actor = <Who user={notification.actor_id ? ctx.users.get(notification.actor_id) : undefined} unread={unread} />;
  switch (notification.event) {
    case 'assigned':
    case 'mentioned':
    case 'comment':
    case 'item_created':
      return { sentence: tx(`inbox.kind.${notification.event}`, { actor }), excerpt: notification.excerpt };
    case 'state_changed':
      return {
        sentence: tx('inbox.kind.state_changed', {
          actor,
          from: <StateName state={data.from} fallback={t('inbox.state.unknown_from')} />,
          to: <StateName state={data.to} fallback={t('inbox.state.unknown_to')} />,
        }),
        excerpt: null,
      };
    case 'item_changed':
      return { sentence: tx('inbox.kind.item_changed', { actor, fields: changedFields(data.fields ?? [], ctx.propertyLabel) }), excerpt: null };
    case 'due': {
      // overdue only as the reminder said it on its day (A275): the inbox does not work it out again
      const system = <span className={cx(unread ? 'font-semibold' : 'font-medium', 'text-ink')}>{t('inbox.system')}</span>;
      const day = data.due_date ? formatDay(data.due_date) : '';
      return { sentence: tx(data.overdue ? 'inbox.kind.overdue' : 'inbox.kind.due', { actor: system, day }), excerpt: null };
    }
    case 'template_run_failed':
      return { sentence: t('inbox.kind.template_run_failed'), excerpt: data.error ?? null };
    case 'webhook_disabled':
      return { sentence: t('inbox.kind.webhook_disabled'), excerpt: t('inbox.webhook_reason') };
  }
}

type NotificationRowProps = {
  notification: Notification;
  ctx: RowContext;
  /** What the buttons name the row by: the key of the card's item, else the card's heading. */
  subject: string;
  /** The keyboard cursor is on this row. */
  current: boolean;
  /** The one row of the list that is in the tab order, its buttons with it. */
  tabStop: boolean;
  actions: RowActions;
};

export function NotificationRow({ notification, ctx, subject, current, tabStop, actions }: NotificationRowProps) {
  const unread = notification.read_at === null;
  const actor = notification.actor_id ? ctx.users.get(notification.actor_id) : undefined;
  const { sentence, excerpt } = sentenceOf(notification, ctx);
  const href = hrefOf(notification, ctx.project(notification.project_id));

  const SystemIcon = SYSTEM_ICONS[notification.event];
  const alarming = notification.event !== 'due' || notification.data.overdue === true;
  const lead = actor ? (
    <Avatar user={actor} decorative className="mt-0.5" />
  ) : (
    <span aria-hidden="true" className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-sunken text-muted">
      {SystemIcon && <SystemIcon className={cx('size-4', alarming && 'text-danger')} />}
    </span>
  );
  const ago = timeAgo(notification.created_at, ctx.now, ctx.timeZone);
  const stamp = formatMoment(notification.created_at, ctx.timeZone);

  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0) return;
    // a click with a modifier key is the browser's: a new tab or window opens the notification as well, Alt saves the link
    if (opensElsewhere(event)) actions.openedElsewhere(notification);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    actions.open(notification, href);
  }

  return (
    <li
      data-current={current || undefined}
      data-unread={unread || undefined}
      className={cx(
        'group/row relative flex min-h-11 items-start gap-2.5 rounded-ctl px-2 py-2 transition-colors duration-120 md:min-h-9',
        current ? 'bg-wash' : 'hover:bg-hover',
        linkFocusRing,
      )}
    >
      <span aria-hidden="true" className={cx('mt-3 size-2 shrink-0 rounded-full', unread ? 'bg-accent' : 'bg-transparent')} />
      {lead}
      <div className="min-w-0 flex-1">
        <a
          ref={(element) => actions.register(notification.id, element)}
          href={href}
          data-nav-target=""
          data-focus-ring="none"
          tabIndex={tabStop ? 0 : -1}
          aria-current={current || undefined}
          onFocus={() => actions.cursor(notification.id)}
          onClick={click}
          onAuxClick={(event) => {
            // the middle button opens the page in a new tab
            if (event.button === 1) actions.openedElsewhere(notification);
          }}
          className={cx('block text-ui text-pretty break-words no-underline outline-none after:absolute after:inset-0 after:rounded-ctl', unread ? 'text-ink' : 'text-muted')}
        >
          {unread && (
            <>
              <span className="sr-only">{t('inbox.unread_mark')}</span>{' '}
            </>
          )}
          {sentence}
          {excerpt && <span className="mt-0.5 line-clamp-2 block max-w-[65ch] text-sm break-words text-muted">„{excerpt}“</span>}
        </a>
        <time dateTime={notification.created_at} title={stamp} className="mt-0.5 block text-sm text-muted tabular-nums md:hidden">
          {ago}
        </time>
        {current && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted max-md:hidden">
            <Kbd keys={unread ? 'e' : 'u'} />
            {t(unread ? 'inbox.hint.read' : 'inbox.hint.unread')}
          </p>
        )}
      </div>
      {/* the right edge: how long ago, and in its place the two buttons (on a phone: beside the row with the cursor) */}
      <div className="-mt-0.5 grid shrink-0 items-center justify-items-end max-md:-my-1.5">
        <time
          dateTime={notification.created_at}
          title={stamp}
          className={cx('col-start-1 row-start-1 mt-0.5 text-sm whitespace-nowrap text-muted tabular-nums transition-opacity duration-120 max-md:hidden', HIDE_ON_ROW)}
        >
          {ago}
        </time>
        <div
          className={cx(
            'relative z-10 col-start-1 row-start-1 flex items-center gap-0.5 transition-opacity duration-120',
            'max-md:hidden max-md:group-focus-within/row:flex max-md:group-data-[current]/row:flex',
            SHOW_ON_ROW,
          )}
        >
          {/* one button that changes its word, so it keeps the focus */}
          <IconButton
            icon={unread ? Check : CircleDot}
            label={t(unread ? 'inbox.row.read' : 'inbox.row.unread', { key: subject })}
            shortcut={unread ? 'e' : 'u'}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => (unread ? actions.markRead(notification) : actions.markUnread(notification))}
          />
          <IconButton icon={Trash2} label={t('inbox.row.delete', { key: subject })} shortcut="#" tabIndex={tabStop ? 0 : -1} onClick={() => actions.remove(notification.id)} />
        </div>
      </div>
    </li>
  );
}
