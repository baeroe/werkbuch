/*
 * The keys of the table's grid (WAI-ARIA grid pattern, P26): they belong to the widget, not to the shortcut catalog,
 * and act while a cell itself has the focus, not in an open editor (whose keys bubble through the portal of its popup).
 * On a control inside a cell (where a pointer left the focus) the arrows, Home and End move from its cell as long as no
 * editor is open (T20-M9); its Enter and space stay its own. The arrows move from cell to cell: ↑/↓ through the item rows in their order, the
 * same as j/k, and with ⇧ they extend the selection as ⇧J/⇧K do (K19). Home and End go to the first and last column,
 * with ⌘/Strg to the first and last row; Enter opens the editor of the cell (the item's page on the first column).
 * Escape closes an editor, which gives the focus back to its cell (TableLayout). Tab leaves the grid: only one cell is
 * a tab stop.
 * Grouped, ← on the first column goes to the heading of the row's group, as the list does it (13c).
 */

import type { KeyboardEvent } from 'react';

/**
 * Where a cell stands: `data-cell="<row>:<column>"`, column 0 being the key and title. The row is the key of the row
 * (`rowKey`: group and item), not the item: grouped by label, an item with two labels has two rows.
 */
export function cellOf(element: EventTarget | null): { row: string; column: number } | null {
  if (!(element instanceof HTMLElement)) return null;
  const at = element.getAttribute('data-cell');
  const split = at?.lastIndexOf(':') ?? -1;
  if (!at || split < 0) return null;
  return { row: at.slice(0, split), column: Number(at.slice(split + 1)) };
}

export interface GridKeysOptions {
  /** The keys of the item rows in their order (without the ones of folded groups). */
  rows: readonly string[];
  /** The last column: the number of field columns (column 0 is the key and title). */
  lastColumn: number;
  /** The cursor moves to a cell: the table reports the item and gives the cell the focus. */
  go: (row: string, column: number) => void;
  /** ↑/↓: the cursor moves to the next or previous row, staying in its column (`useSelection().move`). */
  move: (step: 1 | -1, extend: boolean) => void;
  /** Enter on a cell. */
  enter: (row: string, column: number) => void;
  /** ← on the first column; answers whether it went somewhere (the heading of the group). */
  leftEdge?: (row: string) => boolean;
  /** An editor of a cell is open: a control of the cell keeps its keys. */
  editing: boolean;
}

/** The keys that move from cell to cell, also from a control inside one. */
const MOVES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * The keydown handlers of the grid, for its table element: `onKeyDown` for a cell that has the focus, and
 * `onKeyDownCapture` for a control inside a cell, which sees the keys first, so a picker's trigger does not open its list
 * on ↓ while the arrows move from cell to cell.
 */
export function useGridKeys({ rows, lastColumn, go, move, enter, leftEdge, editing }: GridKeysOptions) {
  /** Acts on a key at a cell; answers whether the key was the grid's. */
  function act(event: KeyboardEvent<HTMLElement>, cell: { row: string; column: number }): boolean {
    if (event.nativeEvent.isComposing || event.altKey) return false;
    const mod = event.metaKey || event.ctrlKey;
    const { row, column } = cell;
    // ⌘/Strg only with Home and End (the first and last row), ⇧ only with ↑/↓ (it extends the selection)
    const jump = event.key === 'Home' || event.key === 'End';
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if ((mod && !jump) || (event.shiftKey && !vertical)) return false;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        move(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
        break;
      case 'ArrowLeft':
        if (column > 0) go(row, column - 1);
        else if (!leftEdge?.(row)) return false;
        break;
      case 'ArrowRight':
        go(row, Math.min(lastColumn, column + 1));
        break;
      case 'Home':
        go(mod ? rows[0]! : row, mod ? column : 0);
        break;
      case 'End':
        go(mod ? rows.at(-1)! : row, mod ? column : lastColumn);
        break;
      case 'Enter':
        enter(row, column);
        break;
      default:
        return false;
    }
    // the shortcuts of the list stay out of it (the registry leaves a prevented key alone)
    event.preventDefault();
    return true;
  }

  return {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const cell = cellOf(event.target);
      if (cell) act(event, cell);
    },
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      // only a control inside a cell, while no editor is open; its Enter and space stay its own
      if (editing || !MOVES.has(event.key) || !(event.target instanceof Element) || cellOf(event.target)) return;
      const cell = cellOf(event.target.closest('[data-cell]'));
      if (cell && act(event, cell)) event.stopPropagation();
    },
  };
}
