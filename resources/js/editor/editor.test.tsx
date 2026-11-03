import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { Component, createRef, useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import schemaPhp from '/app/RichText/Schema.php?raw';
import { Dialog } from '@/components/ui/Dialog';
import { qk } from '@/hooks/keys';
import { textDoc } from '@/lib/richtext';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, mara, person, searchResults, types, web47 } from '@/test/fixtures';
import type { RichText, User } from '@/types';
import { PRESETS, type EditorPreset } from './presets';
import { EMPTY_DOC, isEmptyDoc, LateBoundary, LateChunkError, preloadEditor, RichTextEditor } from './RichTextEditor';
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

/** Mentions, references and their lists read through the API: a query client and a fake server. */
let api: MockApi | null = null;
afterEach(() => {
  api?.restore();
  api = null;
});

function renderWithData(node: ReactNode, routes: Record<string, MockRoute> = {}) {
  api = mockApi(routes);
  // as the app's: no retries, fresh for a moment (a reference chosen in the # list is not asked for again)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });
  return { ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>), client };
}

const kira: User = { ...person('u_kira', 'Kira', 'kira'), type: 'bot', email: null };

const paragraph = (...content: RichText[]): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const mention = (id: string, label: string): RichText => ({ type: 'mention', attrs: { id, label, mentionSuggestionChar: '@' } });
const reference = (id: string): RichText => ({ type: 'reference', attrs: { id, label: null, mentionSuggestionChar: '#', kind: 'item' } });

/** Escape on the editor, with the legacy keyCode ProseMirror reads. */
const pressEscape = (editor: HTMLElement) => act(() => void fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 }));

/**
 * Holds every answer of the fake server back until `release()`, so a test sees what a list says while it waits;
 * `held` names the addresses asked for meanwhile.
 */
function holdAnswers(): { release: () => void; held: string[] } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held: string[] = [];
  const answer = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = new URL(String(args[0]), window.location.origin);
    held.push(`${url.pathname}${url.search}`);
    await gate;
    return answer(...args);
  };
  return { release, held };
}

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
        mention('u_mara', 'mara'),
        reference('wi_web_47'),
        { type: 'attachment', attrs: { attachmentId: '01jattachmentfile0000000000', filename: 'angebot.pdf' } },
      ],
    },
    { type: 'image', attrs: { attachmentId: '01jattachmentimage000000000', alt: 'Formular' } },
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
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Beschreibung schreiben … / fügt ein');
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
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Schreiben … / für Blöcke');

    rerender(<RichTextEditor value={null} onChange={vi.fn()} preset="page" label="Rich Text: Abnahme" invalid describedBy="abnahme-error" placeholder="Was gilt als fertig?" />);
    expect(screen.getByRole('textbox', { name: 'Rich Text: Abnahme' })).toBe(editor);
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(editor.getAttribute('aria-describedby')).toBe('abnahme-error');
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Was gilt als fertig?');

    rerender(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" />);
    const comment = screen.getByRole('textbox', { name: 'Kommentar' });
    expect(comment.getAttribute('aria-invalid')).toBeNull();
    expect(comment.querySelector('p')?.getAttribute('data-placeholder')).toBe('Kommentar schreiben … / fügt ein');
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
    renderWithData(<RichTextEditor value={everyFeature} onChange={vi.fn()} preset="description" editorRef={editorRef} />, {
      'GET /api/v1/users': () => ({ body: list([mara]) }),
      'GET /api/v1/references': () => ({ body: { data: { items: [web47] } } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    const written = typesOf(editorRef.current!.getJSON());

    // a description has everything but the horizontal rule
    expect([...written.nodes].sort()).toEqual(nodes.filter((name) => name !== 'horizontalRule').sort());
    expect([...written.marks].sort()).toEqual([...marks].sort());
    // headings 1 to 3, as the server keeps them
    expect(nodesOf(editorRef.current!.getJSON(), 'heading').map((node) => node.attrs?.level)).toEqual([1, 2, 3]);
    // the attributes the server stores, nothing more (no src, no label of a reference)
    const json = editorRef.current!.getJSON();
    expect(nodesOf(json, 'mention')[0].attrs).toEqual({ id: 'u_mara', label: 'mara', mentionSuggestionChar: '@' });
    expect(nodesOf(json, 'reference')[0].attrs).toEqual({ id: 'wi_web_47', label: null, mentionSuggestionChar: '#', kind: 'item' });
    expect(nodesOf(json, 'image')[0].attrs).toEqual({ attachmentId: '01jattachmentimage000000000', alt: 'Formular' });
    expect(nodesOf(json, 'attachment')[0].attrs).toEqual({ attachmentId: '01jattachmentfile0000000000', filename: 'angebot.pdf' });
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

describe('the menus of the editor', () => {
  it('opens the / menu and turns the line into a heading', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor value={null} onChange={onChange} preset="description" />);
    const editor = screen.getByRole('textbox', { name: 'Beschreibung' });
    await user.click(editor);
    await user.keyboard('/');

    const menu = await screen.findByRole('listbox', { name: 'Blöcke' });
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Überschrift 1#',
      'Überschrift 2##',
      'Überschrift 3###',
      'Liste-',
      'Nummerierte Liste1.',
      'Checkliste[ ]',
      'Code```',
      'Zitat>',
    ]);
    // the editor names the list and its active entry; the focus stays in the text
    expect(editor.getAttribute('aria-controls')).toBe(menu.id);
    expect(document.activeElement).toBe(editor);

    // typing narrows the list, the arrows move, Enter takes the entry and the slash with what followed it goes
    await user.keyboard('über');
    await waitFor(() => expect(within(menu).getAllByRole('option')).toHaveLength(3));
    await user.keyboard('{ArrowDown}');
    expect(editor.getAttribute('aria-activedescendant')).toBe(within(menu).getByRole('option', { name: /Überschrift 2/ }).id);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(editor.getAttribute('aria-controls')).toBeNull();
    await user.keyboard('Ziel');
    // the line is the heading, without the slash (Tiptap keeps an empty paragraph after it to write on)
    expect(lastDoc(onChange)?.content?.[0]).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ziel' }] });
  });

  it('offers a table in / only on page', async () => {
    const user = userEvent.setup();
    const offered = async (preset: EditorPreset) => {
      const { unmount } = render(<RichTextEditor value={null} onChange={vi.fn()} preset={preset} />);
      await user.click(screen.getByRole('textbox'));
      await user.keyboard('/');
      const names = within(await screen.findByRole('listbox', { name: 'Blöcke' }))
        .getAllByRole('option')
        .map((option) => option.textContent);
      unmount();
      return names;
    };

    const page = await offered('page');
    expect(page).toContain('Tabelle');
    expect(page).toContain('Linie---');
    expect(await offered('description')).not.toContain('Tabelle');
    // a comment has neither headings nor checklists, so the menu offers none
    expect(await offered('comment')).toEqual(['Liste-', 'Nummerierte Liste1.', 'Code```', 'Zitat>']);
  });

  it('inserts a table, a rule, a list, a numbered list, a checklist, code and a quote from /', async () => {
    const user = userEvent.setup();
    const take = async (name: string) => {
      const onChange = vi.fn();
      const { unmount } = render(<RichTextEditor value={null} onChange={onChange} preset="page" />);
      await user.click(screen.getByRole('textbox'));
      await user.keyboard('/');
      await user.click(within(await screen.findByRole('listbox', { name: 'Blöcke' })).getByRole('option', { name: new RegExp(`^${name}`) }));
      const doc = lastDoc(onChange);
      unmount();
      // the first block is the line the slash stood in
      return doc?.content?.[0].type;
    };

    expect(await take('Tabelle')).toBe('table');
    expect(await take('Linie')).toBe('horizontalRule');
    expect(await take('Liste')).toBe('bulletList');
    expect(await take('Nummerierte Liste')).toBe('orderedList');
    expect(await take('Checkliste')).toBe('taskList');
    expect(await take('Code')).toBe('codeBlock');
    expect(await take('Zitat')).toBe('blockquote');
  });

  it('says when no block fits, and never opens in code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<RichTextEditor value={{ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: null } }] }} onChange={onChange} preset="comment" />);
    await user.click(screen.getByRole('textbox'));
    await user.keyboard(' /pfad');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(nodesOf(lastDoc(onChange), 'text')[0].text).toBe(' /pfad');
    unmount();

    render(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" />);
    const editor = screen.getByRole('textbox');
    await user.click(editor);
    await user.keyboard('/gibtsnicht');
    expect(await screen.findByText('Kein Block heißt „gibtsnicht“.', { selector: 'p' })).toBeTruthy();
    // said through the editor's live region, which was there before the list opened (F21)
    expect(document.querySelector('[data-editor-announcer]')!.textContent).toBe('Kein Block heißt „gibtsnicht“.');
    expect(editor.getAttribute('aria-activedescendant')).toBeNull();
    // with nothing to take, Enter is the editor's again
    await user.keyboard('{Enter}');
    expect(editor.querySelectorAll('p')).toHaveLength(2);
  });

  it('highlights a code block in its language', async () => {
    const code = (text: string, language: string | null): RichText => ({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] }] });
    const onChange = vi.fn();
    const { unmount } = render(<RichTextEditor value={code('const answer = 42; // stimmt', 'javascript')} onChange={onChange} preset="comment" />);
    const editor = screen.getByRole('textbox');

    await waitFor(() => expect(editor.querySelector('pre .hljs-keyword')?.textContent).toBe('const'));
    expect(editor.querySelector('pre .hljs-number')?.textContent).toBe('42');
    expect(editor.querySelector('pre .hljs-comment')?.textContent).toBe('// stimmt');
    // spelling and translation stay out of code
    expect(editor.querySelector('pre')?.getAttribute('spellcheck')).toBe('false');
    expect(editor.querySelector('pre')?.getAttribute('translate')).toBe('no');
    unmount();

    // the viewer too; a block without a language is read in the one that fits best
    render(<RichTextView value={code('SELECT id, title FROM work_items WHERE archived_at IS NULL;', null)} preset="comment" />);
    await waitFor(() =>
      expect([...document.querySelectorAll('.rt-content pre .hljs-keyword')].map((node) => node.textContent)).toEqual(expect.arrayContaining(['SELECT', 'FROM', 'WHERE'])),
    );
    // the highlighting is decoration: the document stays plain text
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mentions a member with @ and stores id and handle', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" projectId="p_web" />, {
      'GET /api/v1/mentions': (_body, url) => ({ body: { data: [mara, kira].filter((user) => user.handle.startsWith(url.searchParams.get('q') ?? '')) } }),
      'GET /api/v1/users': () => ({ body: list([mara, kira]) }),
    });
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Kommentar schreiben … @ erwähnt, # verweist, / fügt ein');
    await user.click(editor);
    await user.keyboard('Danke @');

    // a person with the handle, a bot with its word
    const people = await screen.findByRole('listbox', { name: 'Personen und Bots' });
    await waitFor(() =>
      expect(within(people).getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringMatching(/Mara Lindqvist@mara$/), expect.stringMatching(/KiraBot$/)]),
    );
    await user.keyboard('ma');
    await waitFor(() => expect(within(people).getAllByRole('option')).toHaveLength(1));
    expect(api!.calls.map((call) => call.url)).toContain('/api/v1/mentions?project=p_web&q=ma');
    expect(editor.getAttribute('aria-activedescendant')).toBe(within(people).getByRole('option', { name: /Mara Lindqvist/ }).id);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'mention').map((node) => node.attrs)).toEqual([{ id: 'u_mara', label: 'mara', mentionSuggestionChar: '@' }]));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(editor.querySelector('.rt-mention')?.textContent).toBe('@mara');
    expect(editor.textContent).toBe('Danke @mara ');
  });

  it('says why the @ list is empty', async () => {
    const user = userEvent.setup();
    let fail = false;
    renderWithData(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" projectId="p_web" />, {
      'GET /api/v1/mentions': () => (fail ? { status: 500, body: { title: 'Server Error' } } : { body: { data: [] } }),
    });
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    const { release } = holdAnswers();
    await user.click(editor);
    await user.keyboard('@');
    expect(await screen.findByText('Sucht …', { selector: 'p' })).toBeTruthy();
    release();
    await user.keyboard('zz');
    expect(await screen.findByText('Niemand im Projekt heißt „zz“.', { selector: 'p' })).toBeTruthy();
    fail = true;
    await user.keyboard('x');
    expect(await screen.findByText('Die Personen ließen sich nicht laden.', { selector: 'p' })).toBeTruthy();
  });

  it('shows the current handle of a renamed account', async () => {
    renderWithData(
      <RichTextView value={paragraph(mention('u_mara', 'mara_alt'), { type: 'text', text: ' ' }, mention('u_ida', 'ida'), { type: 'text', text: ' ' }, mention('u_weg', 'weg'))} preset="comment" />,
      { 'GET /api/v1/users': () => ({ body: list([{ ...mara, handle: 'mara' }, { ...ida, disabled_at: '2026-10-01T08:00:00Z' }]) }) },
    );
    // the stored handle until the accounts are there, then the current one
    await waitFor(() => expect([...document.querySelectorAll('.rt-mention')].map((node) => node.textContent)).toEqual(['@mara_alt', '@ida', '@weg']));
    await waitFor(() => expect([...document.querySelectorAll('.rt-mention')].map((node) => node.textContent)).toEqual(['@mara', '@ida (deaktiviert)', '@weg']));
  });

  it('refers to an item with # over the search and shows its key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="description" projectId="p_web" />, {
      'GET /api/v1/search': (_body, url) => ({ body: { data: searchResults({ items: url.searchParams.get('q') === 'WEB' ? [web47] : [] }) } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    const editor = screen.getByRole('textbox', { name: 'Beschreibung' });
    await user.click(editor);
    await user.keyboard('Siehe #');

    // nothing typed yet: a hint, no search
    const items = await screen.findByRole('listbox', { name: 'Items' });
    expect(screen.getByText('Key oder Titel eingeben, zum Beispiel WEB-42.', { selector: 'p' })).toBeTruthy();
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/search'))).toEqual([]);

    await user.keyboard('WEB');
    const option = await within(items).findByRole('option', { name: /WEB-47/ });
    expect(option.textContent).toBe('WEB-47Kontaktformular sendet doppelt');
    expect(api!.calls.map((call) => call.url)).toContain('/api/v1/search?q=WEB&types=items&limit=6');

    await user.keyboard('{Enter}');
    // only the id and the kind: no key, no title in the stored text
    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'reference').map((node) => node.attrs)).toEqual([{ id: 'wi_web_47', label: null, mentionSuggestionChar: '#', kind: 'item' }]));
    // the chosen item shows at once, without asking the server; while editing it is no link
    await waitFor(() => expect(editor.querySelector('.rt-ref')?.textContent).toBe('WEB-47 Kontaktformular sendet doppelt'));
    expect(editor.querySelector('.rt-ref svg')).not.toBeNull();
    expect(editor.querySelector('a.rt-ref')).toBeNull();
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/references'))).toEqual([]);
  });

  it('takes no hit of an earlier query while the answer to what is typed is on its way (#)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const web4 = { ...web47, id: 'wi_web_4', number: 4, key: 'WEB-4', title: 'Logo tauschen' };
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" projectId="p_web" />, {
      'GET /api/v1/search': (_body, url) => ({ body: { data: searchResults({ items: url.searchParams.get('q') === 'WEB-47' ? [web47, web4] : [web4] }) } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    await user.click(editor);
    await user.keyboard('#WEB-4');
    const items = await screen.findByRole('listbox', { name: 'Items' });
    await waitFor(() => expect(within(items).getByRole('option', { name: /WEB-4/ }).getAttribute('aria-disabled')).toBeNull());

    // one more key, the server holds its answer: the old hit stays in sight, but greyed and not to be taken
    const { release, held } = holdAnswers();
    await user.keyboard('7');
    await waitFor(() => expect(held).toContain('/api/v1/search?q=WEB-47&types=items&limit=6'));
    const old = within(items).getByRole('option', { name: /WEB-4/ });
    expect(old.getAttribute('aria-disabled')).toBe('true');
    expect(old.getAttribute('aria-selected')).toBe('false');
    expect(editor.getAttribute('aria-activedescendant')).toBeNull();
    expect(within(screen.getByRole('listbox', { name: 'Items' }).parentElement!).getByText('Sucht …')).toBeTruthy();
    const before = lastDoc(onChange);
    // Enter, Tab and a click take nothing and add no line break
    await user.keyboard('{Enter}{Tab}');
    await user.click(old);
    expect(lastDoc(onChange)).toBe(before);
    expect(nodesOf(lastDoc(onChange), 'reference')).toEqual([]);

    release();
    await waitFor(() => expect(within(items).getAllByRole('option')[0].textContent).toContain('WEB-47'));
    expect(within(items).getAllByRole('option')[0].getAttribute('aria-disabled')).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'reference').map((node) => node.attrs?.id)).toEqual(['wi_web_47']));
  });

  it('takes an answer from the cache at once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { client } = renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" projectId="p_web" />, {
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    client.setQueryData(qk.search.list({ q: 'WEB-47', types: ['items'], limit: 6 }), searchResults({ items: [web47] }));
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    await user.click(editor);
    // the server would answer nothing in time: the cached hit is the one for what is typed
    holdAnswers();
    await user.keyboard('#WEB-47');
    const option = await screen.findByRole('option', { name: /WEB-47/ });
    expect(option.getAttribute('aria-disabled')).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'reference').map((node) => node.attrs?.id)).toEqual(['wi_web_47']));
  });

  it('takes no person of an earlier query while the answer to what is typed is on its way (@)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const marek = person('u_marek', 'Marek Sommer', 'marek');
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" projectId="p_web" />, {
      'GET /api/v1/mentions': (_body, url) => ({ body: { data: url.searchParams.get('q') === 'mare' ? [marek] : [mara, marek] } }),
      'GET /api/v1/users': () => ({ body: list([mara, marek]) }),
    });
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    await user.click(editor);
    await user.keyboard('@mar');
    const people = await screen.findByRole('listbox', { name: 'Personen und Bots' });
    await waitFor(() => expect(within(people).getAllByRole('option')).toHaveLength(2));
    await waitFor(() => expect(within(people).getAllByRole('option')[0].getAttribute('aria-disabled')).toBeNull());

    const { release, held } = holdAnswers();
    await user.keyboard('e');
    await waitFor(() => expect(held).toContain('/api/v1/mentions?project=p_web&q=mare'));
    expect(within(people).getAllByRole('option')[0].getAttribute('aria-disabled')).toBe('true');
    const before = lastDoc(onChange);
    await user.keyboard('{Enter}');
    expect(lastDoc(onChange)).toBe(before);
    expect(nodesOf(lastDoc(onChange), 'mention')).toEqual([]);

    release();
    await waitFor(() => expect(within(people).getAllByRole('option').map((option) => option.getAttribute('aria-disabled'))).toEqual([null]));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'mention').map((node) => node.attrs?.id)).toEqual(['u_marek']));
  });

  it('says why the # list is empty', async () => {
    const user = userEvent.setup();
    let fail = false;
    renderWithData(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" projectId="p_web" />, {
      'GET /api/v1/search': () => (fail ? { status: 503, body: { title: 'Unavailable' } } : { body: { data: searchResults() } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    await user.click(editor);
    await user.keyboard('#zz');
    expect(await screen.findByText('Sucht …', { selector: 'p' })).toBeTruthy();
    expect(await screen.findByText('Kein Item zu „zz“.', { selector: 'p' })).toBeTruthy();
    fail = true;
    await user.keyboard('x');
    expect(await screen.findByText('Die Suche antwortet gerade nicht.', { selector: 'p' })).toBeTruthy();
  });

  it('shows a hidden reference as hidden', async () => {
    const { client } = renderWithData(<RichTextView value={paragraph(reference('wi_web_47'), { type: 'text', text: ' und ' }, reference('wi_hidden'))} preset="comment" />, {
      'GET /api/v1/references': () => ({ body: { data: { items: [web47] } } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    // on its way
    await waitFor(() => expect([...document.querySelectorAll('.rt-ref')].map((node) => node.textContent)).toEqual(['…', '…']));

    // reading: a link with the key, the title for screen readers; what the reader does not see says "verborgen" only
    const link = await screen.findByRole('link', { name: 'WEB-47 Kontaktformular sendet doppelt' });
    expect(link.getAttribute('href')).toBe('/items/WEB-47');
    await waitFor(() => expect(document.querySelector('.rt-ref-hidden')?.textContent).toBe('verborgen'));
    expect(document.querySelector('.rt-ref-hidden svg')).not.toBeNull();
    // one request for both (the node views mount in any order)
    const asked = api!.calls.filter((call) => call.url.startsWith('/api/v1/references'));
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0].url, 'https://werkbuch.test').searchParams.get('items')?.split(',').sort()).toEqual(['wi_hidden', 'wi_web_47']);
    client.clear();
  });

  it('turns a reference into a link as soon as the editor becomes read-only (F22)', async () => {
    const value = paragraph(reference('wi_web_47'));
    const routes = {
      'GET /api/v1/references': () => ({ body: { data: { items: [web47] } } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    };
    const { rerender, client } = renderWithData(<RichTextEditor value={value} onChange={vi.fn()} preset="comment" projectId="p_web" />, routes);
    await waitFor(() => expect(document.querySelector('span.rt-ref')?.textContent).toBe('WEB-47 Kontaktformular sendet doppelt'));
    expect(screen.queryByRole('link')).toBeNull();

    rerender(
      <QueryClientProvider client={client}>
        <RichTextEditor value={value} onChange={vi.fn()} preset="comment" projectId="p_web" readOnly />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('link', { name: 'WEB-47 Kontaktformular sendet doppelt' })).getAttribute('href')).toBe('/items/WEB-47');
  });

  it('opens the / menu only at the start of a line or after a blank, never right after a mark or a mention (F22)', async () => {
    const user = userEvent.setup();
    const editorRef = createRef<Editor | null>();
    renderWithData(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" projectId="p_web" editorRef={editorRef} />, {
      'GET /api/v1/mentions': () => ({ body: { data: [] } }),
    });
    const tiptap = editorRef.current!;
    await user.click(screen.getByRole('textbox'));
    /** Types a plain / after the content, the way a person does once the bold is switched off. */
    const typeSlashAfter = async (content: RichText[]) => {
      act(() => void tiptap.chain().setContent({ type: 'doc', content: [{ type: 'paragraph', content }] }).focus('end').unsetMark('bold').run());
      await user.keyboard('/');
      const open = screen.queryByRole('listbox', { name: 'Blöcke' }) !== null;
      await user.keyboard('{Escape}');
      return open;
    };

    expect(await typeSlashAfter([{ type: 'text', marks: [{ type: 'bold' }], text: 'und' }])).toBe(false);
    expect(await typeSlashAfter([mention('u_mara', 'mara')])).toBe(false);
    expect(await typeSlashAfter([{ type: 'text', marks: [{ type: 'bold' }], text: 'und ' }])).toBe(true);
    expect(await typeSlashAfter([{ type: 'text', text: 'Zeile' }, { type: 'hardBreak' }])).toBe(true);
    expect(await typeSlashAfter([])).toBe(true);
  });

  it('says a reference did not load when the server fails', async () => {
    renderWithData(<RichTextView value={paragraph(reference('wi_web_47'))} preset="comment" />, {
      'GET /api/v1/references': () => ({ status: 500, body: { title: 'Server Error' } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    await waitFor(() => expect(document.querySelector('.rt-ref')?.textContent).toBe('Verweis'));
  });

  it('offers neither @ nor # without a project', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" />);
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    expect(editor.querySelector('p')?.getAttribute('data-placeholder')).toBe('Kommentar schreiben … / fügt ein');
    await user.click(editor);
    await user.keyboard('@mara #WEB');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(lastDoc(onChange)).toEqual(textDoc('@mara #WEB'));
    expect(api!.calls).toEqual([]);
  });

  it('closes a suggestion list with Escape without closing the dialog', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onEscape = vi.fn();
    renderWithData(
      <Dialog open onOpenChange={onOpenChange} title="Item anlegen">
        <RichTextEditor value={null} onChange={vi.fn()} preset="description" projectId="p_web" onEscape={onEscape} />
      </Dialog>,
      { 'GET /api/v1/mentions': () => ({ body: { data: [mara] } }) },
    );
    const editor = await screen.findByRole('textbox', { name: 'Beschreibung' });
    await user.click(editor);
    await user.keyboard('@ma');
    const list = await screen.findByRole('listbox', { name: 'Personen und Bots' });
    // inside the dialog, so a click on it is no click outside
    expect(screen.getByRole('dialog', { name: 'Item anlegen' }).contains(list)).toBe(true);

    pressEscape(editor);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Item anlegen' })).toBeTruthy();

    // the next Escape is the editor's again
    pressEscape(editor);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps pasted mentions, references and attachments of the server, and no image from the web', () => {
    const editorRef = createRef<Editor | null>();
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="description" editorRef={editorRef} />, {
      'GET /api/v1/users': () => ({ body: list([mara]) }),
      'GET /api/v1/references': () => ({ body: { data: { items: [web47] } } }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    });
    pasteHtml(
      screen.getByRole('textbox'),
      [
        '<p>Hallo <span data-type="mention" data-id="u_mara" data-label="mara">@mara</span>',
        ' <span data-type="reference" data-id="wi_web_47" data-kind="item"></span>',
        ' <span data-type="attachment" data-attachment-id="01jattachmentfile0000000000">angebot.pdf</span></p>',
        '<img data-attachment-id="01jattachmentimage000000000" alt="Formular">',
        '<p><img src="https://example.com/tracker.png" alt="extern"></p>',
      ].join(''),
    );
    const doc = lastDoc(onChange);
    expect(nodesOf(doc, 'mention').map((node) => node.attrs)).toEqual([{ id: 'u_mara', label: 'mara', mentionSuggestionChar: '@' }]);
    expect(nodesOf(doc, 'reference').map((node) => node.attrs)).toEqual([{ id: 'wi_web_47', label: null, mentionSuggestionChar: '#', kind: 'item' }]);
    expect(nodesOf(doc, 'attachment').map((node) => node.attrs)).toEqual([{ attachmentId: '01jattachmentfile0000000000', filename: 'angebot.pdf' }]);
    expect(nodesOf(doc, 'image').map((node) => node.attrs)).toEqual([{ attachmentId: '01jattachmentimage000000000', alt: 'Formular' }]);
    // the text of the nodes, as Document::toText reads it
    expect(editorRef.current!.getText()).toContain('Hallo @mara  angebot.pdf');
  });

  it('counts mentions, references, images and files as content', () => {
    expect(isEmptyDoc(paragraph(mention('u_mara', 'mara')))).toBe(false);
    expect(isEmptyDoc(paragraph(reference('wi_web_47')))).toBe(false);
    expect(isEmptyDoc(paragraph({ type: 'attachment', attrs: { attachmentId: 'a', filename: 'f' } }))).toBe(false);
    expect(isEmptyDoc({ type: 'doc', content: [{ type: 'image', attrs: { attachmentId: 'a', alt: null } }] })).toBe(false);
  });

  it('keeps mentions, references and files of a text in a level that lacks their block', async () => {
    renderWithData(
      <RichTextEditor value={{ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(mention('u_mara', 'mara')).content![0]] }] }] }] }} onChange={vi.fn()} preset="comment" />,
      { 'GET /api/v1/users': () => ({ body: list([mara]) }) },
    );
    // the table goes, the mention stays in a paragraph
    await waitFor(() => expect(screen.getByRole('textbox').querySelector('p .rt-mention')?.textContent).toBe('@mara'));
  });
});

describe('LateBoundary', () => {
  /** An outer boundary like the page's: shows what it caught. */
  class Outer extends Component<{ children: ReactNode }, { caught: string | null }> {
    state = { caught: null as string | null };
    static getDerivedStateFromError(error: Error) {
      return { caught: error.message };
    }
    render() {
      return this.state.caught === null ? this.props.children : <p>Seite: {this.state.caught}</p>;
    }
  }
  const Throwing = ({ error }: { error: Error }): ReactNode => {
    throw error;
  };

  it('takes on a chunk that did not load and leaves every other error to the page (F23)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const frame = (inside: ReactNode) => <div>{inside}</div>;
    const { unmount } = render(
      <Outer>
        <LateBoundary frame={frame}>
          <Throwing error={new Error('Knotenansicht kaputt')} />
        </LateBoundary>
      </Outer>,
    );
    expect(screen.getByText('Seite: Knotenansicht kaputt')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();

    render(
      <Outer>
        <LateBoundary frame={frame}>
          <Throwing error={new LateChunkError(new Error('offline'))} />
        </LateBoundary>
      </Outer>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Der Editor ließ sich nicht laden.Erneut versuchen');
    // reported, not swallowed
    expect(console.error).toHaveBeenCalledWith(expect.any(LateChunkError));
  });
});

describe('a parent that holds the document', () => {
  it('resets when the parent passes null later', async () => {
    const user = userEvent.setup();
    // a parent that renders what the editor reported only when the test says so, oldest first (a slow parent)
    const reported: Array<RichText | null> = [];
    let show: (doc: RichText | null) => void = () => {};
    function Controlled() {
      const [doc, setDoc] = useState<RichText | null>(null);
      show = setDoc;
      return <RichTextEditor value={doc} onChange={(next) => reported.push(next)} preset="comment" autoFocus />;
    }
    render(<Controlled />);
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    await waitFor(() => expect(document.activeElement).toBe(editor));

    // typed, emptied (the editor reports null) and typed again before the parent caught up
    await user.keyboard('weg');
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await user.keyboard('neu');
    expect(reported.slice(3, 4)).toEqual([null]);

    // the parent renders the old reports late, the null among them: nothing typed is lost
    for (const doc of reported.splice(0)) act(() => show(doc));
    expect(editor.textContent).toBe('neu');

    // after the parent took the newer text, a null is its own (sent, discarded) and empties the editor
    act(() => show(null));
    expect(editor.textContent).toBe('');
    expect(editor.querySelectorAll('p')).toHaveLength(1);
  });
});
