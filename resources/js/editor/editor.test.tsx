import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { createRef, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import schemaPhp from '/app/RichText/Schema.php?raw';
import { textDoc } from '@/lib/richtext';
import type { RichText } from '@/types';
import { PRESETS, type EditorPreset } from './presets';
import { EMPTY_DOC, isEmptyDoc, preloadEditor, RichTextEditor } from './RichTextEditor';
import { RichTextView } from './RichTextView';

// jsdom has no layout: ProseMirror measures the selection to scroll it into view
beforeAll(async () => {
  // the table support is a chunk of its own; loaded once here, so no editor waits for it
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

/** The nodes of a type in a document, depth first. */
function nodesOf(doc: RichText | null | undefined, type: string): RichText[] {
  if (!doc) return [];
  return [...(doc.type === type ? [doc] : []), ...(doc.content ?? []).flatMap((child: RichText) => nodesOf(child, type))];
}

/** Every node type and mark type of a document. */
function typesOf(doc: RichText): { nodes: Set<string>; marks: Set<string> } {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  const visit = (node: RichText) => {
    nodes.add(node.type!);
    node.marks?.forEach((mark) => marks.add(mark.type));
    node.content?.forEach(visit);
  };
  visit(doc);
  return { nodes, marks };
}

/** Pastes HTML the way a browser hands it over (jsdom knows no ClipboardEvent). */
const pasteHtml = (target: HTMLElement, html: string) =>
  fireEvent.paste(target, { clipboardData: { types: ['text/html'], files: [], getData: (type: string) => (type === 'text/html' ? html : '') } });

/**
 * The checkboxes of a read-only text are inert: no tab stop, and neither a click nor Space changes them. `focusFrom`
 * is where Tab starts.
 */
async function expectStillCheckboxes(user: ReturnType<typeof userEvent.setup>, focusFrom: HTMLElement) {
  const box = screen.getByRole('checkbox', { name: 'Testen: erledigt' });
  expect(box).toHaveProperty('disabled', true);
  focusFrom.focus();
  await user.tab();
  expect(document.activeElement).not.toBe(box);
  await user.click(box);
  box.focus();
  await user.keyboard(' ');
  expect(box).toHaveProperty('checked', true);
  expect(box.closest('li')?.getAttribute('data-checked')).toBe('true');
}

const lastDoc = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.lastCall?.[0] as RichText | null | undefined;

/** A list constant of `App\RichText\Schema`, read from the PHP file, so the mirror cannot go stale. */
function serverList(name: string): string[] {
  const list = new RegExp(`public const ${name} = \\[([^\\]]*)\\];`).exec(schemaPhp)?.[1];
  if (list === undefined) throw new Error(`Schema::${name} not found`);
  return list.split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

const cell = (type: 'tableHeader' | 'tableCell', text: string): RichText => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const tableDoc: RichText = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Vorher' }] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Gerät'), cell('tableHeader', 'Stand')] },
        { type: 'tableRow', content: [cell('tableCell', 'Pixel 9'), cell('tableCell', 'offen')] },
      ],
    },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Testen' }] }] }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ergebnis' }] },
    { type: 'horizontalRule' },
  ],
};

/** Every node and mark of the level `page`, so of every level. */
const everyFeature: RichText = {
  type: 'doc',
  content: [
    ...[1, 2, 3].map((level) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: `Stufe ${level}` }] })),
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'fett', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'kursiv', marks: [{ type: 'italic' }] },
        { type: 'text', text: 'durch', marks: [{ type: 'strike' }] },
        { type: 'text', text: 'code', marks: [{ type: 'code' }] },
        { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt' }] }] }] },
    { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Erstens' }] }] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Offen' }] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zitat' }] }] },
    { type: 'codeBlock', attrs: { language: 'php' }, content: [{ type: 'text', text: 'echo 1;' }] },
    { type: 'horizontalRule' },
    { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Kopf')] }, { type: 'tableRow', content: [cell('tableCell', 'Zelle')] }] },
  ],
};

describe('RichTextEditor', () => {
  it('shows a document and reports changes as Tiptap JSON', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor value={textDoc('Hallo')} onChange={onChange} preset="description" autoFocus />);

    const editor = await screen.findByRole('textbox', { name: 'Beschreibung' });
    expect(editor.textContent).toBe('Hallo');
    // the focus lands at the end
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await user.keyboard(' Welt');
    expect(lastDoc(onChange)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo Welt' }] }] });

    // its own document coming back changes nothing; one from outside (a reload) replaces the text, silently
    const calls = onChange.mock.calls.length;
    rerender(<RichTextEditor value={lastDoc(onChange)!} onChange={onChange} preset="description" />);
    expect(editor.textContent).toBe('Hallo Welt');
    rerender(<RichTextEditor value={textDoc('Von nebenan')} onChange={onChange} preset="description" />);
    expect(editor.textContent).toBe('Von nebenan');
    expect(onChange).toHaveBeenCalledTimes(calls);

    // emptied: null, which shows the same empty paragraph
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    expect(lastDoc(onChange)).toBeNull();
    rerender(<RichTextEditor value={null} onChange={onChange} preset="description" />);
    expect(editor.querySelectorAll('p')).toHaveLength(1);
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Beschreibung schreiben …');
  });

  it('keeps every key of fast typing, also when the parent renders a document the editor has moved past', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [doc, setDoc] = useState<RichText | null>(null);
      return <RichTextEditor value={doc} onChange={setDoc} preset="comment" autoFocus />;
    }
    render(<Controlled />);
    const editor = await screen.findByRole('textbox', { name: 'Kommentar' });
    await waitFor(() => expect(document.activeElement).toBe(editor));

    await user.keyboard('Tritt auch in Safari auf');
    expect(editor.textContent).toBe('Tritt auch in Safari auf');
  });

  it('knows an empty document', () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc(undefined)).toBe(true);
    expect(isEmptyDoc(EMPTY_DOC)).toBe(true);
    expect(isEmptyDoc(textDoc('   '))).toBe(true);
    // a list without text yet holds nothing either
    expect(isEmptyDoc({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] })).toBe(true);
    expect(isEmptyDoc(textDoc('Text'))).toBe(false);
    expect(isEmptyDoc({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe(false);
    expect(isEmptyDoc({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] }] })).toBe(false);
  });

  it('turns Markdown shortcuts into blocks while typing', async () => {
    const user = userEvent.setup();
    const typeInto = async (preset: EditorPreset, text: string) => {
      const onChange = vi.fn();
      const { unmount } = render(<RichTextEditor value={null} onChange={onChange} preset={preset} />);
      const editor = screen.getByRole('textbox');
      await user.click(editor);
      await user.keyboard(text);
      unmount();
      return lastDoc(onChange);
    };

    const heading = await typeInto('description', '## Ziel');
    expect(nodesOf(heading, 'heading').map((node) => [node.attrs?.level, node.content?.[0].text])).toEqual([[2, 'Ziel']]);
    expect(nodesOf(await typeInto('description', '- Punkt'), 'bulletList')).toHaveLength(1);
    expect(nodesOf(await typeInto('description', '1. Erstens'), 'orderedList')).toHaveLength(1);
    expect(nodesOf(await typeInto('description', '> Zitat'), 'blockquote')).toHaveLength(1);
    // `[[` is a literal `[` for user-event
    const task = await typeInto('description', '[[ ] Aufgabe');
    expect(nodesOf(task, 'taskItem').map((node) => [node.attrs?.checked, nodesOf(node, 'text')[0]?.text])).toEqual([[false, 'Aufgabe']]);

    // a comment has lists, but neither headings nor checklists: their shortcuts stay text
    expect(nodesOf(await typeInto('comment', '- Punkt'), 'bulletList')).toHaveLength(1);
    expect(await typeInto('comment', '## Ziel')).toEqual(textDoc('## Ziel'));
    expect(await typeInto('comment', '[[ ] Aufgabe')).toEqual(textDoc('[ ] Aufgabe'));
  });

  it('keeps tables and checklists of a description but not of a comment', () => {
    const { unmount } = render(<RichTextEditor value={tableDoc} onChange={vi.fn()} preset="description" />);
    const description = screen.getByRole('textbox', { name: 'Beschreibung' });
    expect(description.querySelectorAll('th')).toHaveLength(2);
    expect(description.querySelectorAll('td')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Testen: erledigt' })).toHaveProperty('checked', true);
    expect(description.querySelector('h2')?.textContent).toBe('Ergebnis');
    // a horizontal rule is the wiki's only
    expect(description.querySelector('hr')).toBeNull();
    unmount();

    render(<RichTextEditor value={tableDoc} onChange={vi.fn()} preset="comment" />);
    const comment = screen.getByRole('textbox', { name: 'Kommentar' });
    expect(comment.querySelector('table')).toBeNull();
    expect(comment.querySelector('h2')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    // the text stays, in paragraphs
    expect([...comment.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Vorher', 'Gerät', 'Stand', 'Pixel 9', 'offen', 'Testen', 'Ergebnis']);
  });

  it('names an empty checklist item', () => {
    render(<RichTextEditor value={{ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', content: [{ type: 'paragraph' }] }] }] }} onChange={vi.fn()} preset="page" />);
    expect(screen.getByRole('checkbox', { name: 'Leerer Punkt: offen' })).toHaveProperty('checked', false);
  });

  it('submits on mod+enter and leaves on escape', async () => {
    const user = userEvent.setup();
    const seen: Array<[string, boolean]> = [];
    const record = (event: KeyboardEvent) => seen.push([event.key, event.defaultPrevented]);
    window.addEventListener('keydown', record);
    try {
      const onChange = vi.fn();
      const onSubmit = vi.fn();
      const onEscape = vi.fn();
      const { rerender } = render(<RichTextEditor value={textDoc('Sieht gut aus')} onChange={onChange} onSubmit={onSubmit} onEscape={onEscape} preset="comment" />);
      const editor = screen.getByRole('textbox', { name: 'Kommentar' });
      await user.click(editor);
      seen.length = 0;

      // jsdom is no Mac: mod is the Control key
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(editor.querySelectorAll('p')).toHaveLength(1);
      expect(editor.querySelector('br')).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(seen).toContainEqual(['Enter', true]);

      // with onEscape the editor uses the key up: nothing around it sees it (a dialog stays open)
      seen.length = 0;
      // ProseMirror reads the legacy keyCode (27)
      const escape = () => fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
      act(() => void escape());
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([]);
      // the Escape that cancels an IME composition belongs to it
      act(() => void fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true }));
      expect(onEscape).toHaveBeenCalledTimes(1);

      // without them both keys go on to the page, and mod+enter still adds no line break
      rerender(<RichTextEditor value={textDoc('Sieht gut aus')} onChange={onChange} preset="comment" />);
      await user.click(editor);
      seen.length = 0;
      await user.keyboard('{Control>}{Enter}{/Control}');
      act(() => void escape());
      expect(seen).toEqual([
        ['Control', false],
        ['Enter', false],
        ['Escape', false],
      ]);
      expect(editor.querySelector('br')).toBeNull();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onEscape).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', record);
    }
  });

  it('names the editor and marks it invalid', () => {
    const { rerender } = render(<RichTextEditor value={null} onChange={vi.fn()} preset="page" />);
    const editor = screen.getByRole('textbox', { name: 'Inhalt der Seite' });
    expect(editor.getAttribute('aria-invalid')).toBeNull();
    expect(editor.getAttribute('aria-describedby')).toBeNull();
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Schreiben …');

    rerender(<RichTextEditor value={null} onChange={vi.fn()} preset="page" label="Rich Text: Abnahme" invalid describedBy="abnahme-error" placeholder="Was gilt als fertig?" />);
    expect(screen.getByRole('textbox', { name: 'Rich Text: Abnahme' })).toBe(editor);
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(editor.getAttribute('aria-describedby')).toBe('abnahme-error');
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Was gilt als fertig?');

    rerender(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" />);
    const comment = screen.getByRole('textbox', { name: 'Kommentar' });
    expect(comment.getAttribute('aria-invalid')).toBeNull();
    expect(comment.querySelector('p')?.getAttribute('data-placeholder')).toBe('Kommentar schreiben …');
  });

  it('keeps the checklists of a read-only text still, and lets them work again when it may be changed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Davor</button>
        <RichTextEditor value={tableDoc} onChange={onChange} preset="description" readOnly />
      </>,
    );
    await expectStillCheckboxes(user, screen.getByRole('button', { name: 'Davor' }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <>
        <button type="button">Davor</button>
        <RichTextEditor value={tableDoc} onChange={onChange} preset="description" />
      </>,
    );
    const box = screen.getByRole('checkbox', { name: 'Testen: erledigt' });
    expect(box).toHaveProperty('disabled', false);
    fireEvent.click(box);
    expect(nodesOf(lastDoc(onChange), 'taskItem')[0].attrs?.checked).toBe(false);
  });

  it('holds a read-only document that it does not let anyone change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor value={textDoc('Nur lesen')} onChange={onChange} preset="description" readOnly />);
    const editor = screen.getByRole('textbox', { name: 'Beschreibung' });
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(editor.getAttribute('aria-readonly')).toBe('true');
    await user.type(editor, 'x');
    expect(onChange).not.toHaveBeenCalled();

    rerender(<RichTextEditor value={textDoc('Nur lesen')} onChange={onChange} preset="description" />);
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(editor.getAttribute('aria-readonly')).toBeNull();
  });

  it('hands out the Tiptap editor and takes it back when it goes', () => {
    const editorRef = createRef<Editor | null>();
    const { unmount } = render(<RichTextEditor value={textDoc('Hallo')} onChange={vi.fn()} preset="description" editorRef={editorRef} />);
    expect(editorRef.current?.getText()).toBe('Hallo');
    unmount();
    expect(editorRef.current).toBeNull();
  });

  it('refuses links other than http, https and mailto', async () => {
    const user = userEvent.setup();
    const editorRef = createRef<Editor | null>();
    const onChange = vi.fn();
    render(<RichTextEditor value={textDoc('Hier klicken')} onChange={onChange} preset="description" editorRef={editorRef} />);
    const editor = editorRef.current!;
    const link = (href: string) => editor.chain().selectAll().setLink({ href }).run();

    for (const href of ['javascript:alert(1)', 'ftp://example.com/datei', 'tel:+4930123', 'data:text/html,hallo', '/relativ', '#anker']) {
      expect(link(href), href).toBe(false);
    }
    expect(nodesOf(lastDoc(onChange), 'text').flatMap((node) => node.marks ?? [])).toEqual([]);

    for (const href of ['https://example.com', 'http://example.com', 'mailto:mara@example.com', 'HTTPS://EXAMPLE.COM']) {
      expect(link(href), href).toBe(true);
      expect(nodesOf(lastDoc(onChange), 'text')[0].marks?.[0].attrs?.href).toBe(href);
    }
    // the editor's own rel and target, the ones the server keeps
    expect(screen.getByRole('link', { name: 'Hier klicken' }).getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(screen.getByRole('link', { name: 'Hier klicken' }).getAttribute('target')).toBe('_blank');

    // pasted: a link to another protocol keeps its text only
    act(() => void editor.commands.setContent(EMPTY_DOC));
    pasteHtml(screen.getByRole('textbox'), '<p><a href="ftp://example.com">alt</a> <a href="javascript:alert(1)">böse</a> <a href="https://example.com">gut</a></p>');
    const pasted = nodesOf(lastDoc(onChange), 'text').filter((node) => node.marks?.length);
    expect(pasted.map((node) => [node.text, node.marks?.[0].attrs?.href])).toEqual([['gut', 'https://example.com']]);

    // typed: a web address becomes a link when it ends
    act(() => void editor.commands.setContent(EMPTY_DOC));
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('Siehe https://example.com/doku ');
    expect(nodesOf(lastDoc(onChange), 'text').find((node) => node.marks?.length)?.marks?.[0].attrs?.href).toBe('https://example.com/doku');
  });

  it('keeps underline out: neither mod+u nor a pasted <u> makes a mark the server does not know', async () => {
    const user = userEvent.setup();
    const editorRef = createRef<Editor | null>();
    const onChange = vi.fn();
    render(<RichTextEditor value={null} onChange={onChange} preset="page" editorRef={editorRef} />);
    const editor = screen.getByRole('textbox');
    await user.click(editor);
    await user.keyboard('{Control>}u{/Control}unten');
    expect(lastDoc(onChange)).toEqual(textDoc('unten'));

    pasteHtml(editor, '<p><u>unter</u><span style="text-decoration: underline">strichen</span></p>');
    expect(typesOf(lastDoc(onChange)!).marks).toEqual(new Set());
    expect(editorRef.current!.schema.marks.underline).toBeUndefined();
  });
});

describe('the schema of the editor', () => {
  const nodes = serverList('NODES');
  const marks = serverList('MARKS');

  it('reads the lists of App\\RichText\\Schema', () => {
    expect(nodes).toContain('taskItem');
    expect(marks).toEqual(['bold', 'italic', 'strike', 'code', 'link']);
    expect(serverList('HEADING_LEVELS')).toEqual(['1', '2', '3']);
    expect(serverList('LINK_PROTOCOLS')).toEqual(['http', 'https', 'mailto']);
  });

  it.each(Object.keys(PRESETS) as EditorPreset[])('knows only nodes and marks of the server in the %s editor', (preset) => {
    const editorRef = createRef<Editor | null>();
    render(<RichTextEditor value={null} onChange={vi.fn()} preset={preset} editorRef={editorRef} />);
    const schema = editorRef.current!.schema;

    expect(Object.keys(schema.nodes).filter((name) => !nodes.includes(name))).toEqual([]);
    expect(Object.keys(schema.marks).filter((name) => !marks.includes(name))).toEqual([]);
  });

  it('orders marks as App\\RichText\\Schema::MARK_ORDER does, so the server stores what the editor writes', () => {
    const editorRef = createRef<Editor | null>();
    render(<RichTextEditor value={null} onChange={vi.fn()} preset="page" editorRef={editorRef} />);

    expect(Object.keys(editorRef.current!.schema.marks)).toEqual(serverList('MARK_ORDER'));
  });

  it('writes nothing but nodes and marks of the server from a document with every feature of a description', () => {
    const editorRef = createRef<Editor | null>();
    render(<RichTextEditor value={everyFeature} onChange={vi.fn()} preset="description" editorRef={editorRef} />);
    const written = typesOf(editorRef.current!.getJSON());

    // a description has everything but the horizontal rule
    expect([...written.nodes].sort()).toEqual(nodes.filter((name) => name !== 'horizontalRule').sort());
    expect([...written.marks].sort()).toEqual([...marks].sort());
    // headings 1 to 3, as the server keeps them
    expect(nodesOf(editorRef.current!.getJSON(), 'heading').map((node) => node.attrs?.level)).toEqual([1, 2, 3]);
  });
});

describe('RichTextView', () => {
  it('shows a read-only view', () => {
    const { rerender } = render(<RichTextView value={tableDoc} preset="description" className="text-ui" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    const view = document.querySelector('.rt-content')!;
    expect(view.getAttribute('contenteditable')).toBe('false');
    expect(view.closest('.rt')?.classList.contains('text-ui')).toBe(true);
    expect(view.querySelectorAll('th')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Testen: erledigt' })).toHaveProperty('checked', true);
    expect(view.querySelector('hr')).toBeNull();

    // the same document on a page has its rule; in a comment the blocks it lacks are paragraphs
    rerender(<RichTextView value={tableDoc} preset="page" />);
    expect(document.querySelector('.rt-content hr')).not.toBeNull();
    rerender(<RichTextView value={tableDoc} preset="comment" />);
    expect(document.querySelector('.rt-content table')).toBeNull();
    expect(document.querySelector('.rt-content')?.textContent).toBe('VorherGerätStandPixel 9offenTestenErgebnis');

    // a new document replaces the text, null empties it
    rerender(<RichTextView value={textDoc('Neu')} preset="comment" />);
    expect(document.querySelector('.rt-content')?.textContent).toBe('Neu');
    rerender(<RichTextView value={null} preset="comment" />);
    expect(document.querySelector('.rt-content')?.textContent).toBe('');
  });

  it('keeps its checklists still', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Davor</button>
        <RichTextView value={tableDoc} preset="description" />
      </>,
    );
    await expectStillCheckboxes(user, screen.getByRole('button', { name: 'Davor' }));
  });

  it('shows a link only to http, https and mailto', () => {
    const linked = (href: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }] }] });
    const { rerender } = render(<RichTextView value={linked('https://example.com')} preset="comment" />);
    expect(screen.getByRole('link', { name: 'https://example.com' }).getAttribute('href')).toBe('https://example.com');

    rerender(<RichTextView value={linked('javascript:alert(1)')} preset="comment" />);
    expect(document.querySelector('.rt-content a')?.getAttribute('href')).toBe('');
  });
});
