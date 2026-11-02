import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { slashItemsFor } from './slashMenu';
import { SuggestionMenu, type SuggestionHandle, type SuggestionSection } from './suggestions';

/** What the list touches of the editor: its element, which names the list and the active entry. */
function fakeEditor() {
  return { view: { dom: document.createElement('div') } } as unknown as Pick<Editor, 'view'>;
}

const key = (name: string) => new KeyboardEvent('keydown', { key: name });

function entries(...names: string[]) {
  const picked: string[] = [];
  return { picked, list: names.map((name) => ({ key: name, content: <span>{name}</span>, pick: () => picked.push(name) })) };
}

describe('SuggestionMenu', () => {
  it('moves with the arrows, wraps around, and takes the active entry with Enter or Tab', () => {
    const editor = fakeEditor();
    const ref = createRef<SuggestionHandle>();
    const { picked, list } = entries('Mara', 'Ida', 'Theo');
    render(<SuggestionMenu ref={ref} editor={editor} label="Personen" sections={[{ entries: list }]} status="Niemand" />);
    const dom = editor.view.dom;
    const listbox = screen.getByRole('listbox', { name: 'Personen' });
    const active = () => screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')?.textContent;

    // the editor names the list; the first entry is active
    expect(dom.getAttribute('aria-controls')).toBe(listbox.id);
    expect(dom.getAttribute('aria-autocomplete')).toBe('list');
    expect(active()).toBe('Mara');
    expect(dom.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Mara' }).id);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => void expect(ref.current!.onKeyDown(key('ArrowDown'))).toBe(true));
    expect(active()).toBe('Ida');
    expect(dom.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Ida' }).id);
    act(() => void ref.current!.onKeyDown(key('ArrowUp')));
    act(() => void ref.current!.onKeyDown(key('ArrowUp')));
    expect(active()).toBe('Theo');
    act(() => void ref.current!.onKeyDown(key('ArrowDown')));
    expect(active()).toBe('Mara');

    expect(ref.current!.onKeyDown(key('Enter'))).toBe(true);
    act(() => void ref.current!.onKeyDown(key('ArrowDown')));
    expect(ref.current!.onKeyDown(key('Tab'))).toBe(true);
    expect(picked).toEqual(['Mara', 'Ida']);
    // every other key is the editor's
    expect(ref.current!.onKeyDown(key('a'))).toBe(false);
    expect(ref.current!.onKeyDown(key('Escape'))).toBe(false);
  });

  it('leaves Enter and Tab with Shift, Alt or mod to the editor (Shift+Enter is its line break)', () => {
    const ref = createRef<SuggestionHandle>();
    const { picked, list } = entries('Mara');
    render(<SuggestionMenu ref={ref} editor={fakeEditor()} label="Personen" sections={[{ entries: list }]} status="" />);
    for (const modifier of ['shiftKey', 'altKey', 'metaKey', 'ctrlKey']) {
      for (const name of ['Enter', 'Tab']) expect(ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: name, [modifier]: true }))).toBe(false);
    }
    expect(picked).toEqual([]);
  });

  it('offers none of the entries of an earlier query and keeps Enter and Tab to itself (T16-I1)', () => {
    const editor = fakeEditor();
    const ref = createRef<SuggestionHandle>();
    const { picked, list } = entries('WEB-4', 'WEB-40');
    const { rerender } = render(<SuggestionMenu ref={ref} editor={editor} label="Items" sections={[{ entries: list }]} status="Sucht …" stale />);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => [option.getAttribute('aria-disabled'), option.getAttribute('aria-selected')])).toEqual([
      ['true', 'false'],
      ['true', 'false'],
    ]);
    expect(editor.view.dom.hasAttribute('aria-activedescendant')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Sucht …');

    // used up, nothing taken, no line break; the arrows and other keys stay the editor's
    expect(ref.current!.onKeyDown(key('Enter'))).toBe(true);
    expect(ref.current!.onKeyDown(key('Tab'))).toBe(true);
    expect(ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(true);
    expect(ref.current!.onKeyDown(key('ArrowDown'))).toBe(false);
    fireEvent.mouseEnter(options[1]);
    fireEvent.click(options[1]);
    expect(options[1].hasAttribute('data-highlighted')).toBe(false);
    expect(picked).toEqual([]);

    // the answer came: the entries are there to take
    rerender(<SuggestionMenu ref={ref} editor={editor} label="Items" sections={[{ entries: list }]} status="" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(ref.current!.onKeyDown(key('Enter'))).toBe(true);
    expect(picked).toEqual(['WEB-4']);
  });

  it('follows the mouse without taking the focus from the editor', () => {
    const editor = fakeEditor();
    const { picked, list } = entries('Mara', 'Ida');
    render(<SuggestionMenu editor={editor} label="Personen" sections={[{ entries: list }]} status="Niemand" />);
    const ida = screen.getByRole('option', { name: 'Ida' });

    fireEvent.mouseEnter(ida);
    expect(ida.getAttribute('aria-selected')).toBe('true');
    expect(ida.hasAttribute('data-highlighted')).toBe(true);
    // the press does not move the focus out of the text
    expect(fireEvent.mouseDown(ida)).toBe(false);
    fireEvent.click(ida);
    expect(picked).toEqual(['Ida']);
  });

  it('starts at the top again when the entries change', () => {
    const editor = fakeEditor();
    const ref = createRef<SuggestionHandle>();
    const first = entries('Mara', 'Ida');
    const { rerender } = render(<SuggestionMenu ref={ref} editor={editor} label="Personen" sections={[{ entries: first.list }]} status="" />);
    act(() => void ref.current!.onKeyDown(key('ArrowDown')));
    expect(screen.getByRole('option', { name: 'Ida' }).getAttribute('aria-selected')).toBe('true');

    rerender(<SuggestionMenu ref={ref} editor={editor} label="Personen" sections={[{ entries: entries('Ida', 'Theo').list }]} status="" />);
    expect(screen.getByRole('option', { name: 'Ida' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('option')[0].textContent).toBe('Ida');
  });

  it('shows groups with their headings and leaves out empty ones', () => {
    const sections: SuggestionSection[] = [{ label: 'Items', entries: entries('WEB-47').list }, { label: 'Seiten', entries: [] }];
    render(<SuggestionMenu editor={fakeEditor()} label="Verweise" sections={sections} status="" />);
    expect(screen.getByRole('group', { name: 'Items' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Seiten' })).toBeNull();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['WEB-47']);
  });

  it('says why it is empty, names no active entry, and leaves every key to the editor', () => {
    const editor = fakeEditor();
    const ref = createRef<SuggestionHandle>();
    const { unmount } = render(<SuggestionMenu ref={ref} editor={editor} label="Personen" sections={[{ entries: [] }]} status="Niemand heißt „zz“." />);
    expect(screen.getByRole('status').textContent).toBe('Niemand heißt „zz“.');
    expect(editor.view.dom.hasAttribute('aria-activedescendant')).toBe(false);
    for (const name of ['ArrowDown', 'Enter', 'Tab']) expect(ref.current!.onKeyDown(key(name))).toBe(false);

    // gone: the editor names no list any more
    unmount();
    expect(['aria-controls', 'aria-autocomplete', 'aria-activedescendant'].filter((name) => editor.view.dom.hasAttribute(name))).toEqual([]);
  });
});

describe('the entries of the / menu', () => {
  const ids = (...args: Parameters<typeof slashItemsFor>) => slashItemsFor(...args).map((item) => item.id);

  it('offers what the level knows', () => {
    expect(ids('comment', '', { projectId: null })).toEqual(['list', 'ordered', 'code', 'quote']);
    expect(ids('description', '', { projectId: null })).toEqual(['heading1', 'heading2', 'heading3', 'list', 'ordered', 'tasks', 'code', 'quote']);
    expect(ids('page', '', { projectId: null })).toEqual(['heading1', 'heading2', 'heading3', 'list', 'ordered', 'tasks', 'code', 'quote', 'table', 'rule']);
  });

  it('finds an entry by a word of its own, in any case', () => {
    expect(ids('description', 'TODO', { projectId: null })).toEqual(['tasks']);
    expect(ids('page', '  spalten ', { projectId: null })).toEqual(['table']);
    expect(ids('comment', 'nichts', { projectId: null })).toEqual([]);
  });

  it('offers an image or a file only with a project and a way to upload, and opens the file choice', () => {
    const chooseFiles = vi.fn();
    expect(ids('comment', 'bild', { projectId: 'p_web' })).toEqual([]);
    expect(ids('comment', 'bild', { projectId: null, chooseFiles })).toEqual([]);

    const env = { projectId: 'p_web', chooseFiles };
    const [file] = slashItemsFor('comment', 'datei', env);
    expect(file.id).toBe('file');
    expect(file.label()).toBe('Bild oder Datei');
    const editor = {} as Editor;
    file.run(editor, env);
    expect(chooseFiles).toHaveBeenCalledWith(editor);
  });
});
