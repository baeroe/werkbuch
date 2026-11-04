/*
 * What several parts of the wiki share: the sheet a page and the overview stand on, and how many subpages go along
 * (the tree while dragging, the question before a delete). Days are read in the organisation's time zone
 * (`useInstantDay`), never in a fixed one.
 */

import { tn } from '@/lib/i18n';

/** The paper of a page and of the overview (DESIGN.md: a sheet on the dot grid). */
export const SHEET = 'min-w-0 max-w-[52rem] rounded-card border border-line bg-surface px-5 py-5 shadow-elev-1 md:px-10 md:py-8';

/** "1 Unterseite", "4 Unterseiten" */
export const subpages = (count: number): string => tn('wiki.subpages', count);
