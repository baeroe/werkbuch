/*
 * The one static source of every keyboard shortcut: the help overlay lists it, `useShortcut` binds its entries at
 * runtime, and the shortcut reference of the docs is generated from it. A phase that adds a shortcut adds it here, under
 * the id the clickdummy used (`detail.title.${surface}` becomes `detail.title` with an `instance`).
 *
 * Keys follow the notation of `registry.ts`. Labels and groups are translation keys.
 */

import type { TranslationKey } from '@/lib/i18n';
import type { ShortcutScope } from './registry';

export interface CatalogEntry {
  keys: string;
  scope: ShortcutScope;
  label: TranslationKey;
  group: TranslationKey;
  /** Runs again while the key is held, e.g. j/k through a list. Off by default. */
  repeat?: boolean;
}

export const SHORTCUTS = {
  'shell.help': { keys: '?', scope: 'global', label: 'shortcuts.shell.help', group: 'shortcuts.group.general' },
  'shell.palette': { keys: 'mod+k', scope: 'global', label: 'shortcuts.shell.palette', group: 'shortcuts.group.general' },
  'shell.undo': { keys: 'mod+z', scope: 'global', label: 'shortcuts.shell.undo', group: 'shortcuts.group.general' },
  'shell.go.inbox': { keys: 'g i', scope: 'global', label: 'shortcuts.shell.go.inbox', group: 'shortcuts.group.navigation' },
  'shell.go.my_items': { keys: 'g m', scope: 'global', label: 'shortcuts.shell.go.my_items', group: 'shortcuts.group.navigation' },
  'shell.go.views': { keys: 'g v', scope: 'global', label: 'shortcuts.shell.go.views', group: 'shortcuts.group.navigation' },
  'shell.go.projects': { keys: 'g p', scope: 'global', label: 'shortcuts.shell.go.projects', group: 'shortcuts.group.navigation' },
  'dialog.submit': { keys: 'mod+enter', scope: 'dialog', label: 'shortcuts.dialog.submit', group: 'shortcuts.group.dialog' },
  'settings.save': { keys: 'mod+enter', scope: 'detail', label: 'shortcuts.settings.save', group: 'shortcuts.group.settings' },
  'item.create': { keys: 'c', scope: 'global', label: 'shortcuts.item.create', group: 'shortcuts.group.item' },
  // the field editors name these keys in their tooltips; the item commands (`components/fields/commands`) bind them
  'item.state': { keys: 's', scope: 'detail', label: 'shortcuts.item.state', group: 'shortcuts.group.item' },
  'item.assignee': { keys: 'a', scope: 'detail', label: 'shortcuts.item.assignee', group: 'shortcuts.group.item' },
  'item.assign_me': { keys: 'i', scope: 'detail', label: 'shortcuts.item.assign_me', group: 'shortcuts.group.item' },
  'item.priority': { keys: 'p', scope: 'detail', label: 'shortcuts.item.priority', group: 'shortcuts.group.item' },
  'item.labels': { keys: 'l', scope: 'detail', label: 'shortcuts.item.labels', group: 'shortcuts.group.item' },
  'item.type': { keys: 't', scope: 'detail', label: 'shortcuts.item.type', group: 'shortcuts.group.item' },
  'item.due': { keys: 'd', scope: 'detail', label: 'shortcuts.item.due', group: 'shortcuts.group.item' },
  'item.start': { keys: 'shift+d', scope: 'detail', label: 'shortcuts.item.start', group: 'shortcuts.group.item' },
  'item.parent': { keys: 'shift+p', scope: 'detail', label: 'shortcuts.item.parent', group: 'shortcuts.group.item' },
  // the item page binds these two (title, relations)
  'item.relation': { keys: 'r', scope: 'detail', label: 'shortcuts.item.relation', group: 'shortcuts.group.item' },
  'item.title': { keys: 'e', scope: 'detail', label: 'shortcuts.item.title', group: 'shortcuts.group.item' },
  'item.remove': { keys: 'mod+backspace', scope: 'detail', label: 'shortcuts.item.remove', group: 'shortcuts.group.item' },
  // the cursor and the selection of an item layout (`features/items/selection/useSelection.ts`); the table leaves out the
  // arrows, they belong to its grid (K19)
  'list.next': { keys: 'j', scope: 'list', label: 'shortcuts.list.next', group: 'shortcuts.group.list', repeat: true },
  'list.next_arrow': { keys: 'down', scope: 'list', label: 'shortcuts.list.next', group: 'shortcuts.group.list', repeat: true },
  'list.prev': { keys: 'k', scope: 'list', label: 'shortcuts.list.prev', group: 'shortcuts.group.list', repeat: true },
  'list.prev_arrow': { keys: 'up', scope: 'list', label: 'shortcuts.list.prev', group: 'shortcuts.group.list', repeat: true },
  'list.extend_next': { keys: 'shift+j', scope: 'list', label: 'shortcuts.list.extend_next', group: 'shortcuts.group.list', repeat: true },
  'list.extend_next_arrow': { keys: 'shift+down', scope: 'list', label: 'shortcuts.list.extend_next', group: 'shortcuts.group.list', repeat: true },
  'list.extend_prev': { keys: 'shift+k', scope: 'list', label: 'shortcuts.list.extend_prev', group: 'shortcuts.group.list', repeat: true },
  'list.extend_prev_arrow': { keys: 'shift+up', scope: 'list', label: 'shortcuts.list.extend_prev', group: 'shortcuts.group.list', repeat: true },
  'list.select': { keys: 'x', scope: 'list', label: 'shortcuts.list.select', group: 'shortcuts.group.list' },
  'list.select_range': { keys: 'shift+x', scope: 'list', label: 'shortcuts.list.select_range', group: 'shortcuts.group.list' },
  'list.select_all': { keys: 'mod+a', scope: 'list', label: 'shortcuts.list.select_all', group: 'shortcuts.group.list' },
  'list.clear': { keys: 'escape', scope: 'list', label: 'shortcuts.list.clear', group: 'shortcuts.group.list' },
  'list.open': { keys: 'enter', scope: 'list', label: 'shortcuts.list.open', group: 'shortcuts.group.list' },
  'list.peek': { keys: 'space', scope: 'list', label: 'shortcuts.list.peek', group: 'shortcuts.group.list' },
  // the layout of an item list (`features/items/ListHeader.tsx`), as the switch in its header offers them
  'list.layout.list': { keys: '1', scope: 'list', label: 'shortcuts.list.layout.list', group: 'shortcuts.group.view' },
  'list.layout.board': { keys: '2', scope: 'list', label: 'shortcuts.list.layout.board', group: 'shortcuts.group.view' },
  'list.layout.table': { keys: '3', scope: 'list', label: 'shortcuts.list.layout.table', group: 'shortcuts.group.view' },
  'list.layout.timeline': { keys: '4', scope: 'list', label: 'shortcuts.list.layout.timeline', group: 'shortcuts.group.view' },
  // registered only while the preview is open (shell/PeekHost): the first Escape in a field leaves the field
  'peek.close': { keys: 'escape', scope: 'detail', label: 'shortcuts.peek.close', group: 'shortcuts.group.item' },
} as const satisfies Record<string, CatalogEntry>;

export type ShortcutId = keyof typeof SHORTCUTS;
