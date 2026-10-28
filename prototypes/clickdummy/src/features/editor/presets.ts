/*
 * The levels of the one rich text editor (spec 4.16). Which blocks a level knows decides its schema and its `/` menu:
 * - `comment`: text, lists, quotes, code, links, mentions and references, images and files
 * - `description` (items, templates, rich text properties): adds headings, checklists and tables
 * - `page` (wiki): everything, also horizontal rules
 * All levels share the `/` menu, the Markdown shortcuts while typing and pasting or dropping images and files.
 *
 * The `/` menu follows the plan: Überschrift, Liste, Checkliste, Code, Zitat, Tabelle (only `page`) and Bild, each only
 * where the level has the block. A description keeps tables in its schema (spec 4.16), so a table that comes from a
 * template or is pasted stays a table; it is just not offered in the narrow item panel's menu.
 */

export type EditorPreset = 'comment' | 'description' | 'page';

export interface PresetFeatures {
  headings: boolean;
  taskList: boolean;
  table: boolean;
  /** Offered in the `/` menu. */
  slashTable: boolean;
  horizontalRule: boolean;
}

export const PRESETS: Record<EditorPreset, PresetFeatures> = {
  comment: { headings: false, taskList: false, table: false, slashTable: false, horizontalRule: false },
  description: { headings: true, taskList: true, table: true, slashTable: false, horizontalRule: false },
  page: { headings: true, taskList: true, table: true, slashTable: true, horizontalRule: true },
};

/** The accessible name of an editor of a level, unless the caller names it. */
export const PRESET_LABEL: Record<EditorPreset, string> = {
  comment: 'Kommentar',
  description: 'Beschreibung',
  page: 'Inhalt der Seite',
};

/** What an empty editor shows; it also says how to reach the menus. */
export const PRESET_PLACEHOLDER: Record<EditorPreset, string> = {
  comment: 'Kommentar schreiben … @ erwähnt, # verweist, / fügt ein',
  description: 'Beschreibung schreiben … / für Überschrift, Liste, Bild',
  page: 'Schreiben … / für Blöcke, @ für Personen, # für Items',
};

/** Image formats that show inline (spec 4.16); anything else, SVG too, is a file to download. */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
