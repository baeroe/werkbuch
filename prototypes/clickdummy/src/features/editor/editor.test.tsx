import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/api/db';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { textDoc } from '@/lib/richtext';
import { asUser, resetApi } from '@/test/api';
import type { RichText } from '@/types';
import { preloadEditor, RichTextEditor } from './RichTextEditor';

// jsdom has no layout: ProseMirror measures the selection to scroll it into view, Floating UI the popup
beforeAll(async () => {
  // the table support is a chunk of its own; loaded once here, so no editor waits for it
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

beforeEach(() => resetApi());

afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The nodes of a type in a document, depth first. */
function nodesOf(doc: RichText | undefined, type: string): RichText[] {
  if (!doc) return [];
  return [...(doc.type === type ? [doc] : []), ...(doc.content ?? []).flatMap((child: RichText) => nodesOf(child, type))];
}

const lastDoc = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.lastCall?.[0] as RichText | undefined;

describe('RichTextEditor', () => {
  it('typing "@ma" lists Mara Lindqvist and inserts a mention node with id u_mara', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" projectId="p_web" />);

    const editor = await screen.findByRole('textbox', { name: 'Kommentar' });
    await user.click(editor);
    await user.type(editor, '@ma');

    const option = await screen.findByRole('option', { name: /Mara Lindqvist/ });
    // the editor names the open list and its active entry, the focus stays in the text
    expect(editor.getAttribute('aria-controls')).toBe(screen.getByRole('listbox', { name: 'Personen und Bots' }).id);
    expect(editor.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(document.activeElement).toBe(editor);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'mention').map((node) => node.attrs?.id)).toEqual(['u_mara']));
    expect(nodesOf(lastDoc(onChange), 'mention')[0].attrs?.label).toBe('mara');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(editor.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('pasting an image file inserts an image node whose attachment id comes from uploadAttachment', async () => {
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={textDoc('Screenshot:')} onChange={onChange} preset="description" projectId="p_web" />);
    const editor = await screen.findByRole('textbox', { name: 'Beschreibung' });
    const before = getDb().attachments.length;

    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'skizze.png', { type: 'image/png' });
    fireEvent.paste(editor, { clipboardData: { files: [file], types: ['Files'], getData: () => '' } });

    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'image')).toHaveLength(1));
    const stored = getDb().attachments;
    expect(stored).toHaveLength(before + 1);
    const uploaded = stored.at(-1)!;
    expect([uploaded.filename, uploaded.kind, uploaded.owner]).toEqual(['skizze.png', 'inline', null]);
    const [image] = nodesOf(lastDoc(onChange), 'image');
    expect(image.attrs?.attachmentId).toBe(uploaded.id);
    // the editor keeps the attachment's id only, never a path or the file itself
    expect(JSON.stringify(lastDoc(onChange))).not.toMatch(/data:|base64/);
  });

  it('mod+enter calls onSubmit and does not insert a line break', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    renderWithData(<RichTextEditor value={textDoc('Sieht gut aus')} onChange={onChange} onSubmit={onSubmit} preset="comment" projectId="p_web" />);

    const editor = await screen.findByRole('textbox', { name: 'Kommentar' });
    await user.click(editor);
    // jsdom is no Mac: mod is the Control key
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(editor.querySelectorAll('p')).toHaveLength(1);
    expect(editor.querySelector('br')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the / menu', () => {
  it('offers the blocks of the level, and "Bild" uploads the chosen file into the text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="description" projectId="p_web" />);
    const editor = await screen.findByRole('textbox', { name: 'Beschreibung' });
    await user.click(editor);
    await user.type(editor, '/');

    const menu = await screen.findByRole('listbox', { name: 'Blöcke' });
    // a description has headings and checklists; tables only on wiki pages
    // each entry: icon, label, Markdown shortcut
    expect(within(menu).getAllByRole('option').map((option) => option.children[1]?.textContent)).toEqual([
      'Überschrift',
      'Liste',
      'Nummerierte Liste',
      'Checkliste',
      'Code',
      'Zitat',
      'Bild',
    ]);

    await user.type(editor, 'bild');
    await user.keyboard('{Enter}');
    // the browser's file choice: the editor asks with a file input and takes what is chosen
    const input = document.querySelector<HTMLInputElement>('input[type="file"][name="inline-files"]');
    expect(input).not.toBeNull();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'skizze.png', { type: 'image/png' });
    Object.defineProperty(input!, 'files', { value: [file] });
    fireEvent.change(input!);

    await waitFor(() => expect(nodesOf(lastDoc(onChange), 'image')).toHaveLength(1));
    expect(nodesOf(lastDoc(onChange), 'image')[0].attrs?.attachmentId).toBe(getDb().attachments.at(-1)!.id);
  });
});

describe('Escape in the editor', () => {
  it('goes on to the page (a preview leaves the field), but an open list uses it up and closes', async () => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    const record = (event: KeyboardEvent) => event.key === 'Escape' && seen.push(event.defaultPrevented);
    window.addEventListener('keydown', record);
    try {
      renderWithData(<RichTextEditor value={null} onChange={vi.fn()} preset="comment" projectId="p_web" />);
      const editor = await screen.findByRole('textbox', { name: 'Kommentar' });
      await user.click(editor);
      await user.type(editor, 'Hallo');
      // ProseMirror reads the legacy keyCode (27) and would use up every Escape: the page's shortcuts must see it
      const escape = () => fireEvent.keyDown(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
      escape();
      expect(seen).toEqual([false]);

      await user.type(editor, ' @ma');
      await screen.findByRole('listbox', { name: 'Personen und Bots' });
      act(() => void escape());
      expect(seen).toEqual([false, true]);
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    } finally {
      window.removeEventListener('keydown', record);
    }
  });
});

describe('RichTextEditor as a viewer', () => {
  it('keeps a viewer out of uploads: nothing is stored when the project only lets them read', async () => {
    asUser('u_theo');
    const onChange = vi.fn();
    renderWithData(<RichTextEditor value={null} onChange={onChange} preset="comment" projectId="p_web" />);
    const editor = await screen.findByRole('textbox', { name: 'Kommentar' });
    const before = getDb().attachments.length;

    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
    fireEvent.paste(editor, { clipboardData: { files: [file], types: ['Files'], getData: () => '' } });

    // the refusal is a toast with the cause; no node, no placeholder left behind
    await waitFor(() => expect(currentToasts().some((item) => item.tone === 'error')).toBe(true));
    expect(getDb().attachments).toHaveLength(before);
    expect(nodesOf(lastDoc(onChange), 'image')).toHaveLength(0);
    expect(editor.querySelector('[data-upload]')).toBeNull();
  });
});
