/*
 * "Verschieben nach …" on the wiki screen against a fake REST API (`test/wiki.tsx`), ported from the clickdummy's
 * wiki.test.tsx: the dialog by keyboard, the candidates (never the page or its subtree), a page that would stay where
 * it is, the move shown at once and taken back on a refusal (a 422 at the field, anything else as a toast), and
 * "Unterseite anlegen".
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { listCommands } from '@/lib/commands';
import { drafts } from '@/lib/drafts';
import { clearLiveGone } from '@/lib/liveGone';
import { mara, organization } from '@/test/fixtures';
import { callsTo, renderWiki, startWikiServer, stopWikiServer, wiki } from '@/test/wiki';
import { clearHiddenPages } from './Wiki';

const inertia = vi.hoisted(() => {
  let url = '/projects/WEB/wiki';
  const listeners = new Set<() => void>();
  return {
    get url() {
      return url;
    },
    go(next: string) {
      url = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    visit: vi.fn(),
    replace: vi.fn(),
  };
});

vi.mock('@inertiajs/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePage: () => ({
      props: { auth: { user: mara, permissions: [] }, organization },
      url: useSyncExternalStore(inertia.subscribe, () => inertia.url),
    }),
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
    router: { visit: inertia.visit, replace: inertia.replace, reload: vi.fn(), on: () => () => {} },
  };
});

beforeAll(async () => {
  // jsdom has no layout: ProseMirror measures the selection to scroll it into view
  await preloadEditor();
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

beforeEach(() => {
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  startWikiServer();
});

afterEach(() => {
  stopWikiServer();
  clearLiveGone();
  clearHiddenPages();
  drafts.clear();
  act(() => resetToasts());
});

function openPage(id: string) {
  inertia.go(`/projects/WEB/wiki/${id}`);
  return renderWiki({ pageId: id, pageFound: true }, inertia.go);
}

const pagesTree = () => screen.findByRole('tree', { name: 'Seiten' });
const toastTitles = () => currentToasts().map((item) => item.title);
const moves = () => callsTo('POST', '/api/v1/pages/pg_web_kickoff/move');
const pageLoaded = () => screen.findByRole('textbox', { name: 'Titel der Seite' });

async function openMove(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Verschieben nach …' }));
  return screen.findByRole('dialog', { name: `„${title}“ verschieben nach …` });
}

describe('moving wiki pages', () => {
  it('moves a page by keyboard with Verschieben nach …', async () => {
    const user = userEvent.setup();
    openPage('pg_web_kickoff');
    await pageLoaded();
    const tree = await pagesTree();
    const dialog = await openMove(user, 'Kickoff-Notizen');

    // it starts where the page stands
    const under = within(dialog).getByRole('combobox', { name: 'Unter: Meetings' });
    expect(within(dialog).getByRole('combobox', { name: /^Position/ }).textContent).toContain('Am Ende');
    act(() => under.focus());
    await user.keyboard('{Enter}');
    const search = await screen.findByRole('combobox', { name: 'Seite suchen …' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    // every page is offered but the page itself
    expect(screen.queryByRole('option', { name: /^Kickoff-Notizen/ })).toBeNull();
    expect(screen.getByRole('option', { name: /^Oberste Ebene/ })).toBeTruthy();
    await user.keyboard('Redaktion');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Unter: Redaktion und Tonalität' })).toBeTruthy());
    expect(within(dialog).getByText('Unter „Redaktion und Tonalität“.')).toBeTruthy();

    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(moves().map((call) => call.body)).toEqual([{ parent_id: 'pg_web_editorial', before_id: null }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const moved = within(tree).getByRole('treeitem', { name: 'Kickoff-Notizen' });
    expect(moved.getAttribute('aria-level')).toBe('3');
    expect(within(tree).getByRole('treeitem', { name: 'Meetings' }).getAttribute('aria-expanded')).toBeNull();
    const done = currentToasts().find((item) => item.title === '„Kickoff-Notizen“ verschoben')!;
    expect(done.description).toBe('Jetzt unter „Redaktion und Tonalität“.');
  });

  it('never offers the page or its subpages as the new parent, and moves to the top level in front of a page', async () => {
    const user = userEvent.setup();
    openPage('pg_web_tech');
    await pageLoaded();
    await pagesTree();
    // from the palette
    act(() => listCommands().find((entry) => entry.id === 'wiki.page.move')!.run());
    const dialog = await screen.findByRole('dialog', { name: '„Technik“ verschieben nach …' });
    expect(within(dialog).getByText(/Die Unterseiten wandern mit/)).toBeTruthy();

    await user.click(within(dialog).getByRole('combobox', { name: 'Unter: Oberste Ebene' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /^Projekt-Handbuch/ })).toBeTruthy());
    for (const own of ['Technik', 'Kontaktformular – Technik', 'Deployment und Hosting', 'Domain-Umzug', 'Performance-Budget']) {
      expect(screen.queryByRole('option', { name: new RegExp(`^${own}`) })).toBeNull();
    }
    // a page below another says where it stands
    expect(screen.getByRole('option', { name: /^Seitenstruktur/ }).textContent).toContain('unter „Projekt-Handbuch“');
    await user.click(screen.getByRole('option', { name: /^Meetings/ }));
    // another parent starts at the end; back on its own parent the position is its own again
    expect(within(dialog).getByRole('combobox', { name: /^Position/ }).textContent).toContain('Am Ende');
    await user.click(within(dialog).getByRole('combobox', { name: 'Unter: Meetings' }));
    await user.click(await screen.findByRole('option', { name: /^Oberste Ebene/ }));
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /^Position/ }).textContent).toContain('Vor „Meetings“'));

    await user.click(within(dialog).getByRole('combobox', { name: /^Position/ }));
    await user.click(await screen.findByRole('option', { name: 'Vor „Projekt-Handbuch“' }));
    expect(within(dialog).getByText('Auf der obersten Ebene des Wikis.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /^Verschieben/ }));

    await waitFor(() => expect(callsTo('POST', '/api/v1/pages/pg_web_tech/move').map((call) => call.body)).toEqual([{ parent_id: null, before_id: 'pg_web_handbook' }]));
    await waitFor(() => expect(currentToasts().find((item) => item.title === '„Technik“ verschoben')?.description).toBe('Jetzt auf der obersten Ebene.'));
  });

  it('says why nothing moves when the page would stay where it is', async () => {
    const user = userEvent.setup();
    openPage('pg_web_kickoff');
    await pageLoaded();
    const dialog = await openMove(user, 'Kickoff-Notizen');

    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(await within(dialog).findByText('Die Seite bleibt, wo sie ist. Wähle eine andere übergeordnete Seite oder Position.')).toBeTruthy();
    expect(moves()).toEqual([]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('takes the move back when the server refuses it', async () => {
    const user = userEvent.setup();
    let answer: { status: number; body: unknown } = {
      status: 422,
      body: { type: 'about:blank', title: 'invalid', status: 422, reason: 'validation_failed', errors: { parent_id: ['Diese Seite gibt es in diesem Wiki nicht.'] } },
    };
    let release: () => void = () => {};
    wiki.overrides['POST /api/v1/pages/pg_web_kickoff/move'] = () => answer;
    openPage('pg_web_kickoff');
    await pageLoaded();
    const tree = await pagesTree();
    let dialog = await openMove(user, 'Kickoff-Notizen');
    await user.click(within(dialog).getByRole('combobox', { name: 'Unter: Meetings' }));
    await user.click(await screen.findByRole('option', { name: /^Projekt-Handbuch/ }));

    // the move shows at once, before the server answers
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      String(input).endsWith('/move') ? new Promise<Response>((resolve) => (release = () => void original(input, init).then(resolve))) : original(input, init);
    try {
      await user.click(within(dialog).getByRole('button', { name: /^Verschieben/ }));
      await waitFor(() => expect(within(tree).getByRole('treeitem', { name: 'Kickoff-Notizen', hidden: true }).getAttribute('aria-level')).toBe('2'));
      expect(within(tree).getByRole('treeitem', { name: 'Meetings', hidden: true }).getAttribute('aria-expanded')).toBeNull();
      act(() => release());
    } finally {
      globalThis.fetch = original;
    }

    // a 422: back where it was, the refusal at the field, the dialog stays open
    const error = await within(dialog).findByText('Diese Seite gibt es in diesem Wiki nicht.');
    expect(error).toBeTruthy();
    expect(within(tree).getByRole('treeitem', { name: 'Meetings', hidden: true }).getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByRole('combobox', { name: 'Unter: Projekt-Handbuch' }).getAttribute('aria-invalid')).toBe('true');
    expect(toastTitles()).toEqual([]);

    // anything else: back again, and a toast says so
    answer = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };
    await user.click(within(dialog).getByRole('button', { name: /^Verschieben/ }));
    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ nicht verschoben'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(tree).getByRole('treeitem', { name: 'Meetings' }).getAttribute('aria-expanded')).toBe('true');

    // "Erneut versuchen" moves once more
    answer = { status: 200, body: { data: { ...wiki.tree[2].children[0], parent_id: 'pg_web_handbook' } } };
    const failed = currentToasts().find((item) => item.title === '„Kickoff-Notizen“ nicht verschoben')!;
    act(() => failed.action!.onClick());
    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ verschoben'));
    expect(moves()).toHaveLength(3);
    dialog = screen.queryByRole('dialog') as HTMLElement;
    expect(dialog).toBeNull();
  });

  it('adds a subpage from the menu and the palette', async () => {
    const user = userEvent.setup();
    openPage('pg_web_kickoff');
    await pageLoaded();
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Unterseite anlegen' }));
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_new?focus=title'));
    expect(callsTo('POST', '/api/v1/projects/p_web/pages').map((call) => call.body)).toMatchObject([{ parent_id: 'pg_web_kickoff', title: 'Neue Seite' }]);

    act(() => listCommands().find((entry) => entry.id === 'wiki.page.child')!.run());
    await waitFor(() => expect(callsTo('POST', '/api/v1/projects/p_web/pages')).toHaveLength(2));
  });
});
