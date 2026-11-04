/*
 * The kept versions of a wiki page (`VersionsDialog`) on the open page, against a fake REST API: the list with author,
 * time and "aktuell", the text of a chosen version (read on its own, A315), restoring one as a new version after the
 * own text is saved, a restore while a conflict is open, and a viewer who reads them. Inertia is a fake with the
 * shared props the page reads (the person, the organisation's time zone).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { listCommands } from '@/lib/commands';
import { drafts } from '@/lib/drafts';
import { clearLiveGone } from '@/lib/liveGone';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, makePage, mara, organization } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { PageVersion, PageVersionDetail, RichText, Page as WikiPage } from '@/types';
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

const domain = makePage({ id: 'pg_web_domain', title: 'Domain-Umzug', content_json: doc('Die Domain zieht im November um.'), version: 3, updated_by: 'u_mara' });

const version = (number: number, author: string, title: string, created_at: string): PageVersion => ({
  id: `pv_${number}`,
  page_id: 'pg_web_domain',
  version: number,
  title,
  author_id: author,
  created_at,
});
const v2 = version(2, 'u_ida', 'Domain-Umzug', '2026-10-20T08:30:00.000Z');
const v1 = version(1, 'u_mara', 'Domain', '2026-10-14T07:15:00.000Z');
const texts: Record<string, string> = { pv_1: 'Die alte Fassung.', pv_2: 'Die mittlere Fassung.', pv_3: 'Die Domain zieht im November um.' };

let stored: WikiPage;
let kept: PageVersion[];
let overrides: Record<string, MockRoute>;
let api: MockApi;

function routes(): Record<string, MockRoute> {
  const detail = (id: string): MockRoute => () => {
    const found = kept.find((entry) => entry.id === id)!;
    return { body: { data: { ...found, content: texts[id], content_json: doc(texts[id]!) } satisfies PageVersionDetail } };
  };
  const base: Record<string, MockRoute> = {
    'GET /api/v1/users': () => ({ body: list([mara, ida]) }),
    'GET /api/v1/pages/pg_web_domain': () => ({ body: { data: stored } }),
    'GET /api/v1/pages/pg_web_domain/versions': () => ({ body: list(kept) }),
    'GET /api/v1/pages/pg_web_domain/versions/pv_1': detail('pv_1'),
    'GET /api/v1/pages/pg_web_domain/versions/pv_2': detail('pv_2'),
    'GET /api/v1/pages/pg_web_domain/versions/pv_3': detail('pv_3'),
    'PATCH /api/v1/pages/pg_web_domain': (body) => {
      const sent = body as { title: string; emoji: string | null; content_json: RichText | null; base_version: number };
      if (sent.base_version !== stored.version) {
        return { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, reason: 'page_conflict', detail: 'Ida Brenner hat die Seite inzwischen geändert.', current: stored } };
      }
      stored = { ...stored, title: sent.title, emoji: sent.emoji, content_json: sent.content_json, version: stored.version + 1 };
      return { body: { data: stored } };
    },
    // restoring keeps the state it replaces as a version first, then takes the version's title and text (A309, A323)
    'POST /api/v1/pages/pg_web_domain/versions/pv_1/restore': () => {
      kept = [version(stored.version, stored.updated_by, stored.title, '2026-10-28T10:00:00.000Z'), ...kept];
      stored = { ...stored, title: v1.title, content_json: doc(texts.pv_1!), version: stored.version + 1, updated_by: 'u_mara' };
      return { body: { data: stored } };
    },
  };
  return new Proxy(base, { get: (target, key: string) => overrides[key] ?? target[key] });
}

beforeEach(() => {
  stored = domain;
  kept = [v2, v1];
  overrides = {};
  api = mockApi(routes());
});

afterEach(() => {
  api.restore();
  drafts.clear();
  clearLiveGone();
  act(() => resetToasts());
});

function renderPage(props: Partial<PageViewProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const all: PageViewProps = { projectId: 'p_web', identifier: 'WEB', pageId: 'pg_web_domain', pageFound: true, ancestors: [], rights: { ready: true, denied: null }, ...props };
  return render(
    <QueryClientProvider client={client}>
      <PageView {...all} />
    </QueryClientProvider>,
  );
}

const calls = (method: string, path: string) => api.calls.filter((call) => call.method === method && call.url.startsWith(path));
const toastTitles = () => currentToasts().map((item) => item.title);
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });

async function openVersions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Versionen …' }));
  return screen.findByRole('dialog', { name: 'Versionen von „Domain-Umzug“' });
}

describe('the versions of a wiki page', () => {
  it('lists the kept versions and restores one as a new version', async () => {
    const user = userEvent.setup();
    renderPage();
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    // typed and not saved yet: the restore saves it first, so it stays as a version
    act(() => editor.focus());
    paste(editor, 'Eben getippt. ');

    const dialog = await openVersions(user);
    const choices = await within(dialog).findAllByRole('radio');
    // the newest first, with who kept it and when (in the organisation's zone)
    expect(choices.map((choice) => choice.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Version 2, Ida Brenner, .*20\. Oktober 2026.*10:30/),
      expect.stringMatching(/^Version 1, Mara Lindqvist, .*14\. Oktober 2026.*09:15/),
    ]);
    expect((choices[0] as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: /^Version 1,/ }));
    const preview = within(dialog).getByRole('region', { name: 'Vorschau' });
    expect(await within(preview).findByText('Die alte Fassung.')).toBeTruthy();
    expect(within(preview).getByText('Domain')).toBeTruthy();

    // a restore runs once: the button waits for its answer (T7 carry)
    const held: (() => void)[] = [];
    const through = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/restore') ? new Promise<Response>((resolve) => held.push(() => resolve(through(input, init)))) : through(input, init);
    const restore = within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' });
    await user.click(restore);
    await waitFor(() => expect(held).toHaveLength(1));
    // the own text was saved before
    expect(api.calls.filter((call) => call.method !== 'GET').map((call) => call.method)).toEqual(['PATCH']);
    expect(restore.getAttribute('aria-busy')).toBe('true');
    await user.click(restore);
    expect(held).toHaveLength(1);
    await act(async () => held[0]!());

    await waitFor(() => expect(toastTitles()).toContain('Version 1 wiederhergestellt'));
    expect(calls('POST', '/api/v1/pages/pg_web_domain/versions/pv_1/restore')).toHaveLength(1);
    expect(currentToasts().find((item) => item.title === 'Version 1 wiederhergestellt')?.description).toBe('Die Fassung davor bleibt als Version erhalten.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the restored text is in the editor, the page in its new version
    await waitFor(() => expect(editor.textContent).toBe('Die alte Fassung.'));
    expect((screen.getByRole('textbox', { name: 'Titel der Seite' }) as HTMLTextAreaElement).value).toBe('Domain');
    expect(stored.version).toBe(5);
  });

  it('shows the text of a version when chosen', async () => {
    const user = userEvent.setup();
    let down = true;
    overrides['GET /api/v1/pages/pg_web_domain/versions/pv_2'] = () =>
      down
        ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } }
        : { body: { data: { ...v2, content: texts.pv_2, content_json: doc(texts.pv_2!) } } };
    // the version that holds the state of the page now is "aktuell", and cannot be restored
    kept = [version(3, 'u_mara', 'Domain-Umzug', '2026-10-27T08:00:00.000Z'), v2, v1];
    renderPage();
    const dialog = await openVersions(user);
    const current = await within(dialog).findByRole('radio', { name: /^Version 3, .*, aktuell$/ });
    expect((current as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByText('aktuell')).toBeTruthy();
    const restore = within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' });
    expect(restore.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Das ist die Fassung, die gerade gilt.')).toBeTruthy();
    expect(await within(dialog).findByText('Die Domain zieht im November um.', { selector: 'p' })).toBeTruthy();

    // a version whose text fails to load says so, and loads it again
    await user.click(within(dialog).getByRole('radio', { name: /^Version 2,/ }));
    expect(await within(dialog).findByText('Der Text der Version konnte nicht geladen werden')).toBeTruthy();
    expect(within(dialog).getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    down = false;
    await user.click(within(dialog).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(dialog).findByText('Die mittlere Fassung.')).toBeTruthy();
    expect(restore.getAttribute('aria-disabled')).toBeNull();
  });

  it('says the versions could not be loaded, and that there are none yet', async () => {
    const user = userEvent.setup();
    let down = true;
    overrides['GET /api/v1/pages/pg_web_domain/versions'] = () =>
      down ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } } : { body: list([]) };
    renderPage();
    const dialog = await openVersions(user);
    expect(await within(dialog).findByText('Die Versionen konnten nicht geladen werden')).toBeTruthy();
    down = false;
    await user.click(within(dialog).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(dialog).findByText('Noch keine Versionen')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Diese Version wiederherstellen' })).toBeNull();
  });

  it('refuses a restore while a conflict is open', async () => {
    const user = userEvent.setup();
    renderPage();
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    stored = { ...stored, version: 4, updated_by: 'u_ida' };
    act(() => editor.focus());
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('alert')).toBeTruthy();

    // the palette's command opens the versions too
    const command = listCommands().find((entry) => entry.id === 'wiki.page.versions');
    expect(command?.label).toBe('Versionen ansehen');
    expect(command?.group).toBe('Seite „Domain-Umzug“');
    act(() => command!.run());
    const dialog = await screen.findByRole('dialog', { name: 'Versionen von „Domain-Umzug“' });
    await user.click(await within(dialog).findByRole('radio', { name: /^Version 1,/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' }));

    await waitFor(() => expect(toastTitles()).toContain('Erst den Konflikt klären'));
    expect(currentToasts().find((item) => item.title === 'Erst den Konflikt klären')?.description).toBe(
      'Lade die neue Fassung oder übernimm deine. Danach lässt sich eine Version wiederherstellen.',
    );
    expect(calls('POST', '/api/v1/pages/pg_web_domain/versions')).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('says why it restores nothing while a picture uploads or the title is blank (T15-M3)', async () => {
    installFakeXhr();
    try {
      const user = userEvent.setup();
      renderPage();
      const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
      act(() => editor.focus());
      fireEvent.paste(editor, { clipboardData: { types: ['Files'], files: [new File([new Uint8Array([137, 80, 78, 71])], 'skizze.png', { type: 'image/png' })], getData: () => '' } });
      const dialog = await openVersions(user);
      await user.click(await within(dialog).findByRole('radio', { name: /^Version 1,/ }));
      const restore = within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' });

      await user.click(restore);
      await waitFor(() => expect(toastTitles()).toContain('Erst die Seite speichern'));
      expect(currentToasts().find((item) => item.title === 'Erst die Seite speichern')?.description).toBe(
        'Ein Bild wird noch hochgeladen. Danach lässt sich eine Version wiederherstellen.',
      );

      act(() => resetToasts());
      FakeXhr.last.abort();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await user.clear(screen.getByRole('textbox', { name: 'Titel der Seite' }));
      await user.click(await screen.findByRole('button', { name: 'Versionen …' }));
      const again = await screen.findByRole('dialog', { name: /^Versionen von/ });
      await user.click(await within(again).findByRole('radio', { name: /^Version 1,/ }));
      await user.click(within(again).getByRole('button', { name: 'Diese Version wiederherstellen' }));
      await waitFor(() => expect(currentToasts().find((item) => item.title === 'Erst die Seite speichern')?.description).toBe(
        'Die Seite braucht einen Titel. Danach lässt sich eine Version wiederherstellen.',
      ));
      expect(calls('POST', '/api/v1/pages/pg_web_domain/versions')).toHaveLength(0);
    } finally {
      restoreFakeXhr();
    }
  });

  it('lets a viewer read the versions without restoring', async () => {
    const user = userEvent.setup();
    renderPage({ rights: { ready: true, denied: 'Als Viewer liest du das Wiki nur.' } });
    const dialog = await openVersions(user);
    await user.click(await within(dialog).findByRole('radio', { name: /^Version 1,/ }));
    expect(await within(dialog).findByText('Die alte Fassung.')).toBeTruthy();
    const restore = within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' });
    expect(restore.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getAllByText('Als Viewer liest du das Wiki nur.').length).toBeGreaterThan(0);
    await user.click(restore);
    expect(calls('POST', '/api/v1/pages')).toHaveLength(0);
  });

  it('says the restore failed and offers to try again', async () => {
    const user = userEvent.setup();
    overrides['POST /api/v1/pages/pg_web_domain/versions/pv_1/restore'] = () => ({
      status: 503,
      body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' },
    });
    renderPage();
    const dialog = await openVersions(user);
    await user.click(await within(dialog).findByRole('radio', { name: /^Version 1,/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' }));
    await waitFor(() => expect(toastTitles()).toContain('Version 1 nicht wiederhergestellt'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
