/*
 * What axe still finds on a page of e2e/a11y-pages.ts, with a reason (A441, K15). An exception takes a violation out of
 * the check when its rule is `rule` and the element axe names matches `target` or lies inside an element that does
 * (`Element.closest`); `pages` narrows it to entries of the list by name. `target` is a stable selector: a `data-*`
 * attribute or the role of the component, never an id Base UI generates (`:r12:`), which changes with every render.
 * An exception stays only where axe is wrong, with the evidence in its reason; scripts/a11y-pages.test.mjs keeps the list
 * honest.
 *
 * Plain data without imports: the Vitest of the app reads it as it is.
 */

export type A11yException = {
  /** The id of the axe rule, e.g. `color-contrast`. */
  rule: string;
  /** A CSS selector of the element or of the component it lies in. */
  target: string;
  /** Why the violation stays, or what axe said, while it waits for its fix. */
  reason: string;
  /** Only on these entries of A11Y_PAGES (their names); everywhere without. */
  pages?: readonly string[];
  until?: 'Task 16';
};

export const A11Y_EXCEPTIONS: readonly A11yException[] = [
  {
    rule: 'aria-hidden-focus',
    target: '[data-base-ui-focus-guard]',
    reason:
      'axe is wrong here: the focus guards of a Base UI popup (@base-ui/react 1.9 utils/FocusGuard: a visually hidden span with aria-hidden and tabindex 0, role button under VoiceOver) take the focus only to pass it on at once, into the popup or to the next control, so the focus never rests on an aria-hidden element (Menu.test.tsx "passes the focus on from every focus guard of an open menu"). axe sees them while a menu or popover is open, on the phone not in every run.',
    pages: ['item menu', 'display menu', 'filter menu'],
  },
];
