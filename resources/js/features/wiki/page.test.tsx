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
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, makeAttachment, makePage, mara, organization, pageSummary } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { RichText, Page as WikiPage } from '@/types';
import { PageView, type PageViewProps } from './PageView';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization }, url: '/projects/WEB/wiki/pg_web_domain' }),
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
