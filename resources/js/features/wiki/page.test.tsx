/*
 * One wiki page (`PageView`) against a fake REST API: reading it as a viewer, a page deleted meanwhile (live) and one
 * the server did not find, the save state, pictures in it and a pasted picture, the emoji, the title and the keys.
 * Inertia is a fake with the shared props the page reads (the person, the organisation's time zone).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { drafts, pageDraft } from '@/lib/drafts';
import { clearLiveGone, markLiveGone } from '@/lib/liveGone';
import { listCommands } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, makeAttachment, makePage, mara, organization, pageSummary } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { RichText, Page as WikiPage } from '@/types';
import { PageView, type PageViewProps } from './PageView';

const shared = vi.hoisted(() => ({ pdf: true }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization, features: { pdf: shared.pdf } }, url: '/projects/WEB/wiki/pg_web_domain' }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  router: { visit: vi.fn(), replace: vi.fn(), reload: vi.fn(), on: () => () => {} },
}));

// jsdom has no layout: ProseMirror measures the selection to scroll it into view
beforeAll(async () => {
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

const doc = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const image = (attachmentId: string, alt: string): RichText => ({ type: 'image', attrs: { attachmentId, alt } });

const domain = makePage({
  id: 'pg_web_domain',
  parent_id: 'pg_web_hosting',
  title: 'Domain-Umzug',
  emoji: '🌐',
  content_json: doc('Die Domain zieht im November um.'),
  version: 3,
  updated_by: 'u_ida',
  updated_at: '2026-10-14T09:00:00.000Z',
});
const hosting = { ...pageSummary(makePage({ id: 'pg_web_hosting', title: 'Hosting', emoji: '🖥️' })), children: [] };

let shown: WikiPage;
let overrides: Record<string, MockRoute>;
let api: MockApi;

function routes(): Record<string, MockRoute> {
  const base: Record<string, MockRoute> = {
    'GET /api/v1/users': () => ({ body: list([mara, ida]) }),
    'GET /api/v1/pages/pg_web_domain': () => ({ body: { data: shown } }),
    'PATCH /api/v1/pages/pg_web_domain': (body) => {
      const sent = body as { title: string; emoji: string | null; content_json: RichText | null };
      shown = { ...shown, title: sent.title, emoji: sent.emoji, content_json: sent.content_json, version: shown.version + 1, updated_by: 'u_mara' };
      return { body: { data: shown } };
    },
  };
  return new Proxy(base, { get: (target, key: string) => overrides[key] ?? target[key] });
}

beforeEach(() => {
  shown = domain;
  overrides = {};
  api = mockApi(routes());
  installFakeXhr();
});

afterEach(() => {
  api.restore();
  restoreFakeXhr();
  drafts.clear();
  clearLiveGone();
  useUiStore.setState({ peekItemId: null });
  shared.pdf = true;
  act(() => resetToasts());
});

const editing = { ready: true, denied: null };

function renderPage(props: Partial<PageViewProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const all: PageViewProps = { projectId: 'p_web', identifier: 'WEB', pageId: 'pg_web_domain', pageFound: true, ancestors: [hosting], rights: editing, ...props };
  return { client, ...render(<QueryClientProvider client={client}><PageView {...all} /></QueryClientProvider>) };
}

const gets = () => api.calls.filter((call) => call.method === 'GET' && call.url.startsWith('/api/v1/pages/'));
const saves = () => api.calls.filter((call) => call.method === 'PATCH').map((call) => call.body as Record<string, unknown>);
const titleField = () => screen.findByRole('textbox', { name: 'Titel der Seite' }) as Promise<HTMLTextAreaElement>;
const body = () => screen.findByRole('textbox', { name: 'Inhalt der Seite' });

describe('a wiki page', () => {
  it('lets a viewer read the page, without fields to edit', async () => {
    renderPage({ rights: { ready: true, denied: 'Als Viewer liest du das Wiki nur.' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Domain-Umzug' })).toBeTruthy();
    expect(await screen.findByText('Die Domain zieht im November um.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Als Viewer liest du das Wiki nur.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Emoji/ })).toBeNull();
    // who changed it last, on the day in the organisation's zone; the path of the page
    expect(await screen.findByText('Zuletzt geändert von Ida Brenner am 14.10.2026')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Pfad der Seite' })).getByRole('link', { name: /Hosting/ }).getAttribute('href')).toBe('/projects/WEB/wiki/pg_web_hosting');
    // no save state for a reader
    expect(document.querySelector('[data-save-status]')).toBeNull();
  });

  it('says a page without text is empty, to a viewer', async () => {
    shown = makePage({ ...domain, content_json: null, emoji: null, updated_by: 'u_gone' });
    renderPage({ ancestors: [], rights: { ready: true, denied: 'Als Viewer liest du das Wiki nur.' } });
    expect(await screen.findByText('Diese Seite ist noch leer.')).toBeTruthy();
    expect(await screen.findByText('Zuletzt geändert von Unbekannt am 14.10.2026')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Pfad der Seite' })).toBeNull();
  });

  it('shows the deleted banner from live without asking for the page', async () => {
    const user = userEvent.setup();
    renderPage();
    const title = await titleField();
    await user.clear(title);
    await user.type(title, 'Domain neu');

    act(() => markLiveGone('pg_web_domain', 'page'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite wurde gelöscht' })).toBeTruthy();
    expect(screen.getByText('Sie wurde samt ihren Unterseiten gelöscht. Im Baum stehen alle Seiten, die es im Wiki noch gibt.')).toBeTruthy();
    // the text typed is there to copy, and is never sent
    const parked = screen.getByRole('alert');
    expect(within(parked).getByText('Dein Text ist nicht gespeichert')).toBeTruthy();
    expect(within(parked).getByText('Domain neu')).toBeTruthy();
    expect(within(parked).getByRole('button', { name: 'Kopieren' })).toBeTruthy();
    expect(saves()).toHaveLength(0);
    expect(gets()).toHaveLength(1);
    // the browser refuses the clipboard: copying selects the text instead
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(within(parked).getByRole('button', { name: 'Kopieren' }));
    expect(write).toHaveBeenCalledWith('Domain neu\n\nDie Domain zieht im November um.');
    await waitFor(() => expect(window.getSelection()?.toString()).toContain('Domain neu'));

    await user.click(within(parked).getByRole('button', { name: 'Verwerfen' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(drafts.page(pageDraft('pg_web_domain'))).toBeNull();
  });

  it('shows a page known to be deleted without asking for it', async () => {
    markLiveGone('pg_web_domain', 'page');
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite wurde gelöscht' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Zur Übersicht des Wikis' }).getAttribute('href')).toBe('/projects/WEB/wiki');
    expect(gets()).toHaveLength(0);
  });

  it('shows a page that does not exist without a request', async () => {
    renderPage({ pageFound: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht' })).toBeTruthy();
    expect(screen.getByText('Sie wurde gelöscht, oder der Link ist unvollständig. Im Baum stehen alle Seiten, die es im Wiki gibt.')).toBeTruthy();
    expect(gets()).toHaveLength(0);
  });

  it('shows the skeleton until the page and the rights are there, and a page gone for the reader', async () => {
    overrides['GET /api/v1/pages/pg_web_domain'] = () => ({ status: 403, body: { type: 'about:blank', title: 'Forbidden', status: 403, reason: 'forbidden' } });
    const first = renderPage({ rights: { ready: false, denied: 'Rechte werden geladen …' } });
    expect(screen.getByText('Seite wird geladen …')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht' })).toBeTruthy();
    first.unmount();

    delete overrides['GET /api/v1/pages/pg_web_domain'];
    renderPage({ rights: { ready: false, denied: 'Rechte werden geladen …' } });
    await waitFor(() => expect(gets()).toHaveLength(2));
    expect(screen.getByText('Seite wird geladen …')).toBeTruthy();
  });

  it('says the page could not be loaded, and loads it again', async () => {
    const user = userEvent.setup();
    let down = true;
    overrides['GET /api/v1/pages/pg_web_domain'] = () =>
      down ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } } : { body: { data: shown } };
    renderPage();
    expect(await screen.findByText('Die Seite konnte nicht geladen werden')).toBeTruthy();
    down = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect((await titleField()).value).toBe('Domain-Umzug');
  });

  it('says the save state in a status region and the time beside it', async () => {
    const user = userEvent.setup();
    renderPage();
    const title = await titleField();
    const status = document.querySelector('[data-save-status]')!;
    const region = within(status as HTMLElement).getByRole('status');
    expect(region.textContent).toBe('');
    expect(status.querySelector('time')).toBeNull();

    await user.type(title, ' 2026');
    // a title has one line: a line break typed or pasted becomes a space
    fireEvent.change(title, { target: { value: 'Domain-Umzug\n2026' } });
    expect(title.value).toBe('Domain-Umzug 2026');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(region.textContent).toBe('Gespeichert'));
    expect(saves()).toEqual([{ title: 'Domain-Umzug 2026', emoji: '🌐', content_json: domain.content_json, base_version: 3 }]);
    // the time stands beside the region: read when reading, never spoken on every tick
    const time = status.querySelector('time')!;
    expect(region.contains(time)).toBe(false);
    expect(time.getAttribute('aria-hidden')).toBeNull();
    expect(time.textContent).toBe('vor wenigen Sekunden');
    expect(Number.isNaN(Date.parse(time.getAttribute('dateTime')!))).toBe(false);
    expect(await screen.findByText('Zuletzt geändert von Mara Lindqvist am 14.10.2026')).toBeTruthy();
  });

  it('moves the time on while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      renderPage();
      const title = await titleField();
      fireEvent.change(title, { target: { value: 'Domain' } });
      fireEvent.blur(title);
      const status = document.querySelector('[data-save-status]')!;
      await waitFor(() => expect(status.querySelector('time')?.textContent).toBe('vor wenigen Sekunden'));
      act(() => vi.advanceTimersByTime(5 * 60_000));
      expect(status.querySelector('time')!.textContent).toBe('vor 5 Minuten');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the picture of a page and its states', async () => {
    let release: () => void = () => {};
    const through = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/attachments/att_wait') ? new Promise<Response>((resolve) => (release = () => resolve(through(input, init)))) : through(input, init);
    overrides['GET /api/v1/attachments/att_1'] = () => ({ body: { data: makeAttachment({ id: 'att_1', filename: 'plan.png' }) } });
    overrides['GET /api/v1/attachments/att_hidden'] = () => ({ status: 404, body: { type: 'about:blank', title: 'Not Found', status: 404, reason: 'not_found' } });
    overrides['GET /api/v1/attachments/att_wait'] = () => ({ body: { data: makeAttachment({ id: 'att_wait', filename: 'spaet.png' }) } });
    shown = makePage({ ...domain, content_json: { type: 'doc', content: [image('att_1', 'Plan'), image('att_hidden', 'Geheim'), image('att_wait', 'Später')] } });
    renderPage({ rights: { ready: true, denied: 'Als Viewer liest du das Wiki nur.' } });

    // stored: the picture, linked to its original
    const picture = await screen.findByRole('img', { name: 'Plan' });
    expect(picture.getAttribute('src')).toBe('/attachments/att_1');
    expect(picture.closest('a')?.getAttribute('href')).toBe('/attachments/att_1');
    // hidden from the reader (another project, gone): said, never shown
    expect(await screen.findByText('Geheim: Bild nicht verfügbar')).toBeTruthy();
    // still on its way
    expect(screen.getByText('Später: Bild wird geladen …')).toBeTruthy();
    await act(async () => release());
    expect(await screen.findByRole('img', { name: 'Später' })).toBeTruthy();
    // a picture that fails to load says so too
    fireEvent.error(picture);
    expect(await screen.findByText('Plan: Bild nicht verfügbar')).toBeTruthy();
  });

  it('pastes a picture that belongs to nobody until the page saves, then to the page', async () => {
    const user = userEvent.setup();
    renderPage();
    const editor = await body();
    await user.click(editor);
    await user.keyboard('Neu: ');
    fireEvent.paste(editor, { clipboardData: { types: ['Files'], files: [new File([new Uint8Array([137, 80, 78, 71])], 'skizze.png', { type: 'image/png' })], getData: () => '' } });
    const upload = FakeXhr.last;
    expect(upload.opened).toEqual(['POST', '/api/v1/attachments']);
    expect(upload.sent?.get('project_id')).toBe('p_web');
    expect(upload.sent?.get('kind')).toBe('inline');
    // nobody owns it yet: no item, no page
    expect([...upload.sent!.keys()].sort()).toEqual(['file', 'kind', 'project_id']);

    // ⌘↵ while the picture is on its way: the page waits for it
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(saves()).toHaveLength(0);
    await act(async () => upload.answer(201, { data: makeAttachment({ id: 'att_skizze', filename: 'skizze.png' }) }));
    // saving the page makes the picture the page's (the server links what the text names)
    await waitFor(() => expect(JSON.stringify(saves().at(-1)?.content_json)).toContain('att_skizze'), { timeout: 4000 });
  });

  it('chooses and removes the emoji, which saves at once', async () => {
    const user = userEvent.setup();
    renderPage();
    await titleField();
    await user.click(screen.getByRole('button', { name: 'Emoji ändern' }));
    const search = await screen.findByRole('searchbox');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.click(screen.getByRole('button', { name: 'Emoji entfernen' }));
    await waitFor(() => expect(saves().at(-1)).toMatchObject({ emoji: null }));

    await user.click(await screen.findByRole('button', { name: 'Emoji wählen' }));
    const again = await screen.findByRole('searchbox');
    await waitFor(() => expect(document.activeElement).toBe(again));
    await user.click(document.querySelector<HTMLElement>('[data-index="0"]')!);
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]!.emoji).not.toBeNull();
  });

  it('goes from the title into the text with Enter, and selects the title of a page just made', async () => {
    const user = userEvent.setup();
    renderPage({ focusTitle: true });
    const title = await titleField();
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 'Domain-Umzug'.length]);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(await body());
    expect(title.value).toBe('Domain-Umzug');
  });

  it('saves on leaving the text and deletes with mod+backspace, unless a preview is open', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderPage({ onDelete });
    const title = await titleField();
    await user.type(title, '!');
    // leaving the title for the text saves; leaving the text for nowhere saves what changed there
    await user.tab();
    await waitFor(() => expect(saves()).toHaveLength(1));
    await user.keyboard('Neu');
    act(() => (document.activeElement as HTMLElement).blur());
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(JSON.stringify(saves()[1]!.content_json)).toContain('Neu');

    // while typing it is a key of the text; with the focus nowhere it asks to delete the page
    await user.keyboard('{Control>}{Backspace}{/Control}');
    expect(onDelete).toHaveBeenCalledTimes(1);
    // the item in the preview is what mod+backspace acts on then (item.remove, K3)
    act(() => useUiStore.setState({ peekItemId: 'wi_web_47' }));
    await user.keyboard('{Control>}{Backspace}{/Control}');
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('a page that becomes read-only keeps the unsaved text above it to copy', async () => {
    const user = userEvent.setup();
    const { client, rerender } = renderPage();
    const title = await titleField();
    await user.clear(title);
    await user.type(title, 'Domain neu');
    // the project is archived before the pause runs out (live): the person reads the page now (A154)
    const props: PageViewProps = { projectId: 'p_web', identifier: 'WEB', pageId: 'pg_web_domain', pageFound: true, ancestors: [hosting], rights: { ready: true, denied: 'Das Projekt ist archiviert.' } };
    rerender(
      <QueryClientProvider client={client}>
        <PageView {...props} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Domain-Umzug' })).toBeTruthy();
    const parked = screen.getByRole('alert');
    expect(within(parked).getByText('Dein Text ist nicht gespeichert')).toBeTruthy();
    expect(within(parked).getByText('Das Projekt ist archiviert.')).toBeTruthy();
    expect(within(parked).getByText('Domain neu')).toBeTruthy();
    expect(within(parked).getByRole('button', { name: 'Kopieren' })).toBeTruthy();
    // still unsaved: leaving asks, and nothing went to the server
    expect(drafts.page(pageDraft('pg_web_domain'))?.title).toBe('Domain neu');
    expect(saves()).toHaveLength(0);

    await user.click(within(parked).getByRole('button', { name: 'Verwerfen' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(drafts.page(pageDraft('pg_web_domain'))).toBeNull();
  });

  it('neither saves nor deletes with the keys for a reader', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderPage({ onDelete, rights: { ready: true, denied: 'Als Viewer liest du das Wiki nur.' } });
    await screen.findByRole('heading', { level: 1, name: 'Domain-Umzug' });
    await user.keyboard('{Control>}{Backspace}{/Control}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onDelete).not.toHaveBeenCalled();
    expect(saves()).toHaveLength(0);
    expect(currentToasts()).toHaveLength(0);
  });
});

describe('the PDF of a page (WEBU-4)', () => {
  const link = (subpages: boolean) => ({
    url: `https://werkbuch.ddev.site/pages/pg_web_domain/pdf${subpages ? '?subpages=1' : ''}`,
    filename: 'Domain-Umzug.pdf',
    pages: subpages ? 3 : 1,
  });
  let clicked: { href: string; download: string }[];

  beforeEach(() => {
    clicked = [];
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    overrides['GET /api/v1/pages/pg_web_domain/pdf'] = (_body, url) => ({ body: { data: link(url.searchParams.get('subpages') === '1') } });
    overrides['GET /pages/pg_web_domain/pdf'] = () => ({ file: { body: '%PDF-1.7', type: 'application/pdf' } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('downloads the page alone with one button when it has no subpages, for a viewer too', async () => {
    const user = userEvent.setup();
    renderPage({ rights: { ready: true, denied: 'Als Viewer liest du das Wiki nur.' } });
    await user.click(await screen.findByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(clicked).toEqual([{ href: 'blob:pdf', download: 'Domain-Umzug.pdf' }]));
    expect(api.calls.filter((call) => call.url.includes('/pdf')).map((call) => call.url)).toEqual(['/api/v1/pages/pg_web_domain/pdf', '/pages/pg_web_domain/pdf']);
    expect(currentToasts().map((toast) => toast.title)).toContain('Domain-Umzug.pdf heruntergeladen');
    // the link to the file is not kept
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('saves what is typed before it asks for the PDF', async () => {
    const user = userEvent.setup();
    renderPage();
    const title = await titleField();
    await user.type(title, ' neu');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    const order = api.calls.filter((call) => call.method === 'PATCH' || call.url.includes('/pdf')).map((call) => `${call.method} ${call.url}`);
    expect(order).toEqual(['PATCH /api/v1/pages/pg_web_domain', 'GET /api/v1/pages/pg_web_domain/pdf', 'GET /pages/pg_web_domain/pdf']);
    expect(saves()[0]?.title).toBe('Domain-Umzug neu');
  });

  it('offers the page or the page with its subpages in a menu, and in the palette', async () => {
    const user = userEvent.setup();
    renderPage({ subpages: 2 });
    await user.click(await screen.findByRole('button', { name: 'PDF' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mit Unterseiten (3 Seiten)' }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(api.calls.some((call) => call.url === '/api/v1/pages/pg_web_domain/pdf?subpages=1')).toBe(true);
    expect(listCommands().map((command) => command.label)).toEqual(expect.arrayContaining(['Als PDF herunterladen', 'Als PDF mit Unterseiten herunterladen (3 Seiten)']));

    const run = (id: string) => act(() => listCommands().find((command) => command.id === id)?.run());
    run('wiki.page.pdf');
    await waitFor(() => expect(clicked).toHaveLength(2));
    run('wiki.page.pdf_subtree');
    await waitFor(() => expect(clicked).toHaveLength(3));
    // the page alone from the menu
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Diese Seite' }));
    await waitFor(() => expect(clicked).toHaveLength(4));
    expect(api.calls.filter((call) => call.url.startsWith('/api/v1/pages/pg_web_domain/pdf')).map((call) => call.url)).toEqual([
      '/api/v1/pages/pg_web_domain/pdf?subpages=1',
      '/api/v1/pages/pg_web_domain/pdf',
      '/api/v1/pages/pg_web_domain/pdf?subpages=1',
      '/api/v1/pages/pg_web_domain/pdf',
    ]);
  });

  it('asks once while a download runs', async () => {
    let release: () => void = () => {};
    overrides['GET /pages/pg_web_domain/pdf'] = () => ({ file: { body: '%PDF-1.7', type: 'application/pdf' } });
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      String(input).includes('/pages/pg_web_domain/pdf') && !String(input).includes('/api/') ? new Promise((done) => (release = () => done(original(input, init)))).then((r) => r as Response) : original(input, init);
    renderPage();
    const button = await screen.findByRole('button', { name: 'PDF' });

    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    // the button is busy, and the palette asks nothing either
    fireEvent.click(button);
    act(() => listCommands().find((command) => command.id === 'wiki.page.pdf')?.run());
    release();
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(api.calls.filter((call) => call.url === '/api/v1/pages/pg_web_domain/pdf')).toHaveLength(1);
    globalThis.fetch = original;
  });

  it('says why without a PDF service, and offers no command', async () => {
    shared.pdf = false;
    const user = userEvent.setup();
    renderPage({ subpages: 2 });
    const button = await screen.findByRole('button', { name: 'PDF' });

    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toContain('kein PDF-Dienst');
    await user.click(button);
    expect(listCommands().some((command) => command.id.startsWith('wiki.page.pdf') && command.when?.() !== false)).toBe(false);
    // a command run all the same asks nothing
    act(() => listCommands().find((command) => command.id === 'wiki.page.pdf')?.run());
    expect(api.calls.some((call) => call.url.includes('/pdf'))).toBe(false);
  });

  it('says a refusal of the link and of the file, and tries again where it may help', async () => {
    const user = userEvent.setup();
    overrides['GET /api/v1/pages/pg_web_domain/pdf'] = () => ({ status: 503, body: { status: 503, reason: 'pdf_unavailable', title: 'Service Unavailable' } });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(currentToasts().map((toast) => toast.title)).toContain('PDF von „Domain-Umzug“ nicht erstellt'));
    const failed = currentToasts().find((toast) => toast.title === 'PDF von „Domain-Umzug“ nicht erstellt');
    expect(failed?.action).toBeDefined();

    // the link works now, the file is refused: too many in a minute
    act(() => resetToasts());
    overrides['GET /api/v1/pages/pg_web_domain/pdf'] = () => ({ body: { data: link(false) } });
    overrides['GET /pages/pg_web_domain/pdf'] = () => ({ status: 429, body: { message: 'Too Many Attempts.' } });
    act(() => failed?.action?.onClick());
    await waitFor(() => expect(currentToasts().map((toast) => toast.description)).toContain('Zu viele Anfragen. Versuch es gleich noch einmal.'));
    expect(clicked).toEqual([]);
  });
});
