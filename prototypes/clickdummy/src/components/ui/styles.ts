import { cx } from './cx';

/** Input look: white field with the writing line at the bottom (≥ 3:1); danger frame and line on error. */
export function fieldClass(invalid: boolean): string {
  return cx(
    'w-full rounded-ctl border bg-surface text-ink transition-colors duration-120 placeholder:text-muted',
    'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted disabled:shadow-none',
    invalid ? 'border-danger shadow-[inset_0_-1.5px_0_var(--danger)]' : 'border-line shadow-[inset_0_-1.5px_0_var(--line-input)] enabled:hover:border-line-strong',
  );
}

/** Single-line control height: 44 px touch target on phones, 36 px from md on; 16 px text avoids iOS zoom. */
export const fieldSize = 'h-11 px-3 text-input md:h-9 md:text-md';

/** Floating list surface (menus, select, combobox, popover): strong tracing paper, elevation 2. */
export const popupSurface = 'tracing-strong popup-motion rounded-card text-ui text-ink outline-none [--glass-shadow:var(--elev-2)]';

/**
 * Popups take focus themselves when they open; the active row shows where the keyboard is, so the popup
 * surface gets no focus ring of its own.
 */
export const popupFocus = { 'data-focus-ring': 'none' } as const;

/** Keep the preferred side instead of flipping when space runs out (e.g. the gallery's open specimens). */
export const keptSide = { side: 'none', align: 'none' } as const;

/**
 * Row in a floating list. The active stripe is a layer of card with elevation 1 and a pencil edge; the edge
 * carries the state, because white on tracing paper alone is too faint.
 */
export const optionClass = cx(
  'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-ink outline-none select-none md:min-h-8',
  'highlighted:bg-raised highlighted:shadow-elev-1 highlighted:ring-1 highlighted:ring-line-input highlighted:ring-inset',
  'data-disabled:cursor-not-allowed data-disabled:opacity-50',
);

export const labelClass = 'text-sm font-medium text-ink';
