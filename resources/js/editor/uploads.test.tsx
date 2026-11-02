import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { createRef, useState, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { formatSize } from '@/components/fields/format';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { makeAttachment } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { Attachment, RichText } from '@/types';
import { EditorEnvContext, type EditorEnv } from './EditorEnv';
import { preloadEditor, RichTextEditor } from './RichTextEditor';
import { RichTextView } from './RichTextView';
import { UploadContext, useUploadCounter, useUploadsPending } from './UploadContext';

// jsdom has no layout: ProseMirror measures the selection to scroll it into view
beforeAll(async () => {
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

let api: MockApi | null = null;
beforeEach(() => {
  installFakeXhr();
  resetToasts();
});
afterEach(() => {
  api?.restore();
  api = null;
  restoreFakeXhr();
  vi.restoreAllMocks();
});

const png = (name = 'screenshot.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
const pdf = (name = 'angebot.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

const picture = makeAttachment();
const offer = makeAttachment({ id: 'att_2', filename: 'angebot.pdf', mime: 'application/pdf', inline: false, size: 120_400 });

/** The nodes of a type in a document, depth first. */
function nodesOf(doc: RichText | null | undefined, type: string): RichText[] {
  if (!doc) return [];
  return [...(doc.type === type ? [doc] : []), ...(doc.content ?? []).flatMap((child: RichText) => nodesOf(child, type))];
}

/** How many uploads the form around the editor counts. */
function Pending() {
  return <output aria-label="Uploads">{useUploadsPending()}</output>;
}

interface Setup {
  value?: RichText | null;
  projectId?: string;
  context?: Partial<Pick<EditorEnv, 'onUploadError' | 'onOrphanedUploads'>>;
  routes?: Record<string, MockRoute>;
}

/** An editable description of WEB in a form that counts its uploads; `hide()` takes the editor away, the form stays. */
function renderEditor({ value = null, projectId = 'p_web', context = {}, routes = {} }: Setup = {}) {
  api = mockApi(routes);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });
  const editorRef = createRef<Editor | null>();
  const onChange = vi.fn();
  let hide: () => void = () => {};

  function Form({ children }: { children: ReactNode }) {
    const counter = useUploadCounter();
    const [shown, setShown] = useState(true);
    hide = () => setShown(false);
    return (
      <UploadContext value={counter}>
        {shown && children}
        <Pending />
      </UploadContext>
    );
  }

  const utils = render(
    <QueryClientProvider client={client}>
      <EditorEnvContext value={context}>
        <Form>
          <RichTextEditor value={value} onChange={onChange} preset="description" projectId={projectId} editorRef={editorRef} />
        </Form>
      </EditorEnvContext>
    </QueryClientProvider>,
  );
  const editor = screen.getByRole('textbox', { name: 'Beschreibung' });
  return { ...utils, client, editor, editorRef, onChange, hide: () => act(() => hide()), lastDoc: () => onChange.mock.lastCall?.[0] as RichText | null };
}

/** Pastes files the way a browser hands them over (jsdom knows no ClipboardEvent). */
const pasteFiles = (target: HTMLElement, files: File[], html = '') =>
  fireEvent.paste(target, {
    clipboardData: { types: html ? ['text/html', 'Files'] : ['Files'], files, getData: (type: string) => (type === 'text/html' ? html : '') },
  });

/** Answers an upload with the attachment the server stored. */
const answer = (xhr: FakeXhr, attachment: Attachment) =>
  act(async () => {
    xhr.answer(201, { data: attachment });
  });

const pending = () => screen.getByRole('status', { name: 'Uploads' });

describe('uploads in the editor', () => {
  it('pastes an image and shows its progress, then the image', async () => {
    const { editor, lastDoc } = renderEditor();

    pasteFiles(editor, [png()]);
    const xhr = FakeXhr.last;
    expect(xhr.opened).toEqual(['POST', '/api/v1/attachments']);
    expect(xhr.sent?.get('project_id')).toBe('p_web');
    expect(xhr.sent?.get('kind')).toBe('inline');
    // an upload into a text names no owner: saving the text links it (A232)
    expect(xhr.sent?.has('work_item_id')).toBe(false);

    const bar = screen.getByRole('progressbar', { name: 'Bild „screenshot.png“ wird hochgeladen …' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(pending().textContent).toBe('1');
    act(() => xhr.progress(50, 100));
    expect(bar.getAttribute('aria-valuenow')).toBe('50');

    await answer(xhr, picture);
    expect(screen.queryByRole('progressbar')).toBeNull();
    const image = await screen.findByRole('img', { name: 'screenshot.png' });
    expect(image.getAttribute('src')).toBe('/attachments/att_1');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(nodesOf(lastDoc(), 'image').map((node) => node.attrs)).toEqual([{ attachmentId: 'att_1', alt: 'screenshot.png' }]);
    expect(pending().textContent).toBe('0');
  });

  it('drops two files and uploads both', async () => {
    const { editor, editorRef, lastDoc } = renderEditor({ value: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Anbei:' }] }] } });
    // jsdom has no layout: the drop lands at the end of the text
    editorRef.current!.view.posAtCoords = () => ({ pos: 7, inside: -1 });

    fireEvent.drop(editor, { clientX: 10, clientY: 10, dataTransfer: { types: ['Files'], files: [png(), pdf()], getData: () => '' } });
    expect(FakeXhr.all).toHaveLength(2);
    expect(screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Bild „screenshot.png“ wird hochgeladen …',
      'Datei „angebot.pdf“ wird hochgeladen …',
    ]);
    expect(pending().textContent).toBe('2');

    await answer(FakeXhr.all[1], offer);
    await answer(FakeXhr.all[0], picture);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(nodesOf(lastDoc(), 'image')).toHaveLength(1);
    expect(nodesOf(lastDoc(), 'attachment')).toHaveLength(1);
    expect(pending().textContent).toBe('0');
  });

  it('makes a file chip of a PDF', async () => {
    const { editor, lastDoc } = renderEditor();
    pasteFiles(editor, [pdf()]);
    await answer(FakeXhr.last, offer);

    const link = await screen.findByRole('link', { name: 'angebot.pdf' });
    expect(link.getAttribute('href')).toBe('/attachments/att_2?download=1');
    expect(link.closest('.rt-file')?.textContent).toBe(`angebot.pdf${formatSize(120_400)}`);
    expect(nodesOf(lastDoc(), 'attachment').map((node) => node.attrs)).toEqual([{ attachmentId: 'att_2', filename: 'angebot.pdf' }]);
  });

  it('removes the placeholder and reports a 413', async () => {
    const onUploadError = vi.fn();
    const { editor, lastDoc } = renderEditor({ context: { onUploadError } });
    const file = png('gross.png');
    pasteFiles(editor, [file]);
    act(() => FakeXhr.last.answer(413, { status: 413, reason: 'payload_too_large', detail: 'Dateien dürfen höchstens 25 MB groß sein.' }));

    await waitFor(() => expect(onUploadError).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('progressbar')).toBeNull();
    const [reported, error] = onUploadError.mock.lastCall as [File, ApiError];
    expect(reported).toBe(file);
    expect(error).toMatchObject({ status: 413, message: 'Dateien dürfen höchstens 25 MB groß sein.' });
    expect(nodesOf(lastDoc(), 'image')).toEqual([]);
    expect(pending().textContent).toBe('0');
  });

  it('says a failed upload in a toast and tries it again at the same place', async () => {
    const { editor, lastDoc } = renderEditor();
    pasteFiles(editor, [png()]);
    act(() => FakeXhr.last.answer(413, { status: 413, reason: 'payload_too_large', detail: 'Dateien dürfen höchstens 25 MB groß sein.' }));

    // the sentence of the server names the limit; a refusal is not offered again
    await waitFor(() => expect(currentToasts()).toHaveLength(1));
    expect(currentToasts()[0]).toMatchObject({ title: '„screenshot.png“ nicht hochgeladen', description: 'Dateien dürfen höchstens 25 MB groß sein.', tone: 'error', action: undefined });

    // without an answer the toast offers to try again
    resetToasts();
    pasteFiles(editor, [png()]);
    act(() => FakeXhr.last.onerror?.());
    await waitFor(() => expect(currentToasts()).toHaveLength(1));
    act(() => runToastAction(currentToasts()[0].id));
    expect(FakeXhr.all).toHaveLength(3);
    await answer(FakeXhr.last, picture);
    await waitFor(() => expect(nodesOf(lastDoc(), 'image')).toHaveLength(1));
  });

  it('aborts running uploads when the editor goes away', async () => {
    const onUploadError = vi.fn();
    const onOrphanedUploads = vi.fn();
    const { editor, hide } = renderEditor({ context: { onUploadError, onOrphanedUploads } });
    pasteFiles(editor, [png()]);
    const xhr = FakeXhr.last;
    expect(pending().textContent).toBe('1');

    hide();
    expect(xhr.abort).toHaveBeenCalled();
    await waitFor(() => expect(pending().textContent).toBe('0'));
    // stopped on purpose: nothing to report
    expect(onUploadError).not.toHaveBeenCalled();
    expect(onOrphanedUploads).not.toHaveBeenCalled();
  });

  it('reports uploads whose nodes left the text', async () => {
    const onOrphanedUploads = vi.fn();
    const { editor, editorRef, hide } = renderEditor({ context: { onOrphanedUploads } });
    pasteFiles(editor, [png()]);
    await answer(FakeXhr.last, picture);
    pasteFiles(editor, [pdf()]);
    await answer(FakeXhr.last, offer);
    await screen.findByRole('link', { name: 'angebot.pdf' });

    // the image goes again, the file stays
    act(() => {
      editorRef.current!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'attachment', attrs: { attachmentId: 'att_2', filename: 'angebot.pdf' } }] }] });
    });
    hide();
    expect(onOrphanedUploads).toHaveBeenCalledExactlyOnceWith(['att_1']);
  });

  it('ignores pasted images from the web', () => {
    const { editor, lastDoc } = renderEditor();
    // a browser copying from a page hands over its HTML and the picture: the HTML is pasted, the picture not uploaded
    pasteFiles(editor, [png('logo.png')], '<p>Von der Seite <img src="https://example.com/logo.png" alt="Logo"></p>');
    expect(FakeXhr.all).toEqual([]);
    expect(lastDoc()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Von der Seite' }] }] });
  });

  it('uploads nothing without a project', () => {
    api = mockApi({});
    const client = new QueryClient();
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <RichTextEditor value={null} onChange={onChange} preset="comment" />
      </QueryClientProvider>,
    );
    const editor = screen.getByRole('textbox', { name: 'Kommentar' });
    pasteFiles(editor, [png()]);
    fireEvent.drop(editor, { clientX: 1, clientY: 1, dataTransfer: { types: ['Files'], files: [png()], getData: () => '' } });
    expect(FakeXhr.all).toEqual([]);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('chooses files over the / menu', async () => {
    const user = userEvent.setup();
    const { editor, lastDoc } = renderEditor();
    const chosen: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      chosen.push(this);
    });

    await user.click(editor);
    await user.keyboard('/bild');
    const list = await screen.findByRole('listbox', { name: 'Blöcke' });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['Bild oder Datei']);
    await user.keyboard('{Enter}');

    const input = chosen[0];
    expect(input).toMatchObject({ type: 'file', multiple: true });
    expect(input.isConnected).toBe(true);
    Object.defineProperty(input, 'files', { value: [pdf()] });
    fireEvent.change(input);
    expect(input.isConnected).toBe(false);
    await answer(FakeXhr.last, offer);
    expect(nodesOf(lastDoc(), 'attachment')).toHaveLength(1);

    // closing the choice without a file leaves nothing behind
    await user.keyboard('/bild{Enter}');
    expect(chosen[1].isConnected).toBe(true);
    fireEvent(chosen[1], new Event('cancel'));
    expect(chosen[1].isConnected).toBe(false);
    expect(FakeXhr.all).toHaveLength(1);
  });
});

describe('images and files in a text', () => {
  const withImage: RichText = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { attachmentId: 'att_1', alt: 'Formular' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Danach' }] },
    ],
  };
  const pictureRoute = { 'GET /api/v1/attachments/att_1': () => ({ body: { data: picture } }) };

  it('lets a reader edit the alt text of an image', async () => {
    const user = userEvent.setup();
    const { editor, editorRef, lastDoc } = renderEditor({ value: withImage, routes: pictureRoute });
    await screen.findByRole('img', { name: 'Formular' });

    // Enter on the selected image opens its alternative text
    act(() => void editorRef.current!.commands.setNodeSelection(0));
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 13 });
    const field = await screen.findByRole('textbox', { name: 'Alternativtext' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field).toHaveProperty('value', 'Formular');
    expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('Beschreibt das Bild für alle, die es nicht sehen. Enter speichert, Escape bricht ab.');
    await user.clear(field);
    await user.type(field, 'Formular der Anmeldung{Enter}');
    expect(screen.queryByRole('textbox', { name: 'Alternativtext' })).toBeNull();
    expect(nodesOf(lastDoc(), 'image')[0].attrs).toEqual({ attachmentId: 'att_1', alt: 'Formular der Anmeldung' });
    await waitFor(() => expect(document.activeElement).toBe(editor));

    // a double click opens it as well; Escape leaves the text as it was
    await user.dblClick(screen.getByRole('img', { name: 'Formular der Anmeldung' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Alternativtext' })));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Alternativtext' })).toBeNull();
    expect(nodesOf(lastDoc(), 'image')[0].attrs?.alt).toBe('Formular der Anmeldung');

    // emptied it is no alternative text at all; leaving the field keeps what was typed
    await user.dblClick(screen.getByRole('img'));
    await user.clear(await screen.findByRole('textbox', { name: 'Alternativtext' }));
    await user.tab();
    expect(nodesOf(lastDoc(), 'image')[0].attrs?.alt).toBeNull();

    // Enter elsewhere stays a line break
    act(() => void editorRef.current!.commands.setTextSelection(editorRef.current!.state.doc.content.size - 1));
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(screen.queryByRole('textbox', { name: 'Alternativtext' })).toBeNull();
    expect(lastDoc()?.content?.map((node) => node.type)).toEqual(['image', 'paragraph', 'paragraph']);
  });

  it('opens the original in a new tab while reading and shows the preview when there is one', async () => {
    api = mockApi({ 'GET /api/v1/attachments/att_1': () => ({ body: { data: { ...picture, preview_url: '/attachments/att_1/preview' } } }) });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RichTextView value={withImage} preset="comment" />
      </QueryClientProvider>,
    );
    const image = await screen.findByRole('img', { name: 'Formular' });
    expect(image.getAttribute('src')).toBe('/attachments/att_1/preview');
    const link = screen.getByRole('link', { name: 'Formular' });
    expect(link.getAttribute('href')).toBe('/attachments/att_1');
    expect(link).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });

    // a reader cannot change the alternative text
    fireEvent.doubleClick(image);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says when an image is not available', async () => {
    renderEditor({ value: withImage, routes: { 'GET /api/v1/attachments/att_1': () => ({ status: 404, body: { status: 404, reason: 'not_found' } }) } });
    expect(screen.getByText('Formular: Bild wird geladen …').isConnected).toBe(true);
    expect((await screen.findByText('Formular: Bild nicht verfügbar')).isConnected).toBe(true);
  });

  it('says so when the picture itself does not load', async () => {
    renderEditor({ value: withImage, routes: pictureRoute });
    fireEvent.error(await screen.findByRole('img', { name: 'Formular' }));
    expect(screen.getByText('Formular: Bild nicht verfügbar').isConnected).toBe(true);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('names a file before its record is there and without one', async () => {
    renderEditor({
      value: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'attachment', attrs: { attachmentId: 'att_2', filename: null } }] }],
      },
      routes: { 'GET /api/v1/attachments/att_2': () => ({ status: 404, body: { status: 404, reason: 'not_found' } }) },
    });
    expect((await screen.findByText('Datei')).isConnected).toBe(true);
    await waitFor(() => expect(api?.calls).toHaveLength(1));
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('formatSize', () => {
  it('reads bytes, kilobytes and megabytes', () => {
    expect(formatSize(512)).toBe('512 Byte');
    expect(formatSize(120_400)).toBe('120 kB');
    expect(formatSize(25_300_000)).toBe('25,3 MB');
  });
});
