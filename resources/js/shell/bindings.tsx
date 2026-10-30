/*
 * The shell's own shortcuts (start set of spec 5.3): the shortcut help, undo and the `g` sequences to the main places.
 * Their keys, labels and groups come from the catalog (`lib/shortcuts/catalog.ts`). Screens register theirs while they
 * are mounted. Palette commands and "new item" arrive with their phases.
 */

import { router } from '@inertiajs/react';
import { paths } from '@/lib/links';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { canUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';

export function useShellBindings(): void {
  useShortcut('shell.help', () => useUiStore.getState().setHelpOpen(true));
  useShortcut('shell.undo', () => undoLatest(), { when: canUndo });
  // g i, g m, g v, g p
  useShortcut('shell.go.inbox', () => router.visit(paths.inbox()));
  useShortcut('shell.go.my_items', () => router.visit(paths.myItems()));
  useShortcut('shell.go.views', () => router.visit(paths.views()));
  useShortcut('shell.go.projects', () => router.visit(paths.projects()));
}
