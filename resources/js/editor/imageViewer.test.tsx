/*
 * The large view of the pictures of a text and the menu of a picture in an editor (WEBU-7): the store, the viewer the
 * shell holds (counter, ←/→, actual size, links, the focus back) and the menu (Alt+F10, its entries, a picture in a
 * table cell). The attachments come from a fake REST API.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { makeAttachment } from '@/test/fixtures';
import type { RichText } from '@/types';
import { ImageViewerHost } from './ImageViewer';
import { closeImageViewer, imagesOf, openImageViewer, showImage, viewerNow, viewImageAt } from './imageViewer';
import { preloadEditor, RichTextEditor } from './RichTextEditor';

let api: MockApi | undefined;

beforeAll(async () => {
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

afterEach(() => {
  act(() => closeImageViewer());
  api?.restore();
  api = undefined;
  vi.restoreAllMocks();
});

const first = makeAttachment({ id: 'att_1', filename: 'formular.png' });
const second = makeAttachment({ id: 'att_2', filename: 'mail.png' });
const routes = {
  'GET /api/v1/attachments/att_1': () => ({ body: { data: first } }),
  'GET /api/v1/attachments/att_2': () => ({ body: { data: second } }),
  'GET /api/v1/attachments/att_gone': () => ({ status: 404, body: { status: 404, reason: 'not_found' } }),
};

function renderHost() {
  api = mockApi(routes);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <button type="button">Bild im Text</button>
      <ImageViewerHost />
    </QueryClientProvider>,
  );
}

describe('the store', () => {
  it('opens at an index within the list, shows another and closes; nothing without pictures', () => {
    openImageViewer([], 0);
    expect(viewerNow()).toBeNull();

    const images = [
      { attachmentId: 'att_1', alt: 'Formular' },
      { attachmentId: 'att_2', alt: null },
    ];
    openImageViewer(images, 7);
    expect(viewerNow()?.index).toBe(1);
    openImageViewer(images, -2);
    expect(viewerNow()?.index).toBe(0);
    const before = viewerNow();
    showImage(0);
    showImage(-1);
    showImage(2);
    expect(viewerNow()).toBe(before);
    showImage(1);
    expect(viewerNow()?.index).toBe(1);
    closeImageViewer();
    closeImageViewer();
    expect(viewerNow()).toBeNull();
    showImage(0);
    expect(viewerNow()).toBeNull();
  });

  it('reads the pictures of a document in their order, with their positions, an empty alt as none', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'text*' },
        image: { group: 'block', attrs: { attachmentId: { default: null }, alt: { default: null } } },
        text: {},
      },
    });
    const doc = schema.node('doc', null, [
      schema.node('image', { attachmentId: 'att_1', alt: 'Formular' }),
      schema.node('paragraph', null, [schema.text('Text')]),
      schema.node('image', { attachmentId: null, alt: 'ohne Anhang' }),
      schema.node('image', { attachmentId: 'att_2', alt: '' }),
    ]);

    expect(imagesOf(doc)).toEqual([
      { attachmentId: 'att_1', alt: 'Formular', pos: 0 },
      { attachmentId: 'att_2', alt: null, pos: 8 },
    ]);
    viewImageAt(doc, 8, null);
    expect(viewerNow()).toMatchObject({ index: 1, images: [{ attachmentId: 'att_1' }, { attachmentId: 'att_2' }] });
  });
});

describe('the large view', () => {
  it('goes through the pictures with the arrows and its buttons, and gives the focus back on close', async () => {
    const user = userEvent.setup();
    renderHost();
    const origin = screen.getByRole('button', { name: 'Bild im Text' });
    act(() =>
      openImageViewer(
        [
          { attachmentId: 'att_1', alt: 'Formular' },
          { attachmentId: 'att_2', alt: null },
        ],
        0,
        origin,
      ),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Formular' });
    expect(within(dialog).getByText('Bild 1 von 2')).toBeTruthy();
    expect(await within(dialog).findByRole('img', { name: 'Formular' })).toHaveProperty('src', expect.stringContaining('/attachments/att_1'));
    expect(within(dialog).getByRole('button', { name: 'Vorheriges Bild' }).getAttribute('aria-disabled')).toBe('true');

    // a key with a modifier stays where it is; → goes on, the file name names a picture without alt
    fireEvent.keyDown(document, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(viewerNow()?.index).toBe(0);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog', { name: 'mail.png' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nächstes Bild' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(viewerNow()?.index).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Vorheriges Bild' }));
    expect(await screen.findByRole('dialog', { name: 'Formular' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(viewerNow()?.index).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Nächstes Bild' }));
    await waitFor(() => expect(viewerNow()?.index).toBe(1));

    // actual size by the button and by a click on the picture; links to the original and to download it
    const size = screen.getByRole('button', { name: 'Originalgröße' });
    expect(size.getAttribute('aria-pressed')).toBe('false');
    await user.click(size);
    expect(size.getAttribute('aria-pressed')).toBe('true');
    // without an alternative text the picture has no name (it reads as decoration): found as the element
    fireEvent.click(screen.getByRole('dialog').querySelector('img')!);
    expect(size.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('link', { name: 'Original öffnen' })).toMatchObject({ target: '_blank' });
    expect(screen.getByRole('link', { name: 'Herunterladen' }).getAttribute('href')).toBe('/attachments/att_2?download=1');
    expect(screen.getByRole('dialog').querySelector('figcaption')?.textContent).toBe('mail.png');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(viewerNow()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(origin));
    // closed, the arrows are the page's again
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(viewerNow()).toBeNull();
  });

  it('leaves the keys of anything above it alone, and closes on a visit to another page (palette, review of #47)', async () => {
    renderHost();
    act(() =>
      openImageViewer(
        [
          { attachmentId: 'att_1', alt: 'Formular' },
          { attachmentId: 'att_2', alt: null },
        ],
        0,
      ),
    );
    await screen.findByRole('dialog', { name: 'Formular' });
    // a field of a popup above the viewer (the palette) keeps its keys
    const field = document.createElement('input');
    document.body.append(field);
    fireEvent.keyDown(field, { key: 'ArrowRight' });
    expect(viewerNow()?.index).toBe(0);
    field.remove();
    // the focus nowhere (on the page itself): the viewer's keys
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(viewerNow()?.index).toBe(1);

    act(() => void document.dispatchEvent(new CustomEvent('inertia:navigate', { detail: { page: { url: '/my-items' } } })));
    expect(viewerNow()).toBeNull();
  });

  it('shows one picture without counter and buttons, and says when it is gone or loading', async () => {
    renderHost();
    act(() => openImageViewer([{ attachmentId: 'att_gone', alt: 'Weg' }], 0));
    const dialog = await screen.findByRole('dialog', { name: 'Weg' });
    expect(within(dialog).getByText('Bild wird geladen …')).toBeTruthy();
    expect(await within(dialog).findByText('Bild nicht verfügbar')).toBeTruthy();
    expect(within(dialog).queryByText(/von/)).toBeNull();
    expect(within(dialog).queryByRole('link')).toBeNull();
    // neither alt nor a file: a picture; × closes
    act(() => openImageViewer([{ attachmentId: 'att_gone', alt: null }], 0));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Bild' })).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(viewerNow()).toBeNull());
  });
});

describe('the menu of a picture', () => {
  const twoPictures: RichText = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { attachmentId: 'att_1', alt: 'Formular' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Danach' }] },
      { type: 'image', attrs: { attachmentId: 'att_2', alt: 'Mail' } },
    ],
  };

  function renderEditor(value: RichText, readOnly = false) {
    api = mockApi(routes);
    const editorRef = createRef<Editor | null>();
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RichTextEditor value={value} onChange={onChange} preset="description" projectId="p_web" editorRef={editorRef} readOnly={readOnly} />
        <ImageViewerHost />
      </QueryClientProvider>,
    );
    return { editorRef, onChange, editor: screen.getByRole('textbox', { name: 'Beschreibung' }) };
  }

  it('opens with Alt+F10 on a selected picture: large view, original, download, remove', async () => {
    const user = userEvent.setup();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const downloads: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    const { editorRef, editor, onChange } = renderEditor(twoPictures);
    await screen.findByRole('img', { name: 'Mail' });

    // no picture selected (the cursor in the text): no tab, and Alt+F10 does nothing here
    act(() => void editorRef.current!.commands.setTextSelection(4));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bild bearbeiten' })).toBeNull());
    fireEvent.keyDown(editor, { key: 'F10', altKey: true });
    expect(screen.queryByRole('menu')).toBeNull();

    const position = imagesOf(editorRef.current!.state.doc).find((image) => image.attachmentId === 'att_2')!.pos;
    act(() => void editorRef.current!.commands.setNodeSelection(position));
    expect(await screen.findByRole('button', { name: 'Bild bearbeiten' })).toBeTruthy();
    // with another modifier the key is not the menu's
    fireEvent.keyDown(editor, { key: 'F10', altKey: true, shiftKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(editor, { key: 'F10', altKey: true });
    const view = await screen.findByRole('menuitem', { name: 'Groß anzeigen' });
    await waitFor(() => expect(document.activeElement).toBe(view));
    await user.click(view);
    // the large view starts at the second picture of the text
    expect(await screen.findByRole('dialog', { name: 'Mail' })).toBeTruthy();
    expect(screen.getByText('Bild 2 von 2')).toBeTruthy();
    act(() => closeImageViewer());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => void editorRef.current!.commands.setNodeSelection(position));
    await user.click(await screen.findByRole('button', { name: 'Bild bearbeiten' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Original in neuem Tab öffnen' }).getAttribute('aria-disabled')).not.toBe('true'));
    await user.click(screen.getByRole('menuitem', { name: 'Original in neuem Tab öffnen' }));
    expect(opened).toHaveBeenCalledWith('/attachments/att_2', '_blank', 'noopener');

    act(() => void editorRef.current!.commands.setNodeSelection(position));
    await user.click(await screen.findByRole('button', { name: 'Bild bearbeiten' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Herunterladen' }));
    expect(downloads).toEqual([{ href: '/attachments/att_2?download=1', download: 'mail.png' }]);

    act(() => void editorRef.current!.commands.setNodeSelection(position));
    await user.click(await screen.findByRole('button', { name: 'Bild bearbeiten' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Bild entfernen' }));
    await waitFor(() => expect(JSON.stringify(onChange.mock.lastCall?.[0])).not.toContain('att_2'));
    expect(document.querySelector('[data-editor-announcer]')?.textContent).toBe('Bild entfernt');
  });

  it('offers no menu read-only', async () => {
    const { editorRef } = renderEditor(twoPictures, true);
    await screen.findByRole('img', { name: 'Mail' });
    act(() => void editorRef.current!.commands.setNodeSelection(0));
    expect(screen.queryByRole('button', { name: 'Bild bearbeiten' })).toBeNull();
  });

  it('opens its own menu for a picture in a table cell, not the table menu', async () => {
    const cell = { type: 'tableCell', content: [{ type: 'image', attrs: { attachmentId: 'att_1', alt: 'Formular' } }] };
    const { editorRef, editor } = renderEditor({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell] }] }] });
    await screen.findByRole('img', { name: 'Formular' });
    act(() => void editorRef.current!.commands.setNodeSelection(imagesOf(editorRef.current!.state.doc)[0]!.pos));
    fireEvent.keyDown(editor, { key: 'F10', altKey: true });
    expect(await screen.findByRole('menuitem', { name: 'Groß anzeigen' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Zeile darüber einfügen' })).toBeNull();
  });

  it('lets the file entries wait until the attachment is there', async () => {
    const user = userEvent.setup();
    const { editorRef } = renderEditor({ type: 'doc', content: [{ type: 'image', attrs: { attachmentId: 'att_gone', alt: 'Weg' } }, { type: 'paragraph' }] });
    act(() => void editorRef.current!.commands.setNodeSelection(0));
    await user.click(await screen.findByRole('button', { name: 'Bild bearbeiten' }));
    const open = await screen.findByRole('menuitem', { name: 'Original in neuem Tab öffnen' });
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Herunterladen' }).getAttribute('aria-disabled')).toBe('true');
  });
});
