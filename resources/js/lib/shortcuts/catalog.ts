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
} as const satisfies Record<string, CatalogEntry>;

export type ShortcutId = keyof typeof SHORTCUTS;
