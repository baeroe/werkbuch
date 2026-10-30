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
  'shell.undo': { keys: 'mod+z', scope: 'global', label: 'shortcuts.shell.undo', group: 'shortcuts.group.general' },
  'shell.go.inbox': { keys: 'g i', scope: 'global', label: 'shortcuts.shell.go.inbox', group: 'shortcuts.group.navigation' },
  'shell.go.my_items': { keys: 'g m', scope: 'global', label: 'shortcuts.shell.go.my_items', group: 'shortcuts.group.navigation' },
  'shell.go.views': { keys: 'g v', scope: 'global', label: 'shortcuts.shell.go.views', group: 'shortcuts.group.navigation' },
  'shell.go.projects': { keys: 'g p', scope: 'global', label: 'shortcuts.shell.go.projects', group: 'shortcuts.group.navigation' },
} as const satisfies Record<string, CatalogEntry>;

export type ShortcutId = keyof typeof SHORTCUTS;
