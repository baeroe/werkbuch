/*
 * The levels of the one rich text editor (spec 4.16). Which blocks a level knows decides its schema:
 * - `comment`: text, lists, quotes, code, links
 * - `description` (items, templates, rich text properties): adds headings, checklists and tables
 * - `page` (wiki): everything, also horizontal rules
 * All levels share the Markdown shortcuts while typing. The server stores the nodes of `page` for every level
 * (`App\RichText\Schema`); a level only narrows what its editor offers and shows.
 *
 * Phase 7 brings the `/` menu (it offers tables only on `page`: `slashTable`), mentions, references and uploads; until
 * then the placeholders name none of them (P15).
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
  comment: { headings: false, taskList: false, table: false, slashTable: false, horizontalRule: false },
  description: { headings: true, taskList: true, table: true, slashTable: false, horizontalRule: false },
  page: { headings: true, taskList: true, table: true, slashTable: true, horizontalRule: true },
};

/** The accessible name of an editor of a level, unless the caller names it. */
export const PRESET_LABEL: Record<EditorPreset, TranslationKey> = {
  comment: 'editor.label.comment',
  description: 'editor.label.description',
  page: 'editor.label.page',
};

/** What an empty editor shows. */
export const PRESET_PLACEHOLDER: Record<EditorPreset, TranslationKey> = {
  comment: 'editor.placeholder.comment',
  description: 'editor.placeholder.description',
  page: 'editor.placeholder.page',
};
