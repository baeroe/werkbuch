import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cx } from './cx';

/** A placeholder block in the shape of the content to come. Static on purpose: no shimmer loop. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block rounded-chip bg-line', className)} />;
}

/** Wraps the skeletons of one view and tells screen readers that it is loading. */
export function SkeletonGroup({ label = t('common.loading'), className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
