import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Bug,
  ClipboardList,
  FileText,
  Flag,
  FlaskConical,
  Layers,
  Lightbulb,
  Megaphone,
  MessageSquareHeart,
  Package,
  Palette,
  Rocket,
  Shield,
  SquareCheck,
  Star,
  Target,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import type { TypeTone } from '@/types';
import { cx } from './cx';

/** Icons a work item type can use, by Lucide name (WorkItemType.icon). */
export const TYPE_ICONS = {
  'square-check': SquareCheck,
  bug: Bug,
  zap: Zap,
  layers: Layers,
  'message-square-heart': MessageSquareHeart,
  'book-open': BookOpen,
  'clipboard-list': ClipboardList,
  'file-text': FileText,
  flag: Flag,
  'flask-conical': FlaskConical,
  lightbulb: Lightbulb,
  megaphone: Megaphone,
  package: Package,
  palette: Palette,
  rocket: Rocket,
  shield: Shield,
  star: Star,
  target: Target,
  users: Users,
  wrench: Wrench,
} satisfies Record<string, LucideIcon>;

export type TypeIconName = keyof typeof TYPE_ICONS;

/** Unknown names fall back to the task icon instead of rendering nothing. */
export function typeIcon(name: string): LucideIcon {
  return TYPE_ICONS[name as TypeIconName] ?? SquareCheck;
}

type TypeTabProps = { tone: TypeTone; icon: string; label: string; size?: 'sm' | 'md'; className?: string };

/** The tab of an index card: trapezoid flap in the type's tone, the icon always beside the text. */
export function TypeTab({ tone, icon, label, size = 'md', className }: TypeTabProps) {
  const Icon = typeIcon(icon);
  return (
    <span
      data-tone={tone}
      translate="no"
      className={cx(
        'tab-shape relative inline-flex max-w-full min-w-0 items-center gap-1 px-2.5 text-xs font-semibold whitespace-nowrap tabular-nums',
        size === 'sm' ? 'h-5' : 'h-6',
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
