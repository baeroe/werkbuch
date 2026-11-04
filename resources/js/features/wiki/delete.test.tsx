/*
 * Deleting wiki pages on the wiki screen against a fake REST API (`test/wiki.tsx`), ported from the clickdummy's
 * wiki.test.tsx: the question on every way to delete (menu, ⌘⌫ on the page and on a row, the palette), the subpages it
 * names, the pages gone at once and deleted when the undo toast runs out, "Rückgängig", "Abbrechen" and the focus.
 * Inertia is a fake: `router.visit` is recorded, and the tests make the visit with `go` (address and props together).
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { listCommands } from '@/lib/commands';
import { drafts } from '@/lib/drafts';
import { clearLiveGone } from '@/lib/liveGone';
import { useUiStore } from '@/store/ui';
import { mara, organization, webTree } from '@/test/fixtures';
import { callsTo, renderWiki, startWikiServer, stopWikiServer, wiki } from '@/test/wiki';
import type { PageNode } from '@/types';
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
  inertia.go('/projects/WEB/wiki');
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  startWikiServer();
});

afterEach(() => {
  stopWikiServer();
  clearLiveGone();
  clearHiddenPages();
  drafts.clear();
  useUiStore.setState({ peekItemId: null });
  act(() => resetToasts());
});

/** The wiki of WEB with a page open. */
function openPage(id: string) {
  inertia.go(`/projects/WEB/wiki/${id}`);
  return renderWiki({ pageId: id, pageFound: true }, inertia.go);
}

const pagesTree = () => screen.findByRole('tree', { name: 'Seiten' });
const row = (name: string) => within(screen.getByRole('tree', { name: 'Seiten', hidden: true })).queryByRole('treeitem', { name, hidden: true });
const toastTitles = () => currentToasts().map((item) => item.title);
const toastOf = (title: string) => currentToasts().find((item) => item.title === title)!;
const deletes = () => (wiki.api?.calls ?? []).filter((call) => call.method === 'DELETE');
const pageLoaded = () => screen.findByRole('textbox', { name: 'Titel der Seite' });

async function askFromMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
  await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));
}

describe('deleting wiki pages', () => {
  it('asks before it deletes a page without subpages; Seite löschen deletes it with undo, which brings it back', async () => {
    const user = userEvent.setup();
    const { go } = openPage('pg_web_kickoff');
    await pageLoaded();
    const tree = await pagesTree();
    await askFromMenu(user);

    // nothing is gone yet: the question comes first
    const ask = await screen.findByRole('alertdialog', { name: '„Kickoff-Notizen“ löschen?' });
    expect(within(ask).getByText('Fünf Sekunden lang lässt sich das rückgängig machen.')).toBeTruthy();
    expect(within(ask).getByRole('button', { name: 'Seite löschen' })).toBeTruthy();
    expect(toastTitles()).toEqual([]);
    expect(row('Kickoff-Notizen')).toBeTruthy();

    await user.click(within(ask).getByRole('button', { name: 'Seite löschen' }));

    await waitFor(() => expect(within(tree).queryByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeNull());
    // the open page gives way to its parent page
    expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_meetings');
    go('/projects/WEB/wiki/pg_web_meetings', { pageId: 'pg_web_meetings', pageFound: true });
    const undo = toastOf('„Kickoff-Notizen“ gelöscht');
    expect(undo.action?.label).toBe('Rückgängig');
    expect(deletes()).toEqual([]);
    // the focus goes to the parent page: its heading (jsdom draws no tree row)
    await waitFor(() => expect(document.activeElement?.closest('[data-screen-heading]')).toBeTruthy());

    act(() => runToastAction(undo.id));

    expect(await within(tree).findByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeTruthy();
    expect(inertia.visit).toHaveBeenLastCalledWith('/projects/WEB/wiki/pg_web_kickoff');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deletes()).toEqual([]);
  });

  it('names a single subpage in the singular', async () => {
    const user = userEvent.setup();
    openPage('pg_web_meetings');
    await pageLoaded();
    await askFromMenu(user);

    const ask = await screen.findByRole('alertdialog', { name: '„Meetings“ mit 1 Unterseite löschen?' });
    expect(ask.textContent).toContain('Mit der Seite verschwindet auch ihre Unterseite „Kickoff-Notizen“.');
    await user.click(within(ask).getByRole('button', { name: '2 Seiten löschen' }));
    await waitFor(() => expect(toastTitles()).toContain('„Meetings“ und 1 Unterseite gelöscht'));
    // the top level page gives way to the overview
    expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki');
  });

  it('names how many subpages go along, hides them at once, and deletes only when the toast runs out', async () => {
    const user = userEvent.setup();
    const { go } = openPage('pg_web_handbook');
    await pageLoaded();
    const tree = await pagesTree();

    await askFromMenu(user);
    const ask = await screen.findByRole('alertdialog', { name: '„Projekt-Handbuch“ mit 4 Unterseiten löschen?' });
    expect(ask.textContent).toContain('Mit der Seite verschwinden auch ihre 4 Unterseiten: „Seitenstruktur“, „Designsystem“, „Typografie und Farben“ und „Redaktion und Tonalität“.');
    await user.click(within(ask).getByRole('button', { name: '5 Seiten löschen' }));

    await waitFor(() => expect(within(tree).queryByRole('treeitem', { name: 'Seitenstruktur' })).toBeNull());
    expect(within(tree).queryByRole('treeitem', { name: 'Projekt-Handbuch' })).toBeNull();
    expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki');
    go('/projects/WEB/wiki', { pageId: null, pageFound: false });
    expect(toastTitles()).toContain('„Projekt-Handbuch“ und 4 Unterseiten gelöscht');
    // the focus goes to the heading of the overview
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Wiki' })));
    expect(deletes()).toEqual([]);

    // the person moved on: "Rückgängig" brings the pages back, but does not lead away
    go('/projects/WEB/wiki/pg_web_tech', { pageId: 'pg_web_tech', pageFound: true });
    act(() => runToastAction(toastOf('„Projekt-Handbuch“ und 4 Unterseiten gelöscht').id));
    expect(await within(tree).findByRole('treeitem', { name: 'Seitenstruktur' })).toBeTruthy();
    expect(inertia.visit).toHaveBeenCalledTimes(1);

    // again, and this time the toast runs out
    act(() => within(tree).getByRole('treeitem', { name: 'Projekt-Handbuch' }).focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '5 Seiten löschen' }));
    await waitFor(() => expect(toastTitles()).toContain('„Projekt-Handbuch“ und 4 Unterseiten gelöscht'));
    act(() => dismissToast(toastOf('„Projekt-Handbuch“ und 4 Unterseiten gelöscht').id));
    await waitFor(() => expect(deletes().map((call) => call.url)).toEqual(['/api/v1/pages/pg_web_handbook']));
    // the tree loads again without them, and they stay gone
    await waitFor(() => expect(callsTo('GET', '/api/v1/projects/p_web/pages').length).toBeGreaterThan(1));
    expect(within(tree).queryByRole('treeitem', { name: 'Projekt-Handbuch' })).toBeNull();
    expect(within(tree).getByRole('treeitem', { name: 'Technik' })).toBeTruthy();
  });

  it('names five subpages at most and counts the rest', async () => {
    const user = userEvent.setup();
    const child = (index: number): PageNode => ({ ...webTree[2].children[0], id: `pg_web_note_${index}`, title: `Notiz ${index}`, parent_id: 'pg_web_meetings', children: [] });
    wiki.tree = [webTree[0], webTree[1], { ...webTree[2], children: [1, 2, 3, 4, 5, 6, 7].map(child) }];
    openPage('pg_web_meetings');
    await pageLoaded();
    await askFromMenu(user);
    const ask = await screen.findByRole('alertdialog', { name: '„Meetings“ mit 7 Unterseiten löschen?' });
    expect(ask.textContent).toContain('Mit der Seite verschwinden auch ihre 7 Unterseiten: „Notiz 1“, „Notiz 2“, „Notiz 3“, „Notiz 4“, „Notiz 5“ und 2 weitere.');
    expect(within(ask).getByRole('button', { name: '8 Seiten löschen' })).toBeTruthy();
  });

  it('Abbrechen keeps the page, and the focus goes back', async () => {
    const user = userEvent.setup();
    openPage('pg_web_structure');
    await pageLoaded();
    const tree = await pagesTree();
    const kickoff = within(tree).getByRole('treeitem', { name: 'Kickoff-Notizen' });

    // from the tree: mod+backspace on the row
    act(() => kickoff.focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');
    const ask = await screen.findByRole('alertdialog', { name: '„Kickoff-Notizen“ löschen?' });
    await user.click(within(ask).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(kickoff));
    expect(within(tree).getByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeTruthy();

    // from the page's menu: back on its button
    const more = screen.getByRole('button', { name: 'Weitere Aktionen' });
    await askFromMenu(user);
    await user.click(within(await screen.findByRole('alertdialog', { name: '„Seitenstruktur“ löschen?' })).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
    expect(toastTitles()).toEqual([]);
    expect(inertia.visit).not.toHaveBeenCalled();
  });

  it('asks on every way to delete', async () => {
    const user = userEvent.setup();
    openPage('pg_web_kickoff');
    await pageLoaded();
    await pagesTree();

    // the page's own shortcut, with the focus outside any field
    act(() => screen.getByRole('button', { name: 'Weitere Aktionen' }).focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');
    await user.click(within(await screen.findByRole('alertdialog', { name: '„Kickoff-Notizen“ löschen?' })).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // the palette's commands of the page
    const command = (id: string) => listCommands().find((entry) => entry.id === id);
    expect(command('wiki.page.delete')).toMatchObject({ label: 'Seite löschen …', group: 'Seite „Kickoff-Notizen“', keys: 'mod+backspace' });
    act(() => command('wiki.page.delete')!.run());
    expect(await screen.findByRole('alertdialog', { name: '„Kickoff-Notizen“ löschen?' })).toBeTruthy();
    expect(toastTitles()).toEqual([]);
    expect(deletes()).toEqual([]);
  });

  it('offers nothing to delete to a viewer', async () => {
    wiki.project = { ...wiki.project, my_role: 'viewer' };
    try {
      const user = userEvent.setup();
      openPage('pg_web_kickoff');
      expect(await screen.findByRole('heading', { level: 1, name: 'Kickoff-Notizen' })).toBeTruthy();
      const tree = await pagesTree();
      expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
      expect(listCommands().filter((entry) => ['wiki.page.delete', 'wiki.page.move', 'wiki.page.child'].includes(entry.id) && entry.when?.() !== false)).toEqual([]);
      act(() => within(tree).getByRole('treeitem', { name: 'Meetings' }).focus());
      await user.keyboard('{Control>}{Backspace}{/Control}');
      expect(screen.queryByRole('alertdialog')).toBeNull();
    } finally {
      wiki.project = { ...wiki.project, my_role: 'member' };
    }
  });

  it('deletes the page of the focused row, not the open page', async () => {
    const user = userEvent.setup();
    openPage('pg_web_structure');
    await pageLoaded();
    const tree = await pagesTree();

    act(() => within(tree).getByRole('treeitem', { name: 'Kickoff-Notizen' }).focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');
    await user.click(within(await screen.findByRole('alertdialog', { name: '„Kickoff-Notizen“ löschen?' })).getByRole('button', { name: 'Seite löschen' }));

    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ gelöscht'));
    expect(within(tree).queryByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeNull();
    expect(within(tree).getByRole('treeitem', { name: 'Seitenstruktur' })).toBeTruthy();
    expect(inertia.visit).not.toHaveBeenCalled();

    // "Rückgängig" brings it back and leads nowhere: it was not open
    act(() => runToastAction(toastOf('„Kickoff-Notizen“ gelöscht').id));
    expect(await within(tree).findByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeTruthy();
    expect(inertia.visit).not.toHaveBeenCalled();
  });

  it('brings the pages back when the delete fails', async () => {
    const user = userEvent.setup();
    wiki.overrides['DELETE /api/v1/pages/pg_web_kickoff'] = () => ({ status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } });
    openPage('pg_web_structure');
    await pageLoaded();
    const tree = await pagesTree();
    act(() => within(tree).getByRole('treeitem', { name: 'Kickoff-Notizen' }).focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Seite löschen' }));
    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ gelöscht'));
    act(() => dismissToast(toastOf('„Kickoff-Notizen“ gelöscht').id));

    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ nicht gelöscht'));
    expect(await within(tree).findByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeTruthy();
  });

  it('never asks for the deleted page again', async () => {
    const user = userEvent.setup();
    const { go } = openPage('pg_web_kickoff');
    await pageLoaded();
    await pagesTree();
    act(() => screen.getByRole('button', { name: 'Weitere Aktionen' }).focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Seite löschen' }));
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_meetings'));
    go('/projects/WEB/wiki/pg_web_meetings', { pageId: 'pg_web_meetings', pageFound: true });
    await screen.findByRole('textbox', { name: 'Titel der Seite' });
    act(() => dismissToast(toastOf('„Kickoff-Notizen“ gelöscht').id));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    const deletedAt = wiki.api!.calls.indexOf(deletes()[0]);
    await waitFor(() => expect(callsTo('GET', '/api/v1/projects/p_web/pages').length).toBeGreaterThan(1));

    // back to it (the browser's back): the page says it was deleted, without asking for it
    go('/projects/WEB/wiki/pg_web_kickoff', { pageId: 'pg_web_kickoff', pageFound: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite wurde gelöscht' })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = wiki.api!.calls.slice(deletedAt + 1);
    expect(after.filter((call) => call.method === 'GET' && call.url.startsWith('/api/v1/pages/pg_web_kickoff'))).toEqual([]);
  });
});
