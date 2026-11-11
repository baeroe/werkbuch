/*
 * Editing a table's structure (A454): rows and columns in and out, the header row and the header column on and off.
 * Two ways in, both from the cell the cursor stands in:
 * - `TableMenu`: a tab on the table's top edge, a Base UI menu (no bubble menu: that needs packages of its own). It is
 *   there while the editor is editable and the selection is in a table; `Alt+F10` opens it from the text (the usual key
 *   for an editor's toolbar, ARIA APG), Escape closes it and gives the focus back to the text at the same place.
 * - The `/` menu (slashMenu.tsx): the same commands in a group "Tabelle" while the cursor is in a table, without the
 *   ones that cannot run (`tableSlashCommands`).
 * Not offered: merging and splitting cells and single header cells. Markdown carries neither spans nor single header
 * cells; the server keeps only the header row and the header column (`App\RichText\TableLayout`, A455), and the
 * commands here follow its rule: the header row is every cell of the first row, the header column the first cell of
 * every row below it, and the corner is a header cell when either is on. Switching one and inserting a row or a
 * column lay every cell of the table out by it (`layCells`), so no header cell strays into the table.
 *
 * The commands themselves come with the table chunk (`@tiptap/extension-table`); this file imports its types only, so
 * nothing of the chunk lands in the editor's main chunk.
 */

import type {} from '@tiptap/extension-table';
import type { Node as PmNode, ResolvedPos, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { useEditorState, type ChainedCommands, type CommandProps, type Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, Rows3, Table, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Menu, MenuCheckboxItem, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { t, type TranslationKey } from '@/lib/i18n';
import { announce } from './announcer';

/** The key that opens the menu from the text (widgets.ts). */
export const TABLE_MENU_KEYS = 'alt+F10';

/** The table around the selection, as the menu reads it. */
export interface TableState {
  /** Where the table starts. */
  pos: number;
  headerRow: boolean;
  headerColumn: boolean;
  /** A table of one row has no header column (`layoutOf`): the switch is refused there. */
  oneRow: boolean;
}

/** The header row and the header column of a table. */
interface Layout {
  headerRow: boolean;
  headerColumn: boolean;
}

/** The innermost table around a position, with its position. */
function tableAround($from: ResolvedPos): { node: PmNode; pos: number } | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return { node, pos: $from.before(depth) };
  }
  return null;
}

const isHeader = (cell: PmNode | null | undefined) => cell?.type.name === 'tableHeader';

/** The header row and the header column of a table, by the rule of `App\RichText\TableLayout::of`. */
export function layoutOf(table: PmNode): Layout {
  const rows: PmNode[] = [];
  table.forEach((row) => rows.push(row));
  const first = rows[0];
  const below = rows.slice(1);
  return {
    headerRow: first !== undefined && first.childCount > 0 && Array.from({ length: first.childCount }, (_, index) => first.child(index)).every(isHeader),
    headerColumn: below.length > 0 && below.every((row) => isHeader(row.firstChild)),
  };
}

/**
 * The table the selection is in, or null outside a table (and in an editor nobody may change). Runs with every
 * transaction in a table (every key in a cell): it only reads the table, the dry runs of `refused` wait for the menu.
 */
export function tableStateOf(editor: Editor): TableState | null {
  if (!editor.isEditable) return null;
  const table = tableAround(editor.state.selection.$from);
  if (!table) return null;
  return { pos: table.pos, ...layoutOf(table.node), oneRow: table.node.childCount === 1 };
}

/**
 * Whether a command of the table would change the text: run against the current state with a dispatch that keeps
 * nothing. `editor.can()` is no help here: prosemirror-tables refuses the last row or column only while dispatching.
 */
function wouldRun(editor: Editor, name: 'deleteRow' | 'deleteColumn'): boolean {
  let changes = false;
  editor.extensionManager.commands[name]()({ state: editor.state, dispatch: () => (changes = true) } as unknown as CommandProps);
  return changes;
}

/**
 * Lays out the table around the transaction's selection as TableLayout does: a cell is a header cell when it stands in
 * the first row and the header row is on, or first in its row and the header column is on; every other cell is a plain
 * one. Reads the table from `tr.doc`, so it sees what the commands before it in the same chain did.
 */
function layCells(tr: Transaction, schema: Schema, layout: Layout): boolean {
  const table = tableAround(tr.selection.$from);
  if (!table) return false;
  const { tableHeader, tableCell } = schema.nodes;
  table.node.forEach((row, rowOffset, rowIndex) => {
    row.forEach((cell, cellOffset, cellIndex) => {
      const type = (rowIndex === 0 && layout.headerRow) || (cellIndex === 0 && layout.headerColumn) ? tableHeader : tableCell;
      // the same size: positions of the cells after it stay
      if (cell.type !== type) tr.setNodeMarkup(table.pos + 1 + rowOffset + 1 + cellOffset, type, cell.attrs);
    });
  });
  return true;
}

/** Sets the header row and the header column of the table around the selection (`layCells`). */
function setLayout(chain: ChainedCommands, layout: Layout): ChainedCommands {
  return chain.command(({ tr, editor }) => layCells(tr, editor.schema, layout));
}

/**
 * A row or a column in, with the header row and the header column where they were. prosemirror-tables makes a row
 * above the header row (a column left of the header column) a plain one and leaves the old header cells inside the
 * table: cells the menu could neither show nor take back, and Markdown cannot carry. So the same chain reads the
 * layout before and lays the cells out again after.
 */
function keepingLayout(insert: (chain: ChainedCommands) => ChainedCommands) {
  return (chain: ChainedCommands) => {
    let before: Layout | null = null;
    const read = chain.command(({ tr }) => {
      const table = tableAround(tr.selection.$from);
      before = table && layoutOf(table.node);
      return table !== null;
    });
    return insert(read).command(({ tr, editor }) => before !== null && layCells(tr, editor.schema, before));
  };
}

interface TableCommand {
  id: string;
  label: TranslationKey;
  /** What the editor's live region says after it ran. */
  done: TranslationKey;
  icon: LucideIcon;
  run: (chain: ChainedCommands) => ChainedCommands;
  /** Why it cannot run in this table; null when it can. Asked when the menu opens, not with every key. */
  refused?: (editor: Editor) => TranslationKey | null;
  danger?: boolean;
}

const ROWS: TableCommand[] = [
  { id: 'row_before', label: 'editor.table.row_before', done: 'editor.table.done.row_added', icon: ArrowUpToLine, run: keepingLayout((chain) => chain.addRowBefore()) },
  { id: 'row_after', label: 'editor.table.row_after', done: 'editor.table.done.row_added', icon: ArrowDownToLine, run: keepingLayout((chain) => chain.addRowAfter()) },
  {
    id: 'delete_row',
    label: 'editor.table.delete_row',
    done: 'editor.table.done.row_deleted',
    icon: Rows3,
    run: (chain) => chain.deleteRow(),
    refused: (editor) => (wouldRun(editor, 'deleteRow') ? null : 'editor.table.last_row'),
  },
];

const COLUMNS: TableCommand[] = [
  {
    id: 'column_before',
    label: 'editor.table.column_before',
    done: 'editor.table.done.column_added',
    icon: ArrowLeftToLine,
    run: keepingLayout((chain) => chain.addColumnBefore()),
  },
  {
    id: 'column_after',
    label: 'editor.table.column_after',
    done: 'editor.table.done.column_added',
    icon: ArrowRightToLine,
    run: keepingLayout((chain) => chain.addColumnAfter()),
  },
  {
    id: 'delete_column',
    label: 'editor.table.delete_column',
    done: 'editor.table.done.column_deleted',
    icon: Columns3,
    run: (chain) => chain.deleteColumn(),
    refused: (editor) => (wouldRun(editor, 'deleteColumn') ? null : 'editor.table.last_column'),
  },
];

const DELETE_TABLE: TableCommand = {
  id: 'delete_table',
  label: 'editor.table.delete_table',
  done: 'editor.table.done.table_deleted',
  icon: Trash2,
  run: (chain) => chain.deleteTable(),
  danger: true,
};

/** Why the header column cannot be switched on: a table of one row has none (`layoutOf`, as the server reads it). */
const headerColumnRefused = (state: TableState): TranslationKey | null => (state.oneRow ? 'editor.table.one_row' : null);

/** The two switches as commands: what they set, what the live region says then. */
const headerRow = (state: TableState, on: boolean) => ({
  run: (chain: ChainedCommands) => setLayout(chain, { headerRow: on, headerColumn: state.headerColumn }),
  done: on ? 'editor.table.done.header_row_on' : 'editor.table.done.header_row_off',
}) satisfies Pick<TableCommand, 'run' | 'done'>;
const headerColumn = (state: TableState, on: boolean) => ({
  run: (chain: ChainedCommands) => setLayout(chain, { headerRow: state.headerRow, headerColumn: on }),
  done: on ? 'editor.table.done.header_column_on' : 'editor.table.done.header_column_off',
}) satisfies Pick<TableCommand, 'run' | 'done'>;

/** Runs a command on the table around the selection, gives the focus back to the text and says what it did. */
function runOn(editor: Editor, { run, done }: Pick<TableCommand, 'run' | 'done'>) {
  run(editor.chain().focus()).run();
  announce(editor.view.dom, t(done));
}

/** A command of the `/` menu in a table. */
export interface TableSlashCommand {
  id: string;
  label: () => string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
}

/**
 * The table commands the `/` menu offers where the cursor stands: none outside a table, and none that cannot run (the
 * last row, the last column, a header column in one row). The two switches read as what they do now ("Kopfzeile
 * ausschalten").
 */
export function tableSlashCommands(editor: Editor): TableSlashCommand[] {
  const state = tableStateOf(editor);
  if (!state) return [];
  const plain = (command: TableCommand): TableSlashCommand => ({
    id: `table_${command.id}`,
    label: () => t(command.label),
    icon: command.icon,
    run: (current) => runOn(current, command),
  });
  const offered = (commands: TableCommand[]) => commands.filter((command) => !command.refused?.(editor)).map(plain);
  const switches: TableSlashCommand[] = [
    {
      id: 'table_header_row',
      label: () => t(state.headerRow ? 'editor.table.header_row_off' : 'editor.table.header_row_on'),
      icon: Table,
      run: (current) => runOn(current, headerRow(state, !state.headerRow)),
    },
  ];
  if (headerColumnRefused(state) === null) {
    switches.push({
      id: 'table_header_column',
      label: () => t(state.headerColumn ? 'editor.table.header_column_off' : 'editor.table.header_column_on'),
      icon: Table,
      run: (current) => runOn(current, headerColumn(state, !state.headerColumn)),
    });
  }
  return [...offered(ROWS), ...offered(COLUMNS), ...switches, plain(DELETE_TABLE)];
}

/** Whether a key is the one that opens the menu: Alt+F10 alone. */
const opensMenu = (event: KeyboardEvent) => event.key === 'F10' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey;

/**
 * The text of an entry; one that cannot run says why in a second line. The entry is disabled then (Base UI dims it to
 * half): the reason is read, not a control, so it keeps its full contrast (only the label and the icon are dimmed).
 */
function entryText(label: string, reason: TranslationKey | null): ReactNode {
  if (reason === null) return label;
  return (
    <>
      <span className="block truncate opacity-50">{label}</span>
      <span className="block text-sm whitespace-normal text-muted">{t(reason)}</span>
    </>
  );
}

/** Undoes Base UI's dimming of a disabled entry for its reason (`entryText` dims the rest). */
const refusedEntry = 'data-disabled:opacity-100 data-disabled:[&>svg]:opacity-50';

/** An entry of the menu; one that cannot run is disabled and says why in a second line. */
function CommandItem({ editor, command }: { editor: Editor; command: TableCommand }) {
  const reason = command.refused?.(editor) ?? null;
  return (
    <MenuItem icon={command.icon} danger={command.danger} disabled={reason !== null} className={refusedEntry} onClick={() => runOn(editor, command)}>
      {entryText(t(command.label), reason)}
    </MenuItem>
  );
}

/** Puts the focus on the first entry that can run as soon as the menu is there: opened with Alt+F10. */
function FirstEntry({ take }: { take: RefObject<boolean> }) {
  const mark = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!take.current) return;
    // a frame later, when the entries took their places in the list: Base UI highlights the entry that has the focus,
    // and its own first focus (on the popup) does not take it back once the focus is inside
    const frame = requestAnimationFrame(() => {
      take.current = false;
      mark.current?.closest('[role="menu"]')?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [take]);
  return <span ref={mark} hidden />;
}

/**
 * The table menu of an editor: a tab on the top edge of the table the selection is in (editor.css keeps room for it
 * above every table of an editable text, so it never covers text and nothing moves when it comes), right-aligned.
 * `frame` is the editor's element, the tab is placed in it.
 */
export function TableMenu({ editor, frame }: { editor: Editor; frame: RefObject<HTMLElement | null> }) {
  const state = useEditorState({ editor, selector: ({ editor: current }) => (current.isDestroyed ? null : tableStateOf(current)) });
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  // opened with Alt+F10: the first entry takes the focus (FirstEntry)
  const fromKey = useRef(false);
  const pos = state?.pos ?? null;

  // the tab sits on the top edge of the table, at its right end: measured anew with every change, and when the table or
  // the frame changes its box without one (an image above loads, the window or a side panel changes the width)
  useLayoutEffect(() => {
    if (pos === null) return;
    const table = editor.view.nodeDOM(pos);
    const measure = () => {
      const around = frame.current;
      if (table instanceof HTMLElement && around) {
        const box = table.getBoundingClientRect();
        const outer = around.getBoundingClientRect();
        // the tab is placed in the frame's padding box: without its border (clientTop, clientLeft)
        const next = { top: box.top - outer.top - around.clientTop, right: outer.right - box.right - around.clientLeft };
        setPlace((current) => (current?.top === next.top && current.right === next.right ? current : next));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const box of [table, frame.current]) if (box instanceof HTMLElement) observer?.observe(box);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  });

  // Alt+F10 in the text opens the menu while the cursor is in a table; elsewhere the key goes on. Opened as the menu's
  // own state, not over the tab: it works while the tab is still being placed (invisible) as well
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    const listen = (event: KeyboardEvent) => {
      if (!opensMenu(event) || tableStateOf(editor) === null) return;
      event.preventDefault();
      event.stopPropagation();
      fromKey.current = true;
      setOpen(true);
    };
    dom.addEventListener('keydown', listen);
    return () => dom.removeEventListener('keydown', listen);
  }, [editor]);

  if (!state && !open) return null;

  /**
   * Closing gives the focus back to the text, at the same place: after a command, on Escape, after a click on the
   * tab. Not when the focus moved on to something else (a click elsewhere took it).
   */
  const backToText = () => {
    const active = document.activeElement;
    const elsewhere = active !== null && active !== document.body && active !== trigger.current && active.closest('[role="menu"]') === null;
    if (!elsewhere && !editor.isDestroyed) editor.view.focus();
    return false;
  };
  const columnRefused = state && headerColumnRefused(state);

  return (
    <Menu open={open} onOpenChange={setOpen} triggerId={triggerId}>
      <MenuTrigger
        ref={trigger}
        id={triggerId}
        aria-label={t('editor.table.menu')}
        aria-keyshortcuts={ariaKeyshortcuts(TABLE_MENU_KEYS)}
        className={cx(
          'absolute z-10 inline-flex h-11 -translate-y-full cursor-pointer items-center gap-1.5 rounded-t-chip border border-b-0 border-line bg-raised px-2.5 text-sm font-medium text-muted',
          'transition-colors duration-120 hover:bg-hover hover:text-ink data-popup-open:text-ink md:h-6 md:px-2',
          !place && 'invisible',
        )}
        style={place ? { top: place.top, right: place.right } : undefined}
      >
        <Table className="size-3.5 shrink-0" aria-hidden="true" />
        {t('editor.table.button')}
      </MenuTrigger>
      {state && (
        <MenuContent align="end" className="w-64" finalFocus={backToText}>
          <FirstEntry take={fromKey} />
          <MenuGroup>
            {ROWS.map((command) => (
              <CommandItem key={command.id} editor={editor} command={command} />
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            {COLUMNS.map((command) => (
              <CommandItem key={command.id} editor={editor} command={command} />
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuCheckboxItem checked={state.headerRow} closeOnClick onCheckedChange={(on) => runOn(editor, headerRow(state, on))}>
              {t('editor.table.header_row')}
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={state.headerColumn}
              closeOnClick
              disabled={columnRefused !== null}
              className={refusedEntry}
              onCheckedChange={(on) => runOn(editor, headerColumn(state, on))}
            >
              {entryText(t('editor.table.header_column'), columnRefused)}
            </MenuCheckboxItem>
          </MenuGroup>
          <MenuSeparator />
          <CommandItem editor={editor} command={DELETE_TABLE} />
        </MenuContent>
      )}
    </Menu>
  );
}
