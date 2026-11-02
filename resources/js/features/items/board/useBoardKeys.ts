/*
 * The keys of the board (catalog, scope `list`): ←/→ take the cursor to the neighbouring column (`board.column_*`),
 * ⇧←/⇧→ move the cursor's card to the nearest allowed column, ⌥↑/⌥↓ change its place in a column sorted by rank
 * (`list.move_*`, K20: the timeline binds the same entries with its own meaning). j/k and ↓/↑ come from `useSelection`
 * with the board's own step (they stay within a column).
 *
 * The four moves are also commands of the palette (WCAG 2.5.7: a way without dragging that a pointer reaches), listed
 * while the cursor's card can go that way. The arrows act only while the focus is on the board or nowhere in
 * particular, so menus and fields keep their own.
 */

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { useCommand } from '@/lib/commands';
import { t, type TranslationKey } from '@/lib/i18n';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts/catalog';
import { useShortcut } from '@/lib/shortcuts/useShortcut';

export interface BoardKeyActions {
  /** The focus is on the board or nowhere in particular. */
  inBoard(): boolean;
  /** ←/→: the cursor to the neighbouring column with cards. */
  column(step: 1 | -1): void;
  /** ⇧←/⇧→: the cursor's card to the nearest allowed column (a refusal says why). */
  move(step: 1 | -1): void;
  /** ⌥↑/⌥↓: the cursor's card one place up or down in its column. */
  reorder(step: 1 | -1): void;
  /** Whether the cursor's card can go there; the palette lists only what can. */
  canMove(step: 1 | -1): boolean;
  canReorder(step: 1 | -1): boolean;
}

const MOVES: readonly { id: ShortcutId; label: TranslationKey; icon: LucideIcon; kind: 'move' | 'reorder'; step: 1 | -1 }[] = [
  { id: 'list.move_left', label: 'items.board.command.move_left', icon: ArrowLeft, kind: 'move', step: -1 },
  { id: 'list.move_right', label: 'items.board.command.move_right', icon: ArrowRight, kind: 'move', step: 1 },
  { id: 'list.move_up', label: 'items.board.command.move_up', icon: ArrowUp, kind: 'reorder', step: -1 },
  { id: 'list.move_down', label: 'items.board.command.move_down', icon: ArrowDown, kind: 'reorder', step: 1 },
];

function useMove(entry: (typeof MOVES)[number], actions: BoardKeyActions) {
  const run = () => (entry.kind === 'move' ? actions.move(entry.step) : actions.reorder(entry.step));
  useShortcut(entry.id, run, { when: actions.inBoard });
  useCommand({
    id: `board.${entry.id}`,
    label: t(entry.label),
    group: t('items.board.command.group'),
    keys: SHORTCUTS[entry.id].keys,
    icon: createElement(entry.icon),
    keywords: [t('items.board.command.keywords')],
    when: () => (entry.kind === 'move' ? actions.canMove(entry.step) : actions.canReorder(entry.step)),
    run,
  });
}

export function useBoardKeys(actions: BoardKeyActions): void {
  useShortcut('board.column_prev', () => actions.column(-1), { when: actions.inBoard });
  useShortcut('board.column_next', () => actions.column(1), { when: actions.inBoard });
  useMove(MOVES[0]!, actions);
  useMove(MOVES[1]!, actions);
  useMove(MOVES[2]!, actions);
  useMove(MOVES[3]!, actions);
}
