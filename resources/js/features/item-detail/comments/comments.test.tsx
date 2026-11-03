/*
 * Comments against a fake REST API (`mockApi`).
 * - The composer: m opens it and mod+enter sends; what fails stays in the editor, what is typed while sending stays as
 *   the draft, a draft outlives the view, uploads hold the send back, and an archived item says why there is none.
 * - The cards in the activity: editing an own comment, the menu by the rights, deleting with undo, and reactions.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { commentDraft, commentEditDraft, drafts } from '@/lib/drafts';
import { plainText } from '@/lib/richtext';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, labels, lene, list, makeAttachment, makeComment, mara, organization, project, properties, resolutions, standard, theo, types, web47 } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { Comment, Project, RichText, WorkItem, WorkItemDetail } from '@/types';
import { Activity } from '../activity/Activity';
import { ItemDetailProvider } from '../ItemBody';
import type { DetailSurface } from '../shared';
import { CommentComposer, unsentRest } from './CommentComposer';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: '/items/WEB-47' }),
  router: { visit: vi.fn(), replace: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

let api: MockApi | undefined;

beforeEach(() => {
  installFakeXhr();
});

afterEach(() => {
  api?.restore();
  api = undefined;
  restoreFakeXhr();
  act(() => resetToasts());
});

const doc = (...paragraphs: string[]): RichText => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({
  status,
  body: { type: 'about:blank', title: reason, status, reason, detail: 'Nein.', ...extra },
});
const created = (body: unknown) => ({ status: 201, body: { data: makeComment({ id: 'c_new', author_id: 'u_lene', body_json: (body as { body_json: RichText }).body_json }) } });

interface Setup {
  item?: WorkItem;
  role?: Project['my_role'];
  surface?: DetailSurface;
  routes?: Record<string, MockRoute>;
}

function renderComposer({ item = web47, role = 'member', surface = 'page', routes = {} }: Setup = {}) {
  const calls = api?.calls ?? [];
  api?.restore();
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', role, { name: 'Website-Relaunch' })]) }),
    'POST /api/v1/work-items/wi_web_47/comments': created,
    'POST /api/v1/attachments': () => ({ status: 201, body: { data: makeAttachment() } }),
    ...routes,
  });
  // the calls of an earlier render of the same test stay countable
  api.calls.unshift(...calls);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ItemDetailProvider surface={surface}>
        <CommentComposer item={item} />
      </ItemDetailProvider>
    </QueryClientProvider>,
  );
}

const sent = () => api!.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/work-items/wi_web_47/comments').map((call) => plainText((call.body as { body_json: RichText }).body_json));
const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.body) =>
  act(() => {
    on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const send = (editor: Element) => press('Enter', { ctrlKey: true }, editor);
/** Adds text where the editor's caret is (jsdom mixes typed keys up behind existing text). */
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });
const pasteFile = (editor: HTMLElement, file: File) => fireEvent.paste(editor, { clipboardData: { types: ['Files'], files: [file], getData: () => '' } });
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'screenshot.png', { type: 'image/png' });
const leaving = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const commentEditor = () => screen.findByRole('textbox', { name: 'Kommentar' });
/** The composer's opener, once the rights have loaded. */
const opener = (name: string) => screen.findByRole('button', { name: new RegExp(name) });

/** Lets the next POST of a comment wait until `release()`. */
function holdNextSend() {
  const original = globalThis.fetch;
  let release = () => {};
  let held = false;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST' && String(input).endsWith('/comments') && !held) {
      held = true;
      await new Promise<void>((resolve) => (release = resolve));
    }
    return original(input, init);
  };
  return { release: () => act(async () => release()), held: () => held };
}

describe('CommentComposer', () => {
  it('opens with m and sends with mod+enter', async () => {
    renderComposer();
    await opener('Kommentar schreiben');
    press('m');
    const editor = await commentEditor();
    await waitFor(() => expect(document.activeElement).toBe(editor));

    paste(editor, 'Kann ich unter iOS 18 nachstellen.');
    // unsent text: leaving the page asks first
    expect(leaving()).toBe(true);
    send(editor);

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Kommentar gesendet'));
    expect(sent()).toEqual(['Kann ich unter iOS 18 nachstellen.']);
    // the editor stays open, empty, with the focus
    expect(editor.textContent).toBe('');
    expect(document.activeElement).toBe(editor);
    expect(drafts.pending()).toEqual([]);
    expect(leaving()).toBe(false);

    // typing again forgets the message
    paste(editor, 'Noch etwas.');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says that an empty comment cannot be sent, and folds up with Escape', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(await opener('Kommentar schreiben'));
    const editor = await commentEditor();
    const button = screen.getByRole('button', { name: /Kommentieren/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    send(editor);
    expect(screen.getByText('Der Kommentar ist noch leer. Schreib zuerst etwas.', { selector: 'p' })).toBeTruthy();
    expect(sent()).toEqual([]);

    // Escape on an empty text closes; the focus goes back to the opener
    press('Escape', {}, editor);
    const back = await opener('Kommentar schreiben');
    await waitFor(() => expect(document.activeElement).toBe(back));
  });

  it('keeps the text after a 500 and offers Try again', async () => {
    let down = true;
    renderComposer({ routes: { 'POST /api/v1/work-items/wi_web_47/comments': (body) => (down ? problem(503, 'service_unavailable') : created(body)) } });
    await opener('Kommentar schreiben');
    press('m');
    const editor = await commentEditor();
    paste(editor, 'Erster Versuch.');
    send(editor);

    const failed = await waitFor(() => {
      const toast = currentToasts().at(-1);
      expect(toast).toMatchObject({ title: 'Kommentar nicht gesendet', tone: 'error', action: { label: 'Erneut versuchen' } });
      return toast!;
    });
    expect(editor.textContent).toBe('Erster Versuch.');
    expect(drafts.get(commentDraft('wi_web_47'))).not.toBeNull();

    // the retry sends the text as it reads now
    paste(editor, ' Ergänzt.');
    down = false;
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Kommentar gesendet'));
    expect(sent()).toEqual(['Erster Versuch.', 'Erster Versuch. Ergänzt.']);
    expect(editor.textContent).toBe('');
  });

  it('shows a refusal of the text at the editor', async () => {
    renderComposer({ routes: { 'POST /api/v1/work-items/wi_web_47/comments': () => problem(422, 'validation_failed', { errors: { body_json: ['Der Kommentar ist zu lang.'] } }) } });
    await opener('Kommentar schreiben');
    press('m');
    const editor = await commentEditor();
    paste(editor, 'Sehr lang.');
    send(editor);
    await screen.findByText('Der Kommentar ist zu lang.');
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(currentToasts()).toEqual([]);
    expect(editor.textContent).toBe('Sehr lang.');
  });

  it('keeps what was typed while sending', async () => {
    renderComposer();
    await opener('Kommentar schreiben');
    press('m');
    const editor = await commentEditor();
    const gate = holdNextSend();
    paste(editor, 'Erstens.');
    send(editor);
    await waitFor(() => expect(gate.held()).toBe(true));
    // the sent text stays in sight until the answer; what is typed meanwhile is not sent
    const button = screen.getByRole('button', { name: /Kommentieren/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    send(editor);
    paste(editor, ' Zweitens.');
    expect(editor.textContent).toBe('Erstens. Zweitens.');

    await gate.release();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Kommentar gesendet'));
    expect(sent()).toEqual(['Erstens.']);
    // only the sent part goes; the rest is the draft
    expect(editor.textContent).toBe('Zweitens.');
    expect(plainText(drafts.get(commentDraft('wi_web_47')))).toBe('Zweitens.');
  });

  it('follows a send of a closed view when the item opens again, and sends nothing twice', async () => {
    const user = userEvent.setup();
    let posts = 0;
    const routes = { 'POST /api/v1/work-items/wi_web_47/comments': (body: unknown) => ((posts += 1), created(body)) };
    const first = renderComposer({ surface: 'peek', routes });
    await opener('Kommentar schreiben');
    press('m');
    const gate = holdNextSend();
    paste(await commentEditor(), 'Erstens.');
    send(await commentEditor());
    await waitFor(() => expect(gate.held()).toBe(true));
    // the preview closes and opens again while the comment is on its way
    first.unmount();
    renderComposer({ surface: 'peek', routes });
    await user.click(await opener('Entwurf weiterschreiben'));
    const editor = await commentEditor();
    expect(editor.textContent).toBe('Erstens.');
    const button = screen.getByRole('button', { name: /Kommentieren/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    send(editor);

    // the answer reaches the new view: the text is gone, the button free, and mod+enter sends nothing more
    await gate.release();
    await waitFor(() => expect(editor.textContent).toBe(''));
    expect(button.getAttribute('aria-busy')).toBeNull();
    send(editor);
    expect(screen.getByText('Der Kommentar ist noch leer. Schreib zuerst etwas.', { selector: 'p' })).toBeTruthy();
    expect(posts).toBe(1);
    expect(drafts.pending()).toEqual([]);
  });

  it('keeps a draft when the preview closes and brings it back', async () => {
    const user = userEvent.setup();
    const first = renderComposer({ surface: 'peek' });
    await user.click(await opener('Kommentar schreiben'));
    paste(await commentEditor(), 'Für später.');
    // "Später weiterschreiben" folds it up and keeps the text
    await user.click(screen.getByRole('button', { name: 'Später weiterschreiben' }));
    expect(await opener('Entwurf weiterschreiben')).toBeTruthy();
    first.unmount();
    expect(leaving()).toBe(true);

    renderComposer({ surface: 'peek' });
    await user.click(await opener('Entwurf weiterschreiben'));
    expect((await commentEditor()).textContent).toBe('Für später.');
  });

  it('deletes no upload of a discarded draft (A239: the server prunes them)', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(await opener('Kommentar schreiben'));
    const editor = await commentEditor();
    pasteFile(editor, png());
    await act(async () => FakeXhr.last.answer(201, { data: makeAttachment() }));
    await waitFor(() => expect(editor.querySelector('img, [data-attachment-id]')).not.toBeNull());

    // everything taken out again, then Escape: the draft is gone, its upload is left to the server
    press('a', { ctrlKey: true }, editor);
    press('Backspace', {}, editor);
    await waitFor(() => expect(drafts.pending()).toEqual([]));
    press('Escape', {}, editor);
    await opener('Kommentar schreiben');
    expect(api!.calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });

  it('blocks sending while an upload runs', async () => {
    renderComposer();
    await opener('Kommentar schreiben');
    press('m');
    const editor = await commentEditor();
    paste(editor, 'Hier der Screenshot: ');
    pasteFile(editor, png());
    const button = screen.getByRole('button', { name: /Kommentieren/ });
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    send(editor);
    expect(screen.getByText('Warte, bis die Uploads fertig sind.', { selector: 'p' })).toBeTruthy();
    expect(sent()).toEqual([]);

    await act(async () => FakeXhr.last.answer(201, { data: makeAttachment() }));
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
    send(editor);
    await waitFor(() => expect(sent()).toHaveLength(1));
    const body = (api!.calls.find((call) => call.method === 'POST' && call.url.endsWith('/comments'))!.body as { body_json: RichText }).body_json;
    expect(JSON.stringify(body)).toContain('"attachmentId":"att_1"');
  });

  it('shows the reason instead of the composer on an archived item', async () => {
    renderComposer({ item: { ...web47, state_id: 'std_done', archived_at: '2026-11-01T09:00:00Z' } });
    expect(await screen.findByText('WEB-47 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Kommentar schreiben/ })).toBeNull();
    press('m');
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Nicht möglich', description: 'WEB-47 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('lets a viewer comment', async () => {
    renderComposer({ role: 'viewer' });
    await opener('Kommentar schreiben');
    press('m');
    const editor = await commentEditor();
    paste(editor, 'Als Viewer.');
    send(editor);
    await waitFor(() => expect(sent()).toEqual(['Als Viewer.']));
  });

  it('says why a person who does not see the project cannot comment', async () => {
    renderComposer({ routes: { 'GET /api/v1/projects': () => ({ body: list([]) }) } });
    expect(await screen.findByText('Dieses Projekt siehst du nicht.')).toBeTruthy();
  });
});

describe('unsentRest', () => {
  const para = (...content: RichText[]): RichText => ({ type: 'paragraph', content });
  const text = (value: string, marks?: RichText['marks']): RichText => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });

  it('takes the sent text off the front', () => {
    expect(unsentRest(doc('Erstens.'), doc('Erstens.'))).toBeNull();
    expect(unsentRest(doc('Erstens.'), null)).toBeNull();
    expect(unsentRest(doc('Erstens.'), doc('Erstens.', 'Zweitens.'))).toEqual(doc('Zweitens.'));
    expect(unsentRest(doc('Erstens.'), doc('Erstens. Zweitens.'))).toEqual(doc('Zweitens.'));
    expect(unsentRest(doc('Erstens.'), doc('Erstens.  '))).toBeNull();
    // the paragraph went on after a node of its own (a mention)
    const mention: RichText = { type: 'mention', attrs: { id: 'u_mara', label: 'mara' } };
    expect(unsentRest({ type: 'doc', content: [para(text('Hallo '), mention)] }, { type: 'doc', content: [para(text('Hallo '), mention, text(' bitte'))] })).toEqual(doc('bitte'));
  });

  it('keeps everything when the sent text was changed while sending', () => {
    expect(unsentRest(doc('Erstens.'), doc('Erst ens.'))).toEqual(doc('Erst ens.'));
    expect(unsentRest(doc('Erstens.', 'Zweitens.'), doc('Erstens.', 'Zwei.'))).toEqual(doc('Erstens.', 'Zwei.'));
    expect(unsentRest(doc('Erstens.', 'Zweitens.'), doc('Erstens.'))).toEqual(doc('Erstens.'));
    // the mention of the sent paragraph taken out, or the text before it changed
    const mention: RichText = { type: 'mention', attrs: { id: 'u_mara', label: 'mara' } };
    const sentMention = { type: 'doc', content: [para(text('Hallo '), mention)] };
    expect(unsentRest(sentMention, doc('Hallo '))).toEqual(doc('Hallo '));
    expect(unsentRest(sentMention, { type: 'doc', content: [para(text('Hi '), mention)] })).toEqual({ type: 'doc', content: [para(text('Hi '), mention)] });
    // a mark changed on the last sent text: no prefix any more
    expect(unsentRest(doc('Erstens.'), { type: 'doc', content: [para(text('Erstens. mehr', [{ type: 'bold' }]))] })).toEqual({
      type: 'doc',
      content: [para(text('Erstens. mehr', [{ type: 'bold' }]))],
    });
    expect(unsentRest(doc('Erstens.'), { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [text('Erstens. mehr')] }] })).toEqual({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [text('Erstens. mehr')] }],
    });
  });
});

/* ------------------------------------------------------------------------ cards */

describe('CommentCard', () => {
  /** The comments of WEB-47 as the fake server holds them; each test sets its own. */
  let comments: Comment[] = [];
  const own = (id: string, text: string) => makeComment({ id, author_id: 'u_lene', body: text, body_json: doc(text) });
  const answer = (comment: Comment | undefined) => (comment ? { body: { data: comment } } : problem(404, 'not_found'));
  const change = (id: string, next: (comment: Comment) => Comment) => {
    comments = comments.map((comment) => (comment.id === id ? next(comment) : comment));
    return answer(comments.find((comment) => comment.id === id));
  };
  const detailOf = (item: WorkItem): WorkItemDetail => ({
    item,
    type: types[0]!,
    state: standard.states.find((state) => state.id === item.state_id)!,
    workflow: standard,
    children: [],
    relations: [],
    attachments: [],
    subscribed: false,
  });

  function renderCards({ item = web47, role = 'member', routes = {} }: Setup = {}) {
    api?.restore();
    api = mockApi({
      'GET /api/v1/organization': () => ({ body: { data: organization } }),
      'GET /api/v1/projects': () => ({ body: list([project('WEB', role, { name: 'Website-Relaunch' })]) }),
      'GET /api/v1/users': () => ({ body: list([mara, ida, theo, lene]) }),
      'GET /api/v1/labels': () => ({ body: list(labels) }),
      'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
      'GET /api/v1/properties': () => ({ body: list(properties) }),
      'GET /api/v1/work-items/wi_web_47/history': () => ({ body: list([]) }),
      'GET /api/v1/work-items/wi_web_47/comments': () => ({ body: list(comments) }),
      ...routes,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <ItemDetailProvider surface="page">
          <Activity detail={detailOf(item)} />
        </ItemDetailProvider>
      </QueryClientProvider>,
    );
  }

  const card = (name: string) => screen.findByRole('article', { name: `Kommentar von ${name}` });
  const actionsOf = (name: string) => screen.findByRole('button', { name: `Aktionen für den Kommentar von ${name}` });
  /** The entries of the actions menu of the comment by `name`. */
  async function menuOf(name: string): Promise<string[]> {
    const user = userEvent.setup();
    await user.click(await actionsOf(name));
    const menu = await screen.findByRole('menu');
    return within(menu)
      .getAllByRole('menuitem')
      .map((entry) => entry.textContent ?? '');
  }
  const choose = async (entry: string) => userEvent.setup().click(await screen.findByRole('menuitem', { name: entry }));

  it('edits an own comment and marks it edited', async () => {
    comments = [own('c_own', 'Erste Fassung.')];
    renderCards({ routes: { 'PATCH /api/v1/comments/c_own': (body) => change('c_own', (comment) => ({ ...comment, body_json: (body as { body_json: RichText }).body_json, edited_at: '2026-10-31T09:00:00.000Z' })) } });
    const article = await card('Lene Vogt');
    expect(within(article).queryByText('bearbeitet')).toBeNull();
    await menuOf('Lene Vogt');
    await choose('Bearbeiten');

    const editor = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect(editor.textContent).toBe('Erste Fassung.');
    paste(editor, ' Ergänzt.');
    // the edit is a draft of its own: leaving asks first
    expect(plainText(drafts.get(commentEditDraft('c_own')))).toBe('Erste Fassung. Ergänzt.');
    expect(leaving()).toBe(true);
    send(editor);

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Kommentar bearbeiten' })).toBeNull());
    const saved = api!.calls.find((call) => call.method === 'PATCH')!;
    expect(plainText((saved.body as { body_json: RichText }).body_json)).toBe('Erste Fassung. Ergänzt.');
    const edited = await card('Lene Vogt');
    await within(edited).findByText('bearbeitet');
    await within(edited).findByText('Erste Fassung. Ergänzt.');
    // the focus goes back to the comment's actions
    await waitFor(() => expect(document.activeElement).toBe(within(edited).getByRole('button', { name: 'Aktionen für den Kommentar von Lene Vogt' })));
    expect(drafts.pending()).toEqual([]);

    // Escape takes an edit back; nothing goes out
    await menuOf('Lene Vogt');
    await choose('Bearbeiten');
    const again = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(again));
    paste(again, ' Verworfen.');
    press('Escape', {}, again);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Kommentar bearbeiten' })).toBeNull());
    expect(api!.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(drafts.pending()).toEqual([]);
    expect((await card('Lene Vogt')).textContent).not.toContain('Verworfen.');
  });

  it('keeps a failed edit in the editor, and an edit over closing the view', async () => {
    comments = [own('c_own', 'Erste Fassung.')];
    let status = 503;
    const routes = {
      'PATCH /api/v1/comments/c_own': (body: unknown) =>
        status === 422
          ? problem(422, 'validation_failed', { errors: { body_json: ['Der Kommentar ist zu lang.'] } })
          : status === 503
            ? problem(503, 'service_unavailable')
            : change('c_own', (comment) => ({ ...comment, body_json: (body as { body_json: RichText }).body_json, edited_at: '2026-10-31T09:00:00.000Z' })),
    };
    const first = renderCards({ routes });
    await card('Lene Vogt');
    await menuOf('Lene Vogt');
    await choose('Bearbeiten');
    const editor = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    paste(editor, ' Neu.');
    send(editor);
    const failed = await waitFor(() => {
      const toast = currentToasts().at(-1);
      expect(toast).toMatchObject({ title: 'Kommentar nicht geändert', tone: 'error', action: { label: 'Erneut versuchen' } });
      return toast!;
    });
    expect(editor.textContent).toBe('Erste Fassung. Neu.');

    // a refusal of the text stands under the editor
    status = 422;
    act(() => runToastAction(failed.id));
    await screen.findByText('Der Kommentar ist zu lang.');
    expect(editor.getAttribute('aria-invalid')).toBe('true');

    // an empty text is no edit
    press('a', { ctrlKey: true }, editor);
    press('Backspace', {}, editor);
    send(editor);
    expect(screen.getByText('Der Kommentar ist leer. Schreib etwas oder lösch den Kommentar.', { selector: 'p' })).toBeTruthy();
    paste(editor, 'Kürzer.');

    // the view goes and comes back: the edit is still open with its text
    first.unmount();
    status = 200;
    renderCards({ routes });
    const back = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    expect(back.textContent).toBe('Kürzer.');
    send(back);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Kommentar bearbeiten' })).toBeNull());
    await within(await card('Lene Vogt')).findByText('Kürzer.');
  });

  /** Lets the next PATCH of a comment wait until `release()`. */
  function holdNextSave() {
    const original = globalThis.fetch;
    let release = () => {};
    let held = false;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'PATCH' && !held) {
        held = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return original(input, init);
    };
    return { release: () => act(async () => release()), held: () => held };
  }
  const saving = (body: unknown) => change('c_own', (comment) => ({ ...comment, body_json: (body as { body_json: RichText }).body_json, edited_at: '2026-10-31T09:00:00.000Z' }));
  const editors = () => screen.queryAllByRole('textbox', { name: 'Kommentar bearbeiten' });

  it('saves nothing for the same text, and keeps what was written while saving', async () => {
    comments = [own('c_own', 'Erste.')];
    renderCards({ routes: { 'PATCH /api/v1/comments/c_own': saving } });
    await card('Lene Vogt');
    await menuOf('Lene Vogt');
    await choose('Bearbeiten');
    let editor = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    send(editor);
    await waitFor(() => expect(editors()).toEqual([]));
    expect(api!.calls.filter((call) => call.method === 'PATCH')).toEqual([]);

    await menuOf('Lene Vogt');
    await choose('Bearbeiten');
    editor = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    paste(editor, ' Neu.');
    const gate = holdNextSave();
    send(editor);
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(screen.getByRole('button', { name: /Speichern/ }).getAttribute('aria-busy')).toBe('true');
    paste(editor, ' Mehr.');
    await gate.release();
    // the newer text stays open as the edit
    await waitFor(() => expect(api!.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Speichern/ }).getAttribute('aria-busy')).toBeNull());
    expect(editor.textContent).toBe('Erste. Neu. Mehr.');
    send(editor);
    await waitFor(() => expect(editors()).toEqual([]));
    await within(await card('Lene Vogt')).findByText('Erste. Neu. Mehr.');
  });

  it('follows an edit in another view, and a save of a closed one', async () => {
    comments = [own('c_own', 'Erste.')];
    const routes = { 'PATCH /api/v1/comments/c_own': saving };
    const first = renderCards({ routes });
    await card('Lene Vogt');
    await menuOf('Lene Vogt');
    await choose('Bearbeiten');
    const editor = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    paste(editor, ' Neu.');

    // a second view of the item (page and preview) opens the edit with its text and shares it
    renderCards({ routes });
    await waitFor(() => expect(editors()).toHaveLength(2));
    const other = editors().find((box) => box !== editor)!;
    expect(other.textContent).toBe('Erste. Neu.');
    paste(other, ' Mehr.');
    await waitFor(() => expect(editor.textContent).toBe('Erste. Neu. Mehr.'));

    // the first saves and closes before the answer: the second follows and closes with it
    const gate = holdNextSave();
    send(editor);
    await waitFor(() => expect(gate.held()).toBe(true));
    first.unmount();
    await gate.release();
    await waitFor(() => expect(editors()).toEqual([]));
    expect(api!.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(drafts.pending()).toEqual([]);
  });

  it('offers no edit on a foreign comment, delete only to admins', async () => {
    comments = [makeComment({ id: 'c_mara', author_id: 'u_mara' }), own('c_own', 'Von mir.')];
    const first = renderCards();
    // a member: nothing on Mara's comment, both on the own one
    expect(await menuOf('Lene Vogt')).toEqual(['Bearbeiten', 'Löschen']);
    await card('Mara Lindqvist');
    expect(screen.queryByRole('button', { name: 'Aktionen für den Kommentar von Mara Lindqvist' })).toBeNull();
    first.unmount();

    // a project admin deletes any comment, but edits only the own
    renderCards({ role: 'admin' });
    expect(await menuOf('Mara Lindqvist')).toEqual(['Löschen']);
  });

  it('shows reactions without buttons and offers no actions on an archived item', async () => {
    comments = [own('c_own', 'Von mir.'), makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida', 'u_lene'] }] })];
    renderCards({ item: { ...web47, state_id: 'std_done', archived_at: '2026-11-01T09:00:00Z' } });
    const article = await card('Mara Lindqvist');
    await within(article).findByRole('img', { name: '👍, 2 Reaktionen: Ida Brenner, Lene Vogt' });
    expect(within(article).queryByRole('button')).toBeNull();
    expect(within(await card('Lene Vogt')).queryByRole('button')).toBeNull();
  });

  it('deletes with undo and brings the card back on failure', async () => {
    comments = [own('c_first', 'Erstens.'), own('c_second', 'Zweitens.')];
    let down = true;
    const routes = {
      'DELETE /api/v1/comments/c_first': () => {
        comments = comments.filter((comment) => comment.id !== 'c_first');
        return { status: 204 };
      },
      'DELETE /api/v1/comments/c_second': () => (down ? problem(503, 'service_unavailable') : ((comments = comments.filter((comment) => comment.id !== 'c_second')), { status: 204 })),
    };
    renderCards({ routes });
    const timeline = await screen.findByRole('list', { name: 'Verlauf' });
    await waitFor(() => expect(within(timeline).getAllByRole('article')).toHaveLength(2));

    // the card goes at once; the focus moves on to the next one
    await userEvent.setup().click(within(timeline).getAllByRole('button', { name: 'Aktionen für den Kommentar von Lene Vogt' })[0]!);
    await choose('Löschen');
    await waitFor(() => expect(within(timeline).getAllByRole('article')).toHaveLength(1));
    const next = within(timeline).getByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(next));
    const undo = currentToasts().at(-1)!;
    expect(undo).toMatchObject({ title: 'Kommentar gelöscht', action: { label: 'Rückgängig' } });
    // undo brings it back, nothing went out
    act(() => runToastAction(undo.id));
    await waitFor(() => expect(within(timeline).getAllByRole('article')).toHaveLength(2));
    expect(api!.calls.filter((call) => call.method === 'DELETE')).toEqual([]);

    // the last card: the focus goes to the composer
    await userEvent.setup().click(within(timeline).getAllByRole('button', { name: 'Aktionen für den Kommentar von Lene Vogt' })[1]!);
    await choose('Löschen');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Kommentar schreiben/ })));
    // the time runs out: the server refuses, the card comes back with the reason and a retry
    act(() => dismissToast(currentToasts().find((toast) => toast.title === 'Kommentar gelöscht')!.id));
    await waitFor(() => expect(within(timeline).getAllByRole('article')).toHaveLength(2));
    const failed = await waitFor(() => {
      const toast = currentToasts().find((entry) => entry.tone === 'error');
      expect(toast).toMatchObject({ title: 'Kommentar nicht gelöscht', action: { label: 'Erneut versuchen' } });
      return toast!;
    });
    down = false;
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(within(timeline).getAllByRole('article')).toHaveLength(1));
    expect(api!.calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/v1/comments/c_second', '/api/v1/comments/c_second']);
  });

  it('reacts and takes the reaction back', async () => {
    comments = [makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida', 'u_theo'] }] })];
    const user = userEvent.setup();
    const react = (emoji: string, on: boolean) =>
      change('c_web47_1', (comment) => {
        const others = comment.reactions.map((reaction) => (reaction.emoji === emoji ? { ...reaction, user_ids: reaction.user_ids.filter((id) => id !== 'u_lene') } : reaction));
        const group = others.find((reaction) => reaction.emoji === emoji);
        const reactions = on ? (group ? others.map((reaction) => (reaction === group ? { ...group, user_ids: [...group.user_ids, 'u_lene'] } : reaction)) : [...others, { emoji, user_ids: ['u_lene'] }]) : others;
        return { ...comment, reactions: reactions.filter((reaction) => reaction.user_ids.length > 0) };
      });
    renderCards({
      routes: {
        'PUT /api/v1/comments/c_web47_1/reactions': (body) => react((body as { emoji: string }).emoji, true),
        'DELETE /api/v1/comments/c_web47_1/reactions': (_body, request) => react(request.searchParams.get('emoji')!, false),
      },
    });
    const article = await card('Mara Lindqvist');
    const thumbs = await within(article).findByRole('button', { name: '👍, 2 Reaktionen: Ida Brenner, Theo Okafor' });
    expect(thumbs.getAttribute('aria-pressed')).toBe('false');

    await user.click(thumbs);
    // at once, before the answer
    expect(thumbs.getAttribute('aria-label')).toBe('👍, 3 Reaktionen: Ida Brenner, Theo Okafor, Lene Vogt');
    expect(thumbs.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(api!.calls.filter((call) => call.method === 'PUT')).toHaveLength(1));
    await user.click(thumbs);
    await waitFor(() => expect(thumbs.getAttribute('aria-label')).toBe('👍, 2 Reaktionen: Ida Brenner, Theo Okafor'));
    expect(api!.calls.at(-1)!.url).toBe(`/api/v1/comments/c_web47_1/reactions?emoji=${encodeURIComponent('👍')}`);

    // any other emoji from the picker
    await user.click(within(article).getByRole('button', { name: 'Reaktion hinzufügen' }));
    await user.click(await screen.findByRole('button', { name: 'Party' }));
    const party = await within(article).findByRole('button', { name: '🎉, 1 Reaktion: Lene Vogt' });
    expect(party.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(api!.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([{ emoji: '👍' }, { emoji: '🎉' }]));
  });

  it("keeps each failed reaction's toast", async () => {
    comments = [makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida'] }] })];
    const user = userEvent.setup();
    renderCards({ routes: { 'PUT /api/v1/comments/c_web47_1/reactions': () => problem(503, 'service_unavailable') } });
    const article = await card('Mara Lindqvist');
    await user.click(await within(article).findByRole('button', { name: '👍, 1 Reaktion: Ida Brenner' }));
    await user.click(within(article).getByRole('button', { name: 'Reaktion hinzufügen' }));
    await user.click(await screen.findByRole('button', { name: 'Party' }));

    // both reactions go back, and each says so with its own retry
    await waitFor(() => expect(currentToasts().filter((toast) => toast.tone === 'error')).toHaveLength(2));
    expect(currentToasts().map((toast) => [toast.title, toast.action?.label])).toEqual([
      ['Reaktion 👍 nicht gespeichert', 'Erneut versuchen'],
      ['Reaktion 🎉 nicht gespeichert', 'Erneut versuchen'],
    ]);
    await within(article).findByRole('button', { name: '👍, 1 Reaktion: Ida Brenner' });
    expect(within(article).queryByRole('button', { name: /🎉/ })).toBeNull();
  });
});
