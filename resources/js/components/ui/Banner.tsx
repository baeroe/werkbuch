import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Info } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

type BannerTone = 'neutral' | 'info' | 'danger';

const TONES: Record<BannerTone, { box: string; icon: string; title: string; defaultIcon: LucideIcon }> = {
  neutral: { box: 'bg-sunken', icon: 'text-muted', title: 'text-ink', defaultIcon: Info },
  info: { box: 'bg-accent-soft', icon: 'text-accent-text', title: 'text-accent-text', defaultIcon: Info },
  danger: { box: 'bg-danger-soft', icon: 'text-danger', title: 'text-danger', defaultIcon: CircleAlert },
};

type BannerProps = Omit<ComponentProps<'div'>, 'title'> & {
  tone?: BannerTone;
  icon?: LucideIcon;
  title: ReactNode;
  /** Optional action on the right (a button). */
  action?: ReactNode;
};

/**
 * A notice set into the page (radius 10): blocked by, live updates paused, edit conflict. Pass role="status"
 * or role="alert" when it appears while the person works. Below `sm` the action goes under the text (A646): beside it,
 * it would leave the text a column of one word per line.
 */
export function Banner({ tone = 'neutral', icon, title, action, className, children, ...rest }: BannerProps) {
  const look = TONES[tone];
  const Icon = icon ?? look.defaultIcon;
  return (
    <div className={cx('flex flex-wrap items-start gap-x-2.5 gap-y-1.5 rounded-ctl px-3 py-2 sm:flex-nowrap', look.box, className)} {...rest}>
      <Icon className={cx('mt-0.5 size-4 shrink-0', look.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cx('text-sm font-semibold break-words text-pretty', look.title)}>{title}</p>
        {children && <div className="mt-0.5 text-ui break-words text-ink text-pretty">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center max-sm:basis-full max-sm:pl-6.5">{action}</div>}
    </div>
  );
}
