/*
 * The unread count on the inbox (spec 4.14, 5.2): in the sidebar, the collapsed rail and the phone bar. It shows from
 * 1 on and stops at "99+"; at 0 there is none. The badge is a picture of the link's name: the link says the count
 * (`useInboxName`, "Inbox, 3 ungelesen"), the badge itself is hidden from screen readers, so the count is read once.
 * It follows the inbox live: `notifications.changed` makes every inbox query stale (`useLiveSync`, Task 14), marking in
 * the inbox does the same.
 */

import { cx } from '@/components/ui/cx';
import { useUnreadCount } from '@/hooks/notifications';
import { intlLocale, t } from '@/lib/i18n';

/** Above this the badge says "99+"; the name of the link keeps the whole number. */
const MAX_SHOWN = 99;

const LOOK = {
  // a pill at the end of the sidebar row
  full: 'h-5 min-w-5 shrink-0 px-1.5',
  // on the corner of the rail's icon
  rail: 'absolute -top-1 -right-1 h-4 min-w-4 px-1 leading-none',
  // on the corner of the phone bar's icon, inside its 44 px target
  bar: 'absolute top-1.5 right-0.5 h-4 min-w-4 px-1 leading-none ring-2 ring-surface',
} as const;

const formatCount = (count: number) => new Intl.NumberFormat(intlLocale()).format(count);

/** The name of an inbox link: "Inbox", with unread notifications "Inbox, 3 ungelesen". */
export function useInboxName(): string {
  const count = useUnreadCount();
  return count > 0 ? t('shell.nav.inbox_unread', { count: formatCount(count) }) : t('shell.nav.inbox');
}

export function InboxBadge({ look }: { look: keyof typeof LOOK }) {
  const count = useUnreadCount();
  if (count === 0) return null;
  return (
    <span
      data-inbox-badge
      aria-hidden="true"
      className={cx('inline-flex items-center justify-center rounded-full bg-accent text-2xs font-semibold text-on-accent tabular-nums', LOOK[look])}
    >
      {count > MAX_SHOWN ? `${MAX_SHOWN}+` : formatCount(count)}
    </span>
  );
}
