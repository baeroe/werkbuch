/*
 * One notification of the inbox (spec 4.14): who did what, an excerpt for comments and mentions, how long ago, and
 * the two things you do with it, mark it read and delete it.
 *
 * Keyboard: the link over the row is the tab stop of the whole list (roving: `tabStop`), the screen moves the cursor
 * with j/k and acts with e and #. The buttons are no tab stops, like the chips of a list row; touch screens get
 * the same two actions in a menu.
 *
 * A row with an unread notification has the ink-blue dot; the whole row is the link (a plain click opens the item in the
 * preview, a click with ⌘/Ctrl or ⇧ and a middle click open its page in a new tab; either way the screen reads the
 * notification), and the actions sit above it.
 */

import { CalendarClock, CalendarSync, Check, Ellipsis, Trash2, Webhook, type LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { formatShortDay } from '@/components/fields/format';
import { useToday, useUserMap } from '@/components/fields/itemData';
import { linkFocusRing } from '@/components/items/ItemLink';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useTemplates } from '@/hooks/templates';
import { useWebhooks } from '@/hooks/webhooks';
import { useWorkflows } from '@/hooks/workflows';
import { hrefOf } from '@/lib/links';
import type { Notification, WorkItem } from '@/types';
import { changedFields, opensElsewhere, timeAgo } from './notifications';

/** How long a webhook may fail before the system switches it off (spec 4.14, 6.3): the reason in the row. */
const WEBHOOK_REASON = 'Er war 24\u00a0Stunden lang nicht erreichbar.';

/** A status with its shape and name; the colour comes from its category. */
function StateName({ stateId }: { stateId: string | undefined }) {
  const workflows = useWorkflows().data?.items;
  const state = workflows?.flatMap((workflow) => workflow.states).find((entry) => entry.id === stateId);
  if (!state) return <>einen anderen Status</>;
  return (
    <span className="inline-flex items-center gap-1 align-bottom font-medium whitespace-nowrap text-ink">
      <StatusIcon icon={state.icon} category={state.category} label="" aria-hidden="true" />
      {state.name}
    </span>
  );
}

function TemplateName({ templateId, projectId }: { templateId: string | undefined; projectId: string | null }) {
  const templates = useTemplates(projectId);
  const name = templates.data?.items.find((entry) => entry.id === templateId)?.name;
  return <span className="font-medium text-ink">{name ? `„${name}“` : 'einer Vorlage'}</span>;
}

function WebhookName({ webhookId }: { webhookId: string | undefined }) {
  // only org admins may read webhooks, and only they get this notification
  const webhooks = useWebhooks();
  const name = webhooks.data?.items.find((entry) => entry.id === webhookId)?.name;
  return <span className="font-medium text-ink">{name ? `„${name}“` : 'ein Webhook'}</span>;
}

/** What shows (and what goes) while the pointer, the focus or the cursor is on a row; pointers that hover only. */
const SHOW_ON_ROW =
  'md:[@media(hover:hover)]:group-hover/row:opacity-100 md:[@media(hover:hover)]:group-focus-within/row:opacity-100 md:[@media(hover:hover)]:group-data-[current]/row:opacity-100';
const HIDE_ON_ROW =
  'md:[@media(hover:hover)]:group-hover/row:opacity-0 md:[@media(hover:hover)]:group-focus-within/row:opacity-0 md:[@media(hover:hover)]:group-data-[current]/row:opacity-0';

/** The lead of a row without a person behind it: a reminder or something the system did. */
const FAILURES: Notification['event'][] = ['template_run_failed', 'webhook_disabled'];
const SYSTEM_ICONS: Partial<Record<Notification['event'], LucideIcon>> = {
  due: CalendarClock,
  template_run_failed: CalendarSync,
  webhook_disabled: Webhook,
};

type NotificationRowProps = {
  notification: Notification;
  /** The item it is about once it has loaded; null when it is gone or the person no longer sees it. */
  item: WorkItem | null | undefined;
  /** The keyboard cursor is on this row. */
  current: boolean;
  /** The one row of the list that is in the tab order. */
  tabStop: boolean;
  /** A live event just touched the item: the row shows it for a moment. */
  flashing: boolean;
  now: Date;
  timeZone: string;
  /** A plain click or Enter: the screen opens the item in the preview, or navigates. */
  onOpen: (notification: Notification, href: string) => void;
  /** The browser opens the page in a new tab or window (⌘/Ctrl- or ⇧-click, middle click): the screen reads it. */
  onOpenInTab: (notification: Notification) => void;
  /** The link got the focus: the cursor follows. */
  onCursor: (notificationId: string) => void;
  onMarkRead: (notificationId: string) => void;
  onDelete: (notificationId: string) => void;
  linkRef: Ref<HTMLAnchorElement>;
};

export function NotificationRow({ notification, item, current, tabStop, flashing, now, timeZone, onOpen, onOpenInTab, onCursor, onMarkRead, onDelete, linkRef }: NotificationRowProps) {
  const users = useUserMap();
  const { today } = useToday();
  const properties = useProperties().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;
  const unread = notification.read_at === null;
  const actor = notification.actor_id ? users.get(notification.actor_id) : undefined;
  const who = <span className={cx('font-semibold', unread ? 'text-ink' : 'font-medium text-ink')}>{actor?.name ?? 'Jemand'}</span>;
  const { data } = notification;

  let sentence: ReactNode;
  let excerpt: string | null = null;
  switch (notification.event) {
    case 'assigned':
      sentence = <>{who} hat dir das Item zugewiesen</>;
      break;
    case 'mentioned':
      sentence = <>{who} hat dich erwähnt</>;
      excerpt = data.excerpt ?? null;
      break;
    case 'comment':
      sentence = <>{who} hat kommentiert</>;
      excerpt = data.excerpt ?? null;
      break;
    case 'state_changed':
      sentence = (
        <>
          {who} hat den Status von <StateName stateId={data.from_state_id} /> auf <StateName stateId={data.to_state_id} /> gesetzt
        </>
      );
      break;
    case 'item_changed':
      sentence = (
        <>
          {who} hat {changedFields(data.fields ?? [], (key) => properties?.find((property) => property.key === key)?.label)} geändert
        </>
      );
      break;
    case 'item_created':
      sentence = <>{who} hat das Item angelegt</>;
      break;
    case 'due': {
      const due = data.due_date;
      const text = !due ? 'Fällig' : due === today ? 'Heute fällig' : due < today ? `Überfällig seit ${formatShortDay(due)}` : `Fällig am ${formatShortDay(due)}`;
      // the word says it and the icon is red; the text stays ink, which keeps its contrast on the cursor's highlighter wash
      sentence = <span className="font-semibold text-ink">{text}</span>;
      break;
    }
    case 'template_run_failed':
      sentence = (
        <>
          Die Vorlage <TemplateName templateId={data.template_id} projectId={notification.project_id} /> hat kein Item angelegt
        </>
      );
      excerpt = data.error ?? null;
      break;
    case 'webhook_disabled':
      sentence = (
        <>
          Der Webhook <WebhookName webhookId={data.webhook_id} /> wurde abgeschaltet
        </>
      );
      excerpt = WEBHOOK_REASON;
      break;
  }

  let href = '/inbox';
  if (notification.work_item_id) href = `/items/${item?.key ?? notification.work_item_id}`;
  else if (notification.event === 'webhook_disabled') href = '/settings/webhooks';
  else if (notification.event === 'template_run_failed') {
    const project = projects?.find((entry) => entry.id === notification.project_id);
    href = project ? `/projects/${project.identifier}/templates${data.template_id ? `/${data.template_id}` : ''}` : '/projects';
  }

  const SystemIcon = SYSTEM_ICONS[notification.event];
  const alarming = FAILURES.includes(notification.event) || (notification.event === 'due' && data.due_date !== undefined && data.due_date < today);
  const lead = actor ? (
    <Avatar user={actor} decorative className="mt-0.5" />
  ) : (
    <span aria-hidden="true" className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-sunken text-muted">
      {SystemIcon && <SystemIcon className={cx('size-4', alarming && 'text-danger')} />}
    </span>
  );
  const ago = timeAgo(notification.created_at, now, timeZone);
  const stamp = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(notification.created_at));

  return (
    <li
      data-current={current || undefined}
      data-unread={unread || undefined}
      className={cx(
        'group/row relative flex min-h-11 items-start gap-2.5 rounded-ctl px-2 py-2 transition-colors duration-120 md:min-h-9',
        current || flashing ? 'bg-wash' : 'hover:bg-hover',
        linkFocusRing,
      )}
    >
      <span aria-hidden="true" className={cx('mt-3 size-2 shrink-0 rounded-full', unread ? 'bg-accent' : 'bg-transparent')} />
      {lead}
      <div className="min-w-0 flex-1">
        <a
          ref={linkRef}
          href={hrefOf(href)}
          data-item-link=""
          data-focus-ring="none"
          tabIndex={tabStop ? 0 : -1}
          aria-current={current || undefined}
          onFocus={() => onCursor(notification.id)}
          onClick={(event) => {
            if (event.button !== 0) return;
            // a click with a modifier key is the browser's: a new tab or window opens the notification as well
            if (opensElsewhere(event)) onOpenInTab(notification);
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpen(notification, href);
          }}
          onAuxClick={(event) => {
            // the middle button opens the page in a new tab
            if (event.button === 1) onOpenInTab(notification);
          }}
          className={cx('block text-ui text-pretty break-words no-underline outline-none after:absolute after:inset-0 after:rounded-ctl', unread ? 'text-ink' : 'text-muted')}
        >
          {unread && (
            <>
              <span className="sr-only">Ungelesen:</span>{' '}
            </>
          )}
          {sentence}
          {excerpt && <span className="mt-0.5 line-clamp-2 block max-w-[65ch] text-sm break-words text-muted">„{excerpt}“</span>}
        </a>
        <time dateTime={notification.created_at} title={stamp} className="mt-0.5 block text-sm text-muted tabular-nums md:hidden">
          {ago}
        </time>
      </div>
      {/* the right edge: how long ago. With a mouse, the two buttons take its place while the pointer or the cursor is on the row */}
      <div className="-mt-0.5 grid shrink-0 items-center justify-items-end max-md:hidden">
        <time
          dateTime={notification.created_at}
          title={stamp}
          className={cx('col-start-1 row-start-1 text-sm whitespace-nowrap text-muted tabular-nums transition-opacity duration-120', HIDE_ON_ROW)}
        >
          {ago}
        </time>
        <div className={cx('relative z-10 col-start-1 row-start-1 hidden items-center gap-0.5 opacity-0 transition-opacity duration-120 md:[@media(hover:hover)]:flex', SHOW_ON_ROW)}>
          {unread && (
            <IconButton icon={Check} label="Als gelesen markieren" shortcut="e" tabIndex={-1} onClick={() => onMarkRead(notification.id)} />
          )}
          <IconButton icon={Trash2} label="Löschen" shortcut="#" tabIndex={-1} onClick={() => onDelete(notification.id)} />
        </div>
      </div>
      {/* on touch screens: one 44 px target with the same two actions */}
      <div className="relative z-10 -my-2 md:[@media(hover:hover)]:hidden">
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                tabIndex={-1}
                aria-label="Aktionen für diese Benachrichtigung"
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink data-popup-open:bg-hover md:size-7"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </button>
            }
          />
          <MenuContent align="end">
            {unread && (
              <MenuItem icon={Check} onClick={() => onMarkRead(notification.id)}>
                Als gelesen markieren
              </MenuItem>
            )}
            <MenuItem icon={Trash2} danger onClick={() => onDelete(notification.id)}>
              Löschen
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </li>
  );
}
