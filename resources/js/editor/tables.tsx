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
 * switches here follow its rule: the header row is every cell of the first row, the header column the first cell of
 * every row below it, and the corner is a header cell when either is on.
 *
 * The commands themselves come with the table chunk (`@tiptap/extension-table`); this file imports its types only, so
 * nothing of the chunk lands in the editor's main chunk.
 */

import type {} from '@tiptap/extension-table';
import type { Node as PmNode } from '@tiptap/pm/model';
import { useEditorState, type ChainedCommands, type CommandProps, type Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, Rows3, Table, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Menu, MenuCheckboxItem, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { t, type TranslationKey } from '@/lib/i18n';

/** The key that opens the menu from the text (widgets.ts). */
export const TABLE_MENU_KEYS = 'alt+F10';

/** The table around the selection, as the menu reads it. */
export interface TableState {
  /** Where the table starts. */
  pos: number;
  headerRow: boolean;
  headerColumn: boolean;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
}

/** The innermost table around the selection, with its position. */
function tableAt(editor: Editor): { node: PmNode; pos: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return { node, pos: $from.before(depth) };
  }
  return null;
}

const isHeader = (cell: PmNode | null | undefined) => cell?.type.name === 'tableHeader';

/** The header row and the header column of a table, by the rule of `App\RichText\TableLayout::of`. */
export function layoutOf(table: PmNode): { headerRow: boolean; headerColumn: boolean } {
  const rows: PmNode[] = [];
  table.forEach((row) => rows.push(row));
  const first = rows[0];
  const below = rows.slice(1);
  return {
    headerRow: first !== undefined && first.childCount > 0 && Array.from({ length: first.childCount }, (_, index) => first.child(index)).every(isHeader),
    headerColumn: below.length > 0 && below.every((row) => isHeader(row.firstChild)),
  };
}

/** The table the selection is in, or null outside a table (and in an editor nobody may change). */
export function tableStateOf(editor: Editor): TableState | null {
  if (!editor.isEditable) return null;
  const table = tableAt(editor);
  if (!table) return null;
  return { pos: table.pos, ...layoutOf(table.node), canDeleteRow: wouldRun(editor, 'deleteRow'), canDeleteColumn: wouldRun(editor, 'deleteColumn') };
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
 * Sets the header row and the header column of the table around the selection: the cells of the first row and the
 * first cell of every row become header cells or plain ones, `(first row and row) or (first cell and column)`, as
 * TableLayout lays a table out. Other cells stay as they are.
 */
function setLayout(chain: ChainedCommands, headerRow: boolean, headerColumn: boolean): ChainedCommands {
  return chain.command(({ tr, editor }) => {
    const table = tableAt(editor);
    const { tableHeader, tableCell } = editor.schema.nodes;
    table?.node.forEach((row, rowOffset, rowIndex) => {
      row.forEach((cell, cellOffset, cellIndex) => {
        if (rowIndex > 0 && cellIndex > 0) return;
        const type = (rowIndex === 0 && headerRow) || (cellIndex === 0 && headerColumn) ? tableHeader : tableCell;
        // the same size: positions of the cells after it stay
        if (cell.type !== type) tr.setNodeMarkup(table.pos + 1 + rowOffset + 1 + cellOffset, type, cell.attrs);
      });
    });
    // outside a table (the selection moved meanwhile) the command does nothing
    return table !== null;
  });
}

interface TableCommand {
  id: string;
  label: TranslationKey;
  icon: LucideIcon;
  run: (chain: ChainedCommands) => ChainedCommands;
  /** Why it cannot run in this table; null when it can. */
  refused?: (state: TableState) => TranslationKey | null;
  danger?: boolean;
}

const ROWS: TableCommand[] = [
  { id: 'row_before', label: 'editor.table.row_before', icon: ArrowUpToLine, run: (chain) => chain.addRowBefore() },
  { id: 'row_after', label: 'editor.table.row_after', icon: ArrowDownToLine, run: (chain) => chain.addRowAfter() },
  {
    id: 'delete_row',
    label: 'editor.table.delete_row',
    icon: Rows3,
    run: (chain) => chain.deleteRow(),
    refused: (state) => (state.canDeleteRow ? null : 'editor.table.last_row'),
  },
];

const COLUMNS: TableCommand[] = [
  { id: 'column_before', label: 'editor.table.column_before', icon: ArrowLeftToLine, run: (chain) => chain.addColumnBefore() },
  { id: 'column_after', label: 'editor.table.column_after', icon: ArrowRightToLine, run: (chain) => chain.addColumnAfter() },
  {
    id: 'delete_column',
    label: 'editor.table.delete_column',
    icon: Columns3,
    run: (chain) => chain.deleteColumn(),
    refused: (state) => (state.canDeleteColumn ? null : 'editor.table.last_column'),
  },
];

const DELETE_TABLE: TableCommand = { id: 'delete_table', label: 'editor.table.delete_table', icon: Trash2, run: (chain) => chain.deleteTable(), danger: true };

/** Runs a command on the table around the selection and gives the focus back to the text. */
function runOn(editor: Editor, run: (chain: ChainedCommands) => ChainedCommands) {
  run(editor.chain().focus()).run();
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
 * last row, the last column). The two switches read as what they do now ("Kopfzeile ausschalten").
 */
export function tableSlashCommands(editor: Editor): TableSlashCommand[] {
  const state = tableStateOf(editor);
  if (!state) return [];
  const plain = (command: TableCommand): TableSlashCommand => ({
    id: `table_${command.id}`,
    label: () => t(command.label),
    icon: command.icon,
    run: (current) => runOn(current, command.run),
  });
  const offered = (commands: TableCommand[]) => commands.filter((command) => !command.refused?.(state)).map(plain);
  return [
    ...offered(ROWS),
    ...offered(COLUMNS),
    {
      id: 'table_header_row',
      label: () => t(state.headerRow ? 'editor.table.header_row_off' : 'editor.table.header_row_on'),
      icon: Table,
      run: (current) => runOn(current, (chain) => setLayout(chain, !state.headerRow, state.headerColumn)),
    },
    {
      id: 'table_header_column',
      label: () => t(state.headerColumn ? 'editor.table.header_column_off' : 'editor.table.header_column_on'),
      icon: Table,
      run: (current) => runOn(current, (chain) => setLayout(chain, state.headerRow, !state.headerColumn)),
    },
    plain(DELETE_TABLE),
  ];
}

/** Whether a key is the one that opens the menu: Alt+F10 alone. */
const opensMenu = (event: KeyboardEvent) => event.key === 'F10' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey;

/** An entry of the menu; one that cannot run is disabled and says why in a second line. */
function CommandItem({ editor, state, command }: { editor: Editor; state: TableState; command: TableCommand }) {
  const reason = command.refused?.(state) ?? null;
  return (
    <MenuItem icon={command.icon} danger={command.danger} disabled={reason !== null} onClick={() => runOn(editor, command.run)}>
      {reason === null ? (
        t(command.label)
      ) : (
        <>
          <span className="block truncate">{t(command.label)}</span>
          <span className="block text-sm whitespace-normal text-muted">{t(reason)}</span>
        </>
      )}
    </MenuItem>
  );
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
  const pos = state?.pos ?? null;

  // the tab sits on the top edge of the table, at its right end; measured anew with every change and every resize
  useLayoutEffect(() => {
    if (pos === null) return;
    const measure = () => {
      const table = editor.view.nodeDOM(pos);
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
    return () => window.removeEventListener('resize', measure);
  });

  // Alt+F10 in the text opens the menu while the cursor is in a table; elsewhere the key goes on
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    const listen = (event: KeyboardEvent) => {
      const button = trigger.current;
      if (!opensMenu(event) || tableStateOf(editor) === null || !button) return;
      event.preventDefault();
      event.stopPropagation();
      // opened from the keyboard, as Base UI does it: the first entry is active
      button.focus();
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
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

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        ref={trigger}
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
          <MenuGroup>
            {ROWS.map((command) => (
              <CommandItem key={command.id} editor={editor} state={state} command={command} />
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            {COLUMNS.map((command) => (
              <CommandItem key={command.id} editor={editor} state={state} command={command} />
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuCheckboxItem checked={state.headerRow} closeOnClick onCheckedChange={(on) => runOn(editor, (chain) => setLayout(chain, on, state.headerColumn))}>
              {t('editor.table.header_row')}
            </MenuCheckboxItem>
            <MenuCheckboxItem checked={state.headerColumn} closeOnClick onCheckedChange={(on) => runOn(editor, (chain) => setLayout(chain, state.headerRow, on))}>
              {t('editor.table.header_column')}
            </MenuCheckboxItem>
          </MenuGroup>
          <MenuSeparator />
          <CommandItem editor={editor} state={state} command={DELETE_TABLE} />
        </MenuContent>
      )}
    </Menu>
  );
}
