/*
 * Motion of DESIGN.md for code that animates itself (dnd-kit's drop animation runs on the Web Animations API, which
 * takes neither a CSS variable as its curve nor a duration with a unit): whether the person asked for less motion, and
 * the spring as a curve the browser takes.
 */

/** The person asked for less motion (`prefers-reduced-motion: reduce`). */
export const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How long the spring takes (`--dur-spring`). */
export const SPRING_MS = 420;

/** The spring of DESIGN.md (`--ease-spring`), as Web Animations need it: the curve itself, not the variable. */
export function springEasing(): string {
  const fallback = 'cubic-bezier(0.34, 1.3, 0.64, 1)';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim();
  if (!value || typeof KeyframeEffect === 'undefined') return fallback;
  try {
    new KeyframeEffect(null, null, { easing: value });
    return value;
  } catch {
    return fallback;
  }
}
