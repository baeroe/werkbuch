import type { LucideIcon } from 'lucide-react';
import { Bot, Building2, CalendarClock, CircleDot, Eye, Inbox, Layers, ListTodo, OctagonAlert, Route, Timer, UserRoundCheck } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';
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

/** The icons the view dialogs offer (names of `VIEW_ICONS`), with the name a person reads (K23). */
export const ICON_OPTIONS: readonly { value: string; label: TranslationKey }[] = [
  { value: 'layers', label: 'ui.view_icon.layers' },
  { value: 'list-todo', label: 'ui.view_icon.list_todo' },
  { value: 'square-check', label: 'ui.view_icon.square_check' },
  { value: 'bug', label: 'ui.view_icon.bug' },
  { value: 'zap', label: 'ui.view_icon.zap' },
  { value: 'calendar-clock', label: 'ui.view_icon.calendar_clock' },
  { value: 'route', label: 'ui.view_icon.route' },
  { value: 'building-2', label: 'ui.view_icon.building' },
  { value: 'user-round-check', label: 'ui.view_icon.person' },
  { value: 'octagon-alert', label: 'ui.view_icon.warning' },
  { value: 'eye', label: 'ui.view_icon.eye' },
  { value: 'flag', label: 'ui.view_icon.flag' },
  { value: 'rocket', label: 'ui.view_icon.rocket' },
  { value: 'target', label: 'ui.view_icon.target' },
];

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
