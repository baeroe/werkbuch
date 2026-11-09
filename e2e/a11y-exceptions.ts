/*
 * What axe still finds on a page of e2e/a11y-pages.ts, with a reason (A441, K15). An exception takes a violation out of
 * the check when its rule is `rule` and the element axe names matches `target` or lies inside an element that does
 * (`Element.closest`); `pages` narrows it to entries of the list by name. `target` is a stable selector: a `data-*`
 * attribute or the role of the component, never an id Base UI generates (`:r12:`), which changes with every render.
 * `until: 'Task 16'` marks what Task 16 fixes; scripts/a11y-pages.test.mjs keeps the list honest.
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
    rule: 'label-content-name-mismatch',
    target: 'button[data-picker-trigger]',
    reason:
      'axe: Ensure that elements labelled through their content must have their visible text as part of their accessible name. The date pickers show a short day (“27 Oct”) and are named “Start date: 27/10/2026”.',
    until: 'Task 16',
  },
];
