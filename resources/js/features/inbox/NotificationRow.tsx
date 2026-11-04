/*
 * One notification of the inbox (spec 4.14), ported from the clickdummy's NotificationRow: who did what, an excerpt for
 * comments and mentions, how long ago. A row with an unread notification has the ink-blue dot and the word "Ungelesen"
 * for screen readers. The whole row is the link: a plain click (or Enter) opens the item in the preview, a click with
 * ⌘/Ctrl or ⇧ and a middle click are the browser's (the item's page in a new tab); what belongs to no item leads to its
 * page. The list is one stop in the tab order (`tabStop`, roving over `data-nav-target`); under the row with the cursor
 * a hint names the key that changes it (13c: e for an unread one, u for a read one).
 *
 * Who: the actor's avatar and name (a bot with the word "Bot"), an account the list does not know as "Jemand"; a
 * reminder has nobody behind it and reads as werkbuch, a failed template or a switched-off webhook says what happened
 * without anyone. The states of a status change are named as they were at the move (`data.from`/`data.to`), so a
 * renamed or removed status still reads.
 */

import { CalendarClock, CalendarSync, Webhook, type LucideIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { botWord, formatDay } from '@/components/fields/format';
import { linkFocusRing } from '@/components/items/ItemLink';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/Kbd';
import { formatMoment } from '@/features/item-detail/activity/when';
import { tx } from '@/features/item-detail/activity/phrases';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Notification, Project, StateSnapshot, User } from '@/types';
import { changedFields, timeAgo } from './notifications';

/** What every row reads from the catalogs; the screen loads them once. */
export interface RowContext {
  users: ReadonlyMap<string, User>;
  propertyLabel: (key: string) => string | undefined;
  project: (id: string | null) => Project | undefined;
  now: Date;
  timeZone: string;
}

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
  /** The keyboard cursor is on this row. */
  current: boolean;
  /** The one row of the list that is in the tab order. */
  tabStop: boolean;
  /** A plain click or Enter: the screen opens the item in the preview, or the page of what belongs to no item. */
  onOpen: (notification: Notification, href: string) => void;
  /** The link got the focus: the cursor follows. */
  onCursor: (notificationId: string) => void;
};

export function NotificationRow({ notification, ctx, current, tabStop, onOpen, onCursor }: NotificationRowProps) {
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
    // a click with a modifier key, or with another button, is the browser's: a new tab, a new window, a saved link
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(notification, href);
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
          href={href}
          data-nav-target=""
          data-focus-ring="none"
          tabIndex={tabStop ? 0 : -1}
          aria-current={current || undefined}
          onFocus={() => onCursor(notification.id)}
          onClick={click}
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
      <time dateTime={notification.created_at} title={stamp} className="mt-0.5 shrink-0 text-sm whitespace-nowrap text-muted tabular-nums max-md:hidden">
        {ago}
      </time>
    </li>
  );
}
