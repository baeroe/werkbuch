import type { ComponentProps, ReactNode } from 'react';
import type { StateCategory, StateIcon } from '@/types';
import { cx } from './cx';

/** Shapes on a 24 px grid, drawn like Lucide (2 px stroke, round caps). */
const SHAPES: Record<StateIcon, ReactNode> = {
  dashed: (
    <>
      <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
      <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
      <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />
      <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
      <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />
      <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
      <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
      <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="10" />,
  half: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 18a6 6 0 0 0 0-12v12z" fill="currentColor" />
    </>
  ),
  'three-quarter': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 12V6a6 6 0 1 1-6 6z" fill="currentColor" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="10" x2="10" y1="15" y2="9" />
      <line x1="14" x2="14" y1="15" y2="9" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      {/* the tick knocks out of the filled circle in the colour of the surface below */}
      <path d="m16 9-5.5 5.5L8 12" style={{ stroke: 'var(--knock, var(--surface))' }} />
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
};

const CATEGORY_COLOR: Record<StateCategory, string> = {
  backlog: 'text-st-backlog',
  unstarted: 'text-st-unstarted',
  started: 'text-st-started',
  completed: 'text-st-completed',
  canceled: 'text-st-canceled',
};

type StatusIconProps = Omit<ComponentProps<'svg'>, 'children'> & { icon: StateIcon; category: StateCategory; label: string };

/** Colour = category, shape = status (DESIGN.md). Next to visible status text, pass aria-hidden. */
export function StatusIcon({ icon, category, label, className, ...rest }: StatusIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('size-4 shrink-0', CATEGORY_COLOR[category], className)}
      {...rest}
    >
      {SHAPES[icon]}
    </svg>
  );
}
