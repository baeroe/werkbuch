/*
 * The keys that belong to a widget, not to the catalog: the command palette, the grid of the table, the group headers and
 * the editor (with its `/`, `@` and `#` lists) handle them themselves while they have focus. The shortcut reference lists them next to the catalog.
 * Type imports only, so `scripts/shortcuts-doc.mjs` can load this file with Node.
 */

import type { TranslationKey } from '@/lib/i18n';

export interface WidgetKey {
  keys: string;
  label: TranslationKey;
}

export interface WidgetGroup {
  group: TranslationKey;
  entries: WidgetKey[];
}

export const WIDGET_KEYS: WidgetGroup[] = [
  {
    group: 'shortcuts.widget.group.palette',
    entries: [
      { keys: 'up', label: 'shortcuts.widget.palette.move' },
      { keys: 'down', label: 'shortcuts.widget.palette.move' },
      { keys: 'enter', label: 'shortcuts.widget.palette.run' },
      { keys: 'backspace', label: 'shortcuts.widget.palette.back' },
      { keys: 'escape', label: 'shortcuts.widget.palette.close' },
    ],
  },
  {
    group: 'shortcuts.widget.group.table',
    entries: [
      { keys: 'left', label: 'shortcuts.widget.table.column' },
      { keys: 'right', label: 'shortcuts.widget.table.column' },
      { keys: 'up', label: 'shortcuts.widget.table.row' },
      { keys: 'down', label: 'shortcuts.widget.table.row' },
      { keys: 'shift+up', label: 'shortcuts.widget.table.extend' },
      { keys: 'shift+down', label: 'shortcuts.widget.table.extend' },
      { keys: 'home', label: 'shortcuts.widget.table.edge_column' },
      { keys: 'end', label: 'shortcuts.widget.table.edge_column' },
      { keys: 'mod+home', label: 'shortcuts.widget.table.edge_row' },
      { keys: 'mod+end', label: 'shortcuts.widget.table.edge_row' },
      { keys: 'enter', label: 'shortcuts.widget.table.edit' },
      { keys: 'escape', label: 'shortcuts.widget.table.stop' },
    ],
  },
  {
    group: 'shortcuts.widget.group.groups',
    entries: [
      { keys: 'left', label: 'shortcuts.widget.groups.collapse' },
      { keys: 'right', label: 'shortcuts.widget.groups.expand' },
      { keys: 'up', label: 'shortcuts.widget.groups.header' },
      { keys: 'down', label: 'shortcuts.widget.groups.header' },
      { keys: 'enter', label: 'shortcuts.widget.groups.toggle' },
      { keys: 'space', label: 'shortcuts.widget.groups.toggle' },
    ],
  },
  {
    group: 'shortcuts.widget.group.editor',
    entries: [
      { keys: 'mod+enter', label: 'shortcuts.widget.editor.submit' },
      { keys: 'escape', label: 'shortcuts.widget.editor.leave' },
      { keys: '/', label: 'shortcuts.widget.editor.slash' },
      { keys: '@', label: 'shortcuts.widget.editor.mention' },
      { keys: '#', label: 'shortcuts.widget.editor.reference' },
      { keys: 'up', label: 'shortcuts.widget.editor.list_move' },
      { keys: 'down', label: 'shortcuts.widget.editor.list_move' },
      { keys: 'enter', label: 'shortcuts.widget.editor.list_take' },
      { keys: 'tab', label: 'shortcuts.widget.editor.list_take' },
      { keys: 'escape', label: 'shortcuts.widget.editor.list_close' },
      { keys: 'enter', label: 'shortcuts.widget.editor.image_alt' },
    ],
  },
];
