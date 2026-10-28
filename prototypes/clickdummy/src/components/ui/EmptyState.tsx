import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';

type EmptyStateProps = {
  icon: LucideIcon;
  /** Small mark at the corner of the icon, e.g. a check for "all done". */
  badge?: LucideIcon;
  title: ReactNode;
  /** What is missing and what lands here. */
  description?: ReactNode;
  /** The next action(s). */
  actions?: ReactNode;
  /** The title's element: a heading where the empty state is the whole page (the 404 page). */
  titleAs?: 'p' | 'h1' | 'h2';
  className?: string;
};

/** Empty view on dot-grid paper with a dashed edge: says what is missing and offers the next step. */
export function EmptyState({ icon: Icon, badge: Badge, title, description, actions, titleAs: Title = 'p', className }: EmptyStateProps) {
  return (
    <div className={cx('dots flex flex-col items-center rounded-card border border-dashed border-line-strong bg-paper px-6 py-10 text-center', className)}>
      <span className="relative inline-flex size-14 items-center justify-center rounded-card border border-line bg-surface shadow-elev-1" aria-hidden="true">
        <Icon className="size-6 text-muted" />
        {Badge && (
          <span className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-surface text-st-completed ring-1 ring-line">
            <Badge className="size-3.5" strokeWidth={2.5} />
          </span>
        )}
      </span>
      <Title className="mt-4 max-w-full font-display text-lg font-bold tracking-title break-words text-balance text-ink">{title}</Title>
      {description && <p className="mt-1 max-w-[46ch] text-ui break-words text-pretty text-muted">{description}</p>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2.5">{actions}</div>}
    </div>
  );
}
