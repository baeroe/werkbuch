/*
 * Dragging pages in the wiki tree with the pointer (`useTreeDrag`), on the wiki screen against the fake REST API of
 * `test/wiki.tsx`. jsdom lays nothing out: `layTreeOut()` stacks the rows of the tree 32 px apart (the overlay of
 * dnd-kit stands where its inline style puts it), so a pointer can be pressed on a row's handle and let go over another
 * row. dnd-kit's pointer sensor starts a drag after 5 px; jsdom has no Web Animations, so the drop animation finishes at
 * once. The move itself goes through the wiki's `move` (`useMovePage`): shown at once, taken back on a refusal.
 */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { drafts } from '@/lib/drafts';
import { clearLiveGone } from '@/lib/liveGone';
import { mara, organization } from '@/test/fixtures';
import { callsTo, renderWiki, startWikiServer, stopWikiServer, wiki } from '@/test/wiki';
import pageTreeSource from './PageTree.tsx?raw';
import { DROPPING } from './useTreeDrag';
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
    router: { visit: vi.fn(), replace: vi.fn(), reload: vi.fn(), on: () => () => {} },
  };
});

/* ------------------------------------------------------------------- layout in jsdom */

const ROW = 32;
const WIDTH = 256;

/** Stacks the rows of the tree; returns the function that takes it back. */
function layTreeOut(): () => void {
  const boundingRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const row = this.closest('[role="tree"] > li');
    if (row) return new DOMRect(0, [...row.parentElement!.children].indexOf(row) * ROW, WIDTH, ROW);
    // the overlay of dnd-kit (it measures the copy in it): fixed where the row stood when it was picked up
    let fixed: Element | null = this;
    while (fixed instanceof HTMLElement && fixed.style.position !== 'fixed') fixed = fixed.parentElement;
    if (fixed instanceof HTMLElement) {
      const { left, top, width, height } = fixed.style;
      return new DOMRect(parseFloat(left) || 0, parseFloat(top) || 0, parseFloat(width) || 0, parseFloat(height) || 0);
    }
    return boundingRect.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = boundingRect;
  };
}

let restoreLayout = () => {};
const animate = Element.prototype.animate;
beforeAll(() => {
  restoreLayout = layTreeOut();
  // the drop animation of the overlay: done at once
  Element.prototype.animate = function () {
    const animation = {
      set onfinish(done: () => void) {
        setTimeout(done, 0);
      },
    };
    return animation as unknown as Animation;
  };
});

afterAll(() => {
  restoreLayout();
  Element.prototype.animate = animate;
});

beforeEach(() => {
  inertia.go('/projects/WEB/wiki');
  startWikiServer();
});

afterEach(() => {
  stopWikiServer();
  clearLiveGone();
  clearHiddenPages();
  drafts.clear();
  act(() => resetToasts());
});

/* ---------------------------------------------------------------------- the pointer */

const pagesTree = () => screen.findByRole('tree', { name: 'Seiten' });
const toastTitles = () => currentToasts().map((item) => item.title);
/** What dnd-kit's live region says last. */
const dndSaid = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
const rowOf = (tree: HTMLElement, title: string) => within(tree).getByRole('treeitem', { name: title, hidden: true });
/** The titles of the rows in reading order, with their level. */
const outline = (tree: HTMLElement) => within(tree).queryAllByRole('treeitem', { hidden: true }).map((row) => `${row.getAttribute('aria-level')} ${row.textContent}`);
const handleOf = (tree: HTMLElement, title: string) => rowOf(tree, title).closest('li')!.querySelector<HTMLElement>('[data-drag-handle]');

interface Point {
  clientX: number;
  clientY: number;
}

function middle(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

/** Presses the pointer on a row's handle and moves it past the 5 px that start a drag; answers the point it started at. */
async function pickUp(tree: HTMLElement, title: string): Promise<Point> {
  // a row can be picked up once the rights are known
  await waitFor(() => expect(handleOf(tree, title)).toBeTruthy());
  const handle = handleOf(tree, title)!;
  const at = middle(handle);
  act(() => void fireEvent.pointerDown(handle, { button: 0, isPrimary: true, ...at }));
  act(() => void fireEvent.pointerMove(document, { isPrimary: true, clientX: at.clientX, clientY: at.clientY + 6 }));
  await waitFor(() => expect(dndSaid()).toMatch(new RegExp(`^„${title}“`)));
  return at;
}

const pointTo = (at: Point, dx: number, dy: number) => act(() => void fireEvent.pointerMove(document, { isPrimary: true, clientX: at.clientX + dx, clientY: at.clientY + dy }));
const letGo = (at: Point, dx: number, dy: number) => act(() => void fireEvent.pointerUp(document, { isPrimary: true, clientX: at.clientX + dx, clientY: at.clientY + dy }));

describe('dragging pages in the tree', () => {
  it('drags a page under the row above by pulling it sideways', async () => {
    renderWiki({}, inertia.go);
    const tree = await pagesTree();
    const at = await pickUp(tree, 'Deployment und Hosting');
    expect(dndSaid()).toBe('„Deployment und Hosting“ aufgenommen.');

    // 11 px sideways keeps the depth; from 12 px (three quarters of an indent) the page goes one level deeper
    pointTo(at, 11, 0);
    expect(document.querySelector('[data-drop-line]')?.getAttribute('data-depth')).toBe('1');
    pointTo(at, 12, 0);
    expect(document.querySelector('[data-drop-line]')?.getAttribute('data-depth')).toBe('2');
    await waitFor(() => expect(dndSaid()).toBe('„Deployment und Hosting“ kommt unter „Kontaktformular – Technik“.'));
    // the overlay is a picture of the row only
    const overlay = document.querySelector<HTMLElement>('[data-drag-overlay]')!;
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.hasAttribute('inert')).toBe(true);
    expect(overlay.textContent).toContain('Deployment und Hosting');
    expect(overlay.textContent).toContain('mit 1 Unterseite');

    letGo(at, 16, 0);
    await waitFor(() => expect(toastTitles()).toContain('„Deployment und Hosting“ verschoben'));
    expect(callsTo('POST', '/api/v1/pages/pg_web_hosting/move').map((call) => call.body)).toEqual([{ parent_id: 'pg_web_contactform', before_id: null }]);
    expect(rowOf(tree, 'Deployment und Hosting').getAttribute('aria-level')).toBe('3');
    expect(rowOf(tree, 'Domain-Umzug').getAttribute('aria-level')).toBe('4');
    expect(rowOf(tree, 'Kontaktformular – Technik').getAttribute('aria-expanded')).toBe('true');
  });

  it('takes the subtree along', async () => {
    renderWiki({}, inertia.go);
    const tree = await pagesTree();
    const at = await pickUp(tree, 'Technik');
    // its subpages leave the list while it travels, and the overlay names them
    await waitFor(() => expect(within(tree).queryByRole('treeitem', { name: 'Domain-Umzug', hidden: true })).toBeNull());
    expect(within(tree).queryByRole('treeitem', { name: 'Kontaktformular – Technik', hidden: true })).toBeNull();
    expect(document.querySelector('[data-drag-overlay]')?.textContent).toContain('mit 4 Unterseiten');

    // two rows down: below the kickoff notes, at the top level
    pointTo(at, 0, 2 * ROW);
    await waitFor(() => expect(dndSaid()).toBe('„Technik“ kommt auf die oberste Ebene.'));
    letGo(at, 0, 2 * ROW);
    await waitFor(() => expect(toastTitles()).toContain('„Technik“ verschoben'));
    expect(callsTo('POST', '/api/v1/pages/pg_web_tech/move').map((call) => call.body)).toEqual([{ parent_id: null, before_id: null }]);
    expect(outline(tree).slice(-7)).toEqual([
      '1 📅Meetings',
      '2 📝Kickoff-Notizen',
      '1 🛠️Technik',
      '2 📮Kontaktformular – Technik',
      '2 🚀Deployment und Hosting',
      '3 🌐Domain-Umzug',
      '2 ⚡Performance-Budget',
    ]);
  });

  it('cancels with Escape and keeps the page', async () => {
    renderWiki({}, inertia.go);
    const tree = await pagesTree();
    const before = outline(tree);
    act(() => rowOf(tree, 'Meetings').focus());
    const at = await pickUp(tree, 'Technik');
    pointTo(at, 20, 2 * ROW);

    // Escape is the drag's: the shortcuts do not hear it, and the focus stays where it was
    const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    await waitFor(() => expect(dndSaid()).toBe('Abgebrochen. „Technik“ bleibt, wo sie war.'));
    letGo(at, 20, 2 * ROW);
    expect(outline(tree)).toEqual(before);
    expect(document.activeElement).toBe(rowOf(tree, 'Meetings'));
    expect(callsTo('POST', '/api/v1/pages/pg_web_tech/move')).toEqual([]);
    expect(toastTitles()).toEqual([]);

    // without a drag, Escape is left to the app
    const later = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(later));
    expect(later.defaultPrevented).toBe(false);
  });

  it('offers no handle to a viewer', async () => {
    wiki.project = { ...wiki.project, my_role: 'viewer' };
    try {
      renderWiki({}, inertia.go);
      const tree = await pagesTree();
      // the rights are known once the tree stands: nothing to pick up, even on the row itself
      await waitFor(() => expect(rowOf(tree, 'Technik')).toBeTruthy());
      expect(tree.querySelectorAll('[data-drag-handle]')).toHaveLength(0);
      const link = rowOf(tree, 'Technik');
      const at = middle(link);
      act(() => void fireEvent.pointerDown(link, { button: 0, isPrimary: true, ...at }));
      pointTo(at, 20, 2 * ROW);
      expect(dndSaid()).toBe('');
      letGo(at, 20, 2 * ROW);
      expect(callsTo('POST', '/api/v1/pages/pg_web_tech/move')).toEqual([]);
    } finally {
      wiki.project = { ...wiki.project, my_role: 'member' };
    }
  });

  it('springs back when the server refuses the move', async () => {
    wiki.overrides['POST /api/v1/pages/pg_web_tech/move'] = () => ({
      status: 403,
      body: { type: 'about:blank', title: 'Forbidden', status: 403, reason: 'wiki_members_only', detail: 'Nur Mitglieder bearbeiten das Wiki.' },
    });
    renderWiki({}, inertia.go);
    const tree = await pagesTree();
    const before = outline(tree);
    const at = await pickUp(tree, 'Technik');
    pointTo(at, 0, 2 * ROW);

    // the page stands in its new place while the server thinks, then springs back on the refusal
    let release: (() => void) | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      String(input).endsWith('/move') ? new Promise<Response>((resolve) => (release = () => void original(input, init).then(resolve))) : original(input, init);
    try {
      letGo(at, 0, 2 * ROW);
      await waitFor(() => expect(release).not.toBeNull());
      expect(outline(tree).slice(-7, -4)).toEqual(['1 📅Meetings', '2 📝Kickoff-Notizen', '1 🛠️Technik']);
      act(() => release!());
    } finally {
      globalThis.fetch = original;
    }
    await waitFor(() => expect(toastTitles()).toContain('„Technik“ nicht verschoben'));
    expect(callsTo('POST', '/api/v1/pages/pg_web_tech/move')).toHaveLength(1);
    expect(outline(tree)).toEqual(before);
  });
});

it('writes the classes that straighten the dropped page out in full, so Tailwind finds them', () => {
  // a class built in a template string never reaches the stylesheet: the overlay would stay tilted on a drop
  for (const name of ['translate-y-0', 'scale-100', 'rotate-0']) expect(pageTreeSource).toContain(`in-[.${DROPPING}]:${name}`);
});
