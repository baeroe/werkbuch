import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { createRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RichText } from '@/types';
import { preloadEditor, RichTextEditor } from './RichTextEditor';
import { RichTextView } from './RichTextView';

// jsdom has no layout: ProseMirror measures the selection to scroll it into view (as in editor.test.tsx)
beforeAll(async () => {
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

type CellType = 'tableHeader' | 'tableCell';
const cell = (type: CellType, text: string): RichText => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const row = (...cells: RichText[]): RichText => ({ type: 'tableRow', content: cells });

/** A text with a paragraph before a table of the given rows. */
const withTable = (...rows: RichText[]): RichText => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vorher' }] }, { type: 'table', content: rows }],
});

const devices = withTable(row(cell('tableHeader', 'Gerät'), cell('tableHeader', 'Stand')), row(cell('tableCell', 'Pixel 9'), cell('tableCell', 'offen')));

const lastDoc = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.lastCall?.[0] as RichText;

/** The table of a reported document. */
const tableOf = (doc: RichText) => doc.content!.find((node) => node.type === 'table')!;
/** The cell types of a table, row by row. */
const layout = (doc: RichText): CellType[][] => tableOf(doc).content!.map((tableRow) => tableRow.content!.map((tableCell) => tableCell.type as CellType));

/** Puts the cursor at the end of a text (a cell's, a paragraph's). */
function cursorAt(editor: Editor, text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos + text.length;
  });
  if (at === -1) throw new Error(`no text ${text}`);
  act(() => {
    editor.commands.setTextSelection(at);
    editor.view.focus();
  });
  return at;
}

function setup(value: RichText = devices, props: { readOnly?: boolean; preset?: 'description' | 'page' } = {}) {
  const onChange = vi.fn();
  const editorRef = createRef<Editor | null>() as { current: Editor | null };
  const utils = render(<RichTextEditor value={value} onChange={onChange} preset={props.preset ?? 'page'} readOnly={props.readOnly} editorRef={editorRef} />);
  return { ...utils, onChange, editor: () => editorRef.current!, textbox: screen.getByRole('textbox') };
}

const menuButton = () => screen.queryByRole('button', { name: 'Tabelle bearbeiten' });

/** Opens the menu with its button and waits until it has the focus (Base UI sets it a frame later). */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(menuButton()!);
  const menu = await screen.findByRole('menu');
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  return menu;
}

/** Takes an entry of the open menu and waits until it closed and the editor has the focus again. */
async function take(user: ReturnType<typeof userEvent.setup>, name: string, textbox: HTMLElement) {
  const menu = await openMenu(user);
  const entries = [...within(menu).queryAllByRole('menuitem'), ...within(menu).queryAllByRole('menuitemcheckbox')];
  await user.click(entries.find((entry) => entry.textContent?.startsWith(name))!);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(textbox));
}

describe('TableMenu', () => {
  it('shows the table menu only while the cursor is in a table', () => {
    const { editor } = setup();
    cursorAt(editor(), 'Vorher');
    expect(menuButton()).toBeNull();

    cursorAt(editor(), 'Pixel 9');
    const button = menuButton()!;
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Alt+F10');
    expect(button.textContent).toBe('Tabelle');

    cursorAt(editor(), 'Vorher');
    expect(menuButton()).toBeNull();
  });

  it('shows no menu read-only', () => {
    const { editor, unmount } = setup(devices, { readOnly: true });
    act(() => void editor().commands.setTextSelection(editor().state.doc.content.size - 4));
    expect(editor().isActive('table')).toBe(true);
    expect(menuButton()).toBeNull();
    unmount();

    render(<RichTextView value={devices} preset="page" />);
    expect(document.querySelector('table')).not.toBeNull();
    expect(menuButton()).toBeNull();
  });

  it('adds and deletes rows and columns', async () => {
    const user = userEvent.setup();
    const { editor, onChange, textbox } = setup();
    const at = cursorAt(editor(), 'Pixel 9');

    await take(user, 'Zeile darunter einfügen', textbox);
    expect(layout(lastDoc(onChange))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
      ['tableCell', 'tableCell'],
    ]);
    // the cursor stays in its cell
    expect(editor().state.selection.from).toBe(at);

    await take(user, 'Zeile darüber einfügen', textbox);
    expect(layout(lastDoc(onChange))).toHaveLength(4);

    await take(user, 'Spalte rechts einfügen', textbox);
    expect(layout(lastDoc(onChange)).map((cells) => cells.length)).toEqual([3, 3, 3, 3]);
    await take(user, 'Spalte links einfügen', textbox);
    expect(layout(lastDoc(onChange)).map((cells) => cells.length)).toEqual([4, 4, 4, 4]);

    await take(user, 'Spalte löschen', textbox);
    await take(user, 'Zeile löschen', textbox);
    const after = lastDoc(onChange);
    expect(layout(after).map((cells) => cells.length)).toEqual([3, 3, 3]);
    // the row and the column of the cursor went, the cells of "Gerät" and "Pixel 9" with them
    expect(JSON.stringify(after)).not.toContain('Pixel 9');
    expect(JSON.stringify(after)).not.toContain('Gerät');
    expect(JSON.stringify(after)).toContain('Stand');

    await take(user, 'Tabelle löschen', textbox);
    expect(lastDoc(onChange).content!.map((node) => node.type)).not.toContain('table');
    expect(menuButton()).toBeNull();
  });

  it('toggles the header row and the header column and reports them as checked', async () => {
    const user = userEvent.setup();
    const { editor, onChange, textbox } = setup();
    cursorAt(editor(), 'offen');

    let menu = await openMenu(user);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfzeile' }).getAttribute('aria-checked')).toBe('true');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfspalte' }).getAttribute('aria-checked')).toBe('false');
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfspalte' }));
    await waitFor(() => expect(document.activeElement).toBe(textbox));
    expect(layout(lastDoc(onChange))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableHeader', 'tableCell'],
    ]);

    menu = await openMenu(user);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfspalte' }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfzeile' }));
    await waitFor(() => expect(document.activeElement).toBe(textbox));
    // the corner stays a header cell: it belongs to the header column as well (as TableLayout keeps it, A455)
    expect(layout(lastDoc(onChange))).toEqual([
      ['tableHeader', 'tableCell'],
      ['tableHeader', 'tableCell'],
    ]);

    menu = await openMenu(user);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfzeile' }).getAttribute('aria-checked')).toBe('false');
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Kopfspalte' }));
    await waitFor(() => expect(document.activeElement).toBe(textbox));
    expect(layout(lastDoc(onChange))).toEqual([
      ['tableCell', 'tableCell'],
      ['tableCell', 'tableCell'],
    ]);

    await take(user, 'Kopfzeile', textbox);
    expect(layout(lastDoc(onChange))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
    ]);
  });

  it('says why the last row cannot go', async () => {
    const user = userEvent.setup();
    const { editor, unmount } = setup(withTable(row(cell('tableCell', 'eins'), cell('tableCell', 'zwei'))));
    cursorAt(editor(), 'eins');

    const menu = await openMenu(user);
    const lastRow = within(menu).getByRole('menuitem', { name: /^Zeile löschen/ });
    expect(lastRow.getAttribute('aria-disabled')).toBe('true');
    expect(lastRow.textContent).toContain('Die letzte Zeile bleibt. Lösche stattdessen die Tabelle.');
    // two columns: one of them may go
    expect(within(menu).getByRole('menuitem', { name: /^Spalte löschen/ }).getAttribute('aria-disabled')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    unmount();

    const single = setup(withTable(row(cell('tableCell', 'allein')), row(cell('tableCell', 'darunter'))));
    cursorAt(single.editor(), 'allein');
    const second = await openMenu(user);
    const lastColumn = within(second).getByRole('menuitem', { name: /^Spalte löschen/ });
    expect(lastColumn.getAttribute('aria-disabled')).toBe('true');
    expect(lastColumn.textContent).toContain('Die letzte Spalte bleibt. Lösche stattdessen die Tabelle.');
  });

  it('opens the menu with Alt+F10 and gives the focus back to the cell', async () => {
    const user = userEvent.setup();
    const { editor, textbox } = setup();

    // outside a table the key goes on
    cursorAt(editor(), 'Vorher');
    expect(fireEvent.keyDown(textbox, { key: 'F10', code: 'F10', altKey: true })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();

    const at = cursorAt(editor(), 'Pixel 9');
    expect(fireEvent.keyDown(textbox, { key: 'F10', code: 'F10', altKey: true })).toBe(false);
    const menu = await screen.findByRole('menu', { name: 'Tabelle bearbeiten' });
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toBe(document.activeElement));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(textbox));
    expect(editor().state.selection.from).toBe(at);

    // with another modifier it is not the menu's key
    expect(fireEvent.keyDown(textbox, { key: 'F10', code: 'F10', altKey: true, shiftKey: true })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the table commands in the slash menu inside a table only', async () => {
    const user = userEvent.setup();
    const { editor, onChange, textbox, unmount } = setup(withTable(row(cell('tableHeader', 'Kopf')), row(cell('tableCell', 'Wert'))));

    cursorAt(editor(), 'Vorher');
    await user.keyboard(' /');
    let list = await screen.findByRole('listbox', { name: 'Blöcke' });
    expect(within(list).queryByRole('group', { name: 'Tabelle' })).toBeNull();
    expect(within(list).queryByRole('option', { name: 'Zeile darunter einfügen' })).toBeNull();
    await user.keyboard('{Escape}');

    cursorAt(editor(), 'Wert');
    await user.keyboard(' /');
    list = await screen.findByRole('listbox', { name: 'Blöcke' });
    const group = within(list).getByRole('group', { name: 'Tabelle' });
    const names = within(group)
      .getAllByRole('option')
      .map((option) => option.textContent);
    // one column: it cannot go, so it is not offered; the header row is on, the header column off
    expect(names).toEqual(['Zeile darüber einfügen', 'Zeile darunter einfügen', 'Zeile löschen', 'Spalte links einfügen', 'Spalte rechts einfügen', 'Kopfzeile ausschalten', 'Kopfspalte einschalten', 'Tabelle löschen']);

    // one word: a blank ends the list
    await user.keyboard('darunter');
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Blöcke' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Zeile darunter einfügen']));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(layout(lastDoc(onChange))).toEqual([['tableHeader'], ['tableCell'], ['tableCell']]);
    // the slash and the query went, the cell keeps its text
    expect(JSON.stringify(lastDoc(onChange))).toContain('"Wert "');
    expect(document.activeElement).toBe(textbox);

    unmount();

    // the two switches read as what they do now (two columns: in one, the corner would be the whole header row)
    const wide = setup(withTable(row(cell('tableHeader', 'Gerät'), cell('tableHeader', 'Stand')), row(cell('tableCell', 'Pixel'), cell('tableCell', 'offen'))));
    cursorAt(wide.editor(), 'offen');
    const pick = async (query: string, name: string) => {
      await user.keyboard(` /${query}`);
      const options = within(await screen.findByRole('listbox', { name: 'Blöcke' })).getAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual([name]);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      return layout(lastDoc(wide.onChange));
    };
    expect(await pick('kopfspalte', 'Kopfspalte einschalten')).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableHeader', 'tableCell'],
    ]);
    // the corner stays a header cell for the header column
    expect(await pick('kopfzeile', 'Kopfzeile ausschalten')).toEqual([
      ['tableHeader', 'tableCell'],
      ['tableHeader', 'tableCell'],
    ]);
    expect(await pick('kopfspalte', 'Kopfspalte ausschalten')).toEqual([
      ['tableCell', 'tableCell'],
      ['tableCell', 'tableCell'],
    ]);
    expect(await pick('kopfzeile', 'Kopfzeile einschalten')).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
    ]);
  });
});
