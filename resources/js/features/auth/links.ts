import { cx } from '@/components/ui/cx';

/** The text links of the screens before signing in: a 44 px touch target on small screens. */
export function linkClass(extra?: string): string {
  return cx('inline-flex h-11 items-center rounded-chip px-2 text-ui font-medium text-accent-text underline-offset-2 hover:underline md:h-8', extra);
}
