import type { LucideIcon } from 'lucide-react';
import { Bot, Building2, CalendarClock, CircleDot, Eye, Inbox, Layers, ListTodo, OctagonAlert, Route, Timer, UserRoundCheck } from 'lucide-react';
import { cx } from './cx';
import { TYPE_ICONS } from './TypeTab';

/** Icons a view can use, by Lucide name (View.icon): the type icons and a few more for views. */
export const VIEW_ICONS: Record<string, LucideIcon> = {
  ...TYPE_ICONS,
  bot: Bot,
  'building-2': Building2,
  'calendar-clock': CalendarClock,
  'circle-dot': CircleDot,
  eye: Eye,
  inbox: Inbox,
  'list-todo': ListTodo,
  'octagon-alert': OctagonAlert,
  route: Route,
  timer: Timer,
  'user-round-check': UserRoundCheck,
};

const EMOJI = /\p{Extended_Pictographic}/u;

/** A view's icon: a Lucide icon by name, or the emoji somebody chose; unknown names fall back to layers. Decorative. */
export function ViewIcon({ icon, className }: { icon: string; className?: string }) {
  if (!VIEW_ICONS[icon] && EMOJI.test(icon)) {
    return (
      <span aria-hidden="true" className={cx('inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none', className)}>
        {icon}
      </span>
    );
  }
  const Icon = VIEW_ICONS[icon] ?? Layers;
  return <Icon aria-hidden="true" className={cx('size-4 shrink-0', className)} />;
}
