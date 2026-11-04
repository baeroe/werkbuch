/*
 * The page tree on its own (ported from the clickdummy's wiki.test.tsx): an ARIA tree of links with one tab stop, the
 * arrows, Right and Left to fold, Home and End, mod+backspace on a row. Inertia's Link is a plain anchor here.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { webTree } from '@/test/fixtures';
import { PageTree } from './PageTree';

vi.mock('@inertiajs/react', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** The tree as the wiki holds it: the collapsed pages in state. */
function Tree({ currentId, onDelete, start = [] }: { currentId?: string; onDelete?: (id: string) => void; start?: string[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(start));
  const toggle = (id: string, open: boolean) =>
    setCollapsed((state) => {
      const next = new Set(state);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  return <PageTree nodes={webTree} hrefOf={(id) => `/projects/WEB/wiki/${id}`} currentId={currentId} collapsed={collapsed} onToggle={toggle} onDelete={onDelete} />;
}

const tree = () => screen.getByRole('tree', { name: 'Seiten' });
const row = (name: string) => within(tree()).getByRole('treeitem', { name });
const focused = () => document.activeElement?.textContent;

describe('the page tree', () => {
  it('moves through the tree with the arrow keys and folds a page away', async () => {
    const user = userEvent.setup();
    render(<Tree currentId="pg_web_handbook" />);
    const handbook = row('Projekt-Handbuch');
    expect(handbook.getAttribute('href')).toBe('/projects/WEB/wiki/pg_web_handbook');
    expect(handbook.getAttribute('aria-current')).toBe('page');
    expect(handbook.getAttribute('aria-level')).toBe('1');
    expect(handbook.getAttribute('aria-setsize')).toBe('3');
    expect(handbook.getAttribute('aria-posinset')).toBe('1');
    expect(row('Designsystem').getAttribute('aria-level')).toBe('2');
    expect(row('Designsystem').getAttribute('aria-posinset')).toBe('2');
    expect(row('Redaktion und Tonalität').getAttribute('aria-expanded')).toBeNull();

    act(() => handbook.focus());
    await user.keyboard('{ArrowDown}');
    expect(focused()).toContain('Seitenstruktur');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(handbook);
    await user.keyboard('{ArrowDown}{ArrowLeft}');
    // Left on a page without open subpages goes to its parent
    expect(document.activeElement).toBe(handbook);
    await user.keyboard('{ArrowLeft}');
    expect(handbook.getAttribute('aria-expanded')).toBe('false');
    expect(within(tree()).queryByRole('treeitem', { name: 'Seitenstruktur' })).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(handbook.getAttribute('aria-expanded')).toBe('true');
    // Right on an open page steps into its subpages
    await user.keyboard('{ArrowRight}');
    expect(focused()).toContain('Seitenstruktur');
    // on a page without subpages Right does nothing
    await user.keyboard('{ArrowRight}');
    expect(focused()).toContain('Seitenstruktur');
    await user.keyboard('{End}');
    expect(focused()).toContain('Kickoff-Notizen');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toContain('Kickoff-Notizen');
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(handbook);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(handbook);
  });

  it('has one tab stop, the open page, and the row last focused once the person moves', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Tree currentId="pg_web_hosting" />);
    const stops = () => within(tree()).getAllByRole('treeitem').filter((entry) => entry.tabIndex === 0);
    expect(stops()).toEqual([row('Deployment und Hosting')]);
    expect(row('Projekt-Handbuch').tabIndex).toBe(-1);

    act(() => row('Deployment und Hosting').focus());
    await user.keyboard('{ArrowDown}');
    expect(stops()).toEqual([row('Domain-Umzug')]);

    // another page opened elsewhere (a link, the palette) becomes the tab stop again
    rerender(<Tree currentId="pg_web_meetings" />);
    expect(stops()).toEqual([row('Meetings')]);

    // without an open page the first row is the tab stop
    rerender(<Tree />);
    expect(stops()).toEqual([row('Projekt-Handbuch')]);
  });

  it('folds with the chevron and keeps the focus in the tree when the focused subpage folds away', async () => {
    const user = userEvent.setup();
    const { container } = render(<Tree start={['pg_web_tech']} />);
    expect(row('Technik').getAttribute('aria-expanded')).toBe('false');
    expect(within(tree()).queryByRole('treeitem', { name: 'Domain-Umzug' })).toBeNull();
    const chevron = (id: string) => container.querySelector<HTMLElement>(`[data-toggle="${id}"]`)!;
    await user.click(chevron('pg_web_tech'));
    expect(row('Technik').getAttribute('aria-expanded')).toBe('true');

    act(() => row('Domain-Umzug').focus());
    await user.click(chevron('pg_web_tech'));
    expect(within(tree()).queryByRole('treeitem', { name: 'Domain-Umzug' })).toBeNull();
    expect(document.activeElement).toBe(row('Technik'));
    // a page without subpages has a chevron that does nothing
    await user.click(chevron('pg_web_kickoff'));
    expect(row('Kickoff-Notizen')).toBeTruthy();
  });

  it('asks to delete the page of the row with mod+backspace and leaves other keys with a modifier to the app', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<Tree currentId="pg_web_handbook" onDelete={onDelete} />);
    act(() => row('Designsystem').focus());
    // jsdom is no Mac: mod is the Control key
    await user.keyboard('{Control>}{Backspace}{/Control}');
    expect(onDelete).toHaveBeenCalledWith('pg_web_design');

    const key = (init: KeyboardEventInit) => fireEvent.keyDown(row('Designsystem'), init);
    // mod with another key, Alt and Shift: the tree does nothing, the event is the app's
    expect(key({ key: 'ArrowDown', ctrlKey: true })).toBe(true);
    expect(key({ key: 'ArrowDown', altKey: true })).toBe(true);
    expect(key({ key: 'ArrowDown', shiftKey: true })).toBe(true);
    expect(key({ key: 'Backspace', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(key({ key: 'x' })).toBe(true);
    expect(document.activeElement).toBe(row('Designsystem'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('leaves mod+backspace alone when nobody may delete', () => {
    render(<Tree currentId="pg_web_handbook" />);
    expect(fireEvent.keyDown(row('Designsystem'), { key: 'Backspace', ctrlKey: true })).toBe(true);
  });
});
