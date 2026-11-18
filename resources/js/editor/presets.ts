/*
 * The levels of the one rich text editor (spec 4.16). Which blocks a level knows decides its schema:
 * - `comment`: text, lists, quotes, code, links and tables (WEBU-11)
 * - `description` (items, templates, rich text properties): adds headings and checklists
 * - `page` (wiki): everything, also horizontal rules
 * All levels share the Markdown shortcuts while typing, the `/` menu, code highlighting, mentions, references, images
 * and files. The server stores the nodes of `page` for every level (`App\RichText\Schema`); a level only narrows what
 * its editor offers and shows. The `/` menu offers tables wherever a level knows them (`slashTable`, WEBU-8: also in a
 * description, a template and a rich text property, WEBU-11: in a comment); a column keeps at least 6 rem, so a table wider than its text
 * scrolls sideways in its frame instead of squeezing its cells.
 */

import type { TranslationKey } from '@/lib/i18n';

export type EditorPreset = 'comment' | 'description' | 'page';

export interface PresetFeatures {
  headings: boolean;
  taskList: boolean;
  table: boolean;
  /** Offered in the `/` menu (Phase 7). */
  slashTable: boolean;
  horizontalRule: boolean;
}

export const PRESETS: Record<EditorPreset, PresetFeatures> = {
  comment: { headings: false, taskList: false, table: true, slashTable: true, horizontalRule: false },
  description: { headings: true, taskList: true, table: true, slashTable: true, horizontalRule: false },
  page: { headings: true, taskList: true, table: true, slashTable: true, horizontalRule: true },
};

/** The accessible name of an editor of a level, unless the caller names it. */
export const PRESET_LABEL: Record<EditorPreset, TranslationKey> = {
  comment: 'editor.label.comment',
  description: 'editor.label.description',
  page: 'editor.label.page',
};

/** What an empty editor of a project shows; it also says how to reach the menus (`/`, `@`, `#`). */
export const PRESET_PLACEHOLDER: Record<EditorPreset, TranslationKey> = {
  comment: 'editor.placeholder.comment',
  description: 'editor.placeholder.description',
  page: 'editor.placeholder.page',
};

/** What an empty editor without a project shows: only `/` works there. */
export const PRESET_PLACEHOLDER_PLAIN: Record<EditorPreset, TranslationKey> = {
  comment: 'editor.placeholder.plain.comment',
  description: 'editor.placeholder.plain.description',
  page: 'editor.placeholder.plain.page',
};
