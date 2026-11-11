/*
 * The edit conflict of a wiki page (`ConflictBanner`, `usePageSave`) on the open page, against a fake server that
 * refuses a save on an outdated version (409 `page_conflict` with the stored page), as the clickdummy's cases do:
 * keeping the own text, loading the other one and taking that back, a conflict met on leaving, a version saved after
 * "Neu laden" was taken back (13c), the question before the tab closes, and the own account in another window (T4-M5).
 * Inertia is a fake with the shared props the page reads.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { qk } from '@/hooks/keys';
import { drafts, pageDraft } from '@/lib/drafts';
import { clearLiveGone } from '@/lib/liveGone';
import { plainText } from '@/lib/richtext';
import { mockApi, type MockApi } from '@/test/api';
import { ida, list, makePage, mara, organization } from '@/test/fixtures';
import type { RichText, Page as WikiPage } from '@/types';
import { PageView, type PageViewProps } from './PageView';

const { visit } = vi.hoisted(() => ({ visit: vi.fn() }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization }, url: '/projects/WEB/wiki/pg_web_domain' }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  router: { visit, replace: vi.fn(), reload: vi.fn(), on: () => () => {} },
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
const names: Record<string, string> = { u_ida: 'Ida Brenner', u_mara: 'Mara Lindqvist' };

const domain = makePage({
  id: 'pg_web_domain',
  title: 'Domain-Umzug',
  content_json: doc('Die Domain zieht im November um.'),
  version: 3,
  updated_by: 'u_mara',
  updated_at: '2026-10-14T09:00:00.000Z',
});

/** The page as the server stores it. */
let stored: WikiPage;
let api: MockApi;

beforeEach(() => {
  stored = domain;
  visit.mockClear();
  api = mockApi({
    'GET /api/v1/users': () => ({ body: list([mara, ida]) }),
    'GET /api/v1/pages/pg_web_domain': () => ({ body: { data: stored } }),
    // the server's rule: a save on another version than the stored one is refused with the stored page
    'PATCH /api/v1/pages/pg_web_domain': (body) => {
      const sent = body as { title: string; emoji: string | null; content_json: RichText | null; base_version: number };
      if (sent.base_version !== stored.version) {
        const detail = `${names[stored.updated_by]} hat die Seite inzwischen geändert.`;
        return { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, reason: 'page_conflict', detail, current: stored } };
      }
      stored = { ...stored, title: sent.title, emoji: sent.emoji, content_json: sent.content_json, version: stored.version + 1, updated_by: 'u_mara' };
      return { body: { data: stored } };
    },
  });
});

afterEach(() => {
  api.restore();
  drafts.clear();
  clearLiveGone();
  act(() => resetToasts());
});

/** Somebody saves the page meanwhile: the server has a newer version, this tab does not know it yet. */
function othersSave(text: string, by = 'u_ida') {
  stored = { ...stored, content_json: doc(text), version: stored.version + 1, updated_by: by, updated_at: '2026-10-20T09:00:00.000Z' };
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), props: Partial<PageViewProps> = {}) {
  const all: PageViewProps = { projectId: 'p_web', identifier: 'WEB', pageId: 'pg_web_domain', pageFound: true, ancestors: [], rights: { ready: true, denied: null }, ...props };
  return { client, ...render(<QueryClientProvider client={client}><PageView {...all} /></QueryClientProvider>) };
}

const saves = () => api.calls.filter((call) => call.method === 'PATCH').map((call) => call.body as Record<string, unknown>);
const editorBox = () => screen.findByRole('textbox', { name: 'Inhalt der Seite' });
const toastTitled = (title: string) => currentToasts().find((item) => item.title === title);

/** Adds text where the editor's caret is (typed keys get mixed up by jsdom behind existing text). */
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });

/** Types the own text and saves at once (⌘↵); the server refuses it. */
async function meetConflict(user: ReturnType<typeof userEvent.setup>) {
  const editor = await editorBox();
  othersSave('Idas Nachtrag.');
  act(() => editor.focus());
  paste(editor, 'Meine Ergänzung. ');
  await user.keyboard('{Control>}{Enter}{/Control}');
  return { editor, banner: await screen.findByRole('alert') };
}

describe('a conflict on a wiki page', () => {
  it('shows a conflict when somebody saved in between; Meine Fassung übernehmen saves with keep_current', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);

    expect(within(banner).getByText('Ida Brenner hat die Seite inzwischen geändert.')).toBeTruthy();
    expect(banner.textContent).toContain('Deine Fassung steht noch im Editor. Lade die neue Fassung oder übernimm deine. Die andere bleibt dann als Version erhalten.');
    expect(editor.textContent).toContain('Meine Ergänzung.');
    expect(editor.textContent).not.toContain('Idas Nachtrag.');
    // what is typed is not stored, and the status region says so
    expect(within(document.querySelector('[data-save-status]') as HTMLElement).getByRole('status').textContent).toBe('Nicht gespeichert');
    // while the conflict stands, nothing saves
    act(() => editor.focus());
    paste(editor, 'Noch mehr. ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(saves()).toHaveLength(1);

    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(() => expect(stored.version).toBe(5));
    expect(saves().at(-1)).toMatchObject({ base_version: 4, keep_current: true });
    expect(plainText(stored.content_json)).toContain('Meine Ergänzung.');
    expect(screen.queryByRole('alert')).toBeNull();
    // the banner's buttons go with it: the focus goes on into the text
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it('Neu laden takes the other text into the editor and drops the own one', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);

    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(editor.textContent).toBe('Idas Nachtrag.'));
    expect(drafts.page(pageDraft('pg_web_domain'))).toBeNull();
    expect(saves()).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect(toastTitled('Deine Fassung verworfen')?.description).toBe('Im Editor steht jetzt die neue Fassung.');
  });

  it('Neu laden can be taken back: the own text and the banner return', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(editor.textContent).toBe('Idas Nachtrag.'));

    const dropped = toastTitled('Deine Fassung verworfen');
    expect(dropped?.action?.label).toBe('Rückgängig');
    act(() => runToastAction(dropped!.id));

    await waitFor(() => expect(editor.textContent).toContain('Meine Ergänzung.'));
    const again = await screen.findByRole('alert');
    expect(within(again).getByText('Ida Brenner hat die Seite inzwischen geändert.')).toBeTruthy();
    expect(drafts.page(pageDraft('pg_web_domain'))?.conflict?.current.version).toBe(4);
    await user.click(within(again).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(() => expect(plainText(stored.content_json)).toContain('Meine Ergänzung.'));
    expect(saves().at(-1)).toMatchObject({ base_version: 4, keep_current: true });
  });

  it('an undo of Neu laden that a blank title holds up says so and puts the focus in the title', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(editor.textContent).toBe('Idas Nachtrag.'));
    const title = screen.getByRole('textbox', { name: 'Titel der Seite' });
    await user.clear(title);
    act(() => editor.focus());

    act(() => runToastAction(toastTitled('Deine Fassung verworfen')!.id));

    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(toastTitled('Deine Fassung nicht zurückgeholt: Gib der Seite erst einen Titel.')?.tone).toBe('error');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor.textContent).toBe('Idas Nachtrag.');
  });

  it('a conflict met on leaving comes back with the page as the server has it', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    const editor = await editorBox();
    othersSave('Idas Nachtrag.');
    first.client.setQueryData(qk.pages.list({ project: 'p_web' }), list([]));
    act(() => editor.focus());
    paste(editor, 'Meine Ergänzung. ');
    // left before the pause runs out: the save on leaving meets the conflict
    first.unmount();

    await waitFor(() => expect(toastTitled('„Domain-Umzug“ nicht gespeichert')).toBeTruthy());
    const left = toastTitled('„Domain-Umzug“ nicht gespeichert')!;
    expect(left.description).toBe('Ida Brenner hat die Seite inzwischen geändert. Deine Fassung wartet auf der Seite.');
    // the stored page went into the cache, and the tree is stale
    expect(first.client.getQueryData<WikiPage>(qk.pages.detail('pg_web_domain'))?.version).toBe(4);
    expect(first.client.getQueryState(qk.pages.list({ project: 'p_web' }))?.isInvalidated).toBe(true);
    expect(left.action?.label).toBe('Öffnen');
    act(() => runToastAction(left.id));
    expect(visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_domain');

    // opened again, as "Öffnen" does
    renderPage(first.client);
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('Ida Brenner hat die Seite inzwischen geändert.')).toBeTruthy();
    expect((await editorBox()).textContent).toContain('Meine Ergänzung.');
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    await waitFor(async () => expect((await editorBox()).textContent).toBe('Idas Nachtrag.'));
    expect(await screen.findByText('Zuletzt geändert von Ida Brenner am 20.10.2026')).toBeTruthy();
  });

  it('after taking back Neu laden, a version saved meanwhile counts: Meine Fassung übernehmen saves at once and asks to keep it', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(editor.textContent).toBe('Idas Nachtrag.'));
    // written on in the other text and saved: version 5
    act(() => editor.focus());
    paste(editor, 'Noch ein Satz. ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(stored.version).toBe(5));

    act(() => runToastAction(toastTitled('Deine Fassung verworfen')!.id));
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Meine Fassung übernehmen' }));

    await waitFor(() => expect(stored.version).toBe(6));
    // on top of version 5 at once (no second conflict), and the server keeps version 5 as a version first (A307)
    expect(saves()).toHaveLength(3);
    expect(saves()[2]).toMatchObject({ base_version: 5, keep_current: true });
    expect(plainText(stored.content_json)).toContain('Meine Ergänzung.');
    expect(plainText(stored.content_json)).not.toContain('Noch ein Satz.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('after taking back Neu laden, Neu laden again loads the version saved meanwhile', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(editor.textContent).toBe('Idas Nachtrag.'));
    act(() => editor.focus());
    paste(editor, 'Noch ein Satz. ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(stored.version).toBe(5));
    const saved = editor.textContent;

    act(() => runToastAction(toastTitled('Deine Fassung verworfen')!.id));
    await waitFor(() => expect(editor.textContent).toContain('Meine Ergänzung.'));
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Neu laden' }));
    // the stored state is the own version 5 now, not the one the conflict first met
    await waitFor(() => expect(editor.textContent).toBe(saved));
    expect(saved).toContain('Noch ein Satz.');
  });

  it('⌘Z in the editor after Neu laden does not bring the own text back over the other one', async () => {
    const user = userEvent.setup();
    renderPage();
    const { editor, banner } = await meetConflict(user);
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect(editor.textContent).toBe('Idas Nachtrag.');

    // the editor's own undo: the other version is where its history begins
    await user.keyboard('{Control>}z{/Control}{Control>}z{/Control}');
    expect(editor.textContent).toBe('Idas Nachtrag.');
    // nothing changed, so nothing is typed that would save over it
    expect(drafts.page(pageDraft('pg_web_domain'))).toBeNull();
    expect(saves()).toHaveLength(1);
  });

  it('a conflict standing when the page is left says so in a toast with Öffnen', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await meetConflict(user);
    unmount();

    const left = toastTitled('„Domain-Umzug“ nicht gespeichert');
    expect(left?.description).toBe('Ida Brenner hat die Seite inzwischen geändert. Deine Fassung wartet auf der Seite.');
    expect(left?.action?.label).toBe('Öffnen');
    act(() => runToastAction(left!.id));
    expect(visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_domain');
    // the text and the conflict wait in the draft, and nothing was sent on leaving
    expect(drafts.page(pageDraft('pg_web_domain'))?.conflict?.current.version).toBe(4);
    expect(saves()).toHaveLength(1);
  });

  it('asks before the tab closes while a conflict is open', async () => {
    const user = userEvent.setup();
    renderPage();
    const { banner } = await meetConflict(user);
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(true);
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    expect(closing()).toBe(false);
  });

  it('says the other save was the own one in another window', async () => {
    const user = userEvent.setup();
    renderPage();
    const editor = await editorBox();
    othersSave('Aus dem anderen Fenster.', 'u_mara');
    act(() => editor.focus());
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    const banner = await screen.findByRole('alert');
    // the server names the account that saved last: here the person's own
    expect(within(banner).getByText('Du hast die Seite inzwischen in einem anderen Fenster geändert.')).toBeTruthy();
    expect(banner.textContent).not.toContain('Mara Lindqvist');
  });
});
