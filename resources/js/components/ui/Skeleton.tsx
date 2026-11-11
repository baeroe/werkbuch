/*
 * Skeletons: placeholder blocks in the shape of the content to come. None shows during the first 300 ms (M3): an
 * answer within that time replaces the empty place without a flash of grey. The place is held meanwhile (`invisible`),
 * so nothing jumps when the skeleton or the content comes. A group says "Lädt …" to screen readers only together with
 * its skeletons.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cx } from './cx';

/** How long a skeleton waits before it shows. */
export const SKELETON_DELAY_MS = 300;

/** Whether `ms` have passed since the component mounted (always false while `enabled` is off). */
export function useLate(ms = SKELETON_DELAY_MS, enabled = true): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [ms, enabled]);
  return late;
}

/** Inside a group the skeletons show with it; on their own they wait for themselves. */
const InGroup = createContext(false);

/** A placeholder block in the shape of the content to come. Static on purpose: no shimmer loop. */
export function Skeleton({ className }: { className?: string }) {
  const inGroup = useContext(InGroup);
  const late = useLate(SKELETON_DELAY_MS, !inGroup);
  return <span aria-hidden="true" className={cx('block rounded-chip bg-line', !inGroup && !late && 'invisible', className)} />;
}

/** Wraps the skeletons of one view and, once they show, tells screen readers that it is loading. */
export function SkeletonGroup({
  label = t('common.loading'),
  className,
  as: Element = 'div',
  children,
}: {
  label?: string;
  className?: string;
  /** `span` for a group inside a line of text. */
  as?: 'div' | 'span';
  children: ReactNode;
}) {
  const late = useLate();
  // one element throughout, so the skeletons inside stay the same when they show; hidden from screen readers until then,
  // and a status (that says it is loading) only from then on
  return (
    <Element role={late ? 'status' : undefined} aria-hidden={late ? undefined : true} className={cx(!late && 'invisible', className)}>
      <span className="sr-only">{label}</span>
      <InGroup.Provider value={true}>{children}</InGroup.Provider>
    </Element>
  );
}
