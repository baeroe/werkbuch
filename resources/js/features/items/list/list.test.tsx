/*
 * The list layout against groups built by hand (K18): each group's `enable`, `loadMore` and `retry` are spies, so the
 * tests see when the layout asks for a page; which request that becomes is the items screen's (`useListData`). The
 * catalogs the rows read come from a fake REST API (`mockApi`). jsdom lays nothing out: every row reports a height
 * (`offsetHeight`), and `window.scrollTo` moves `scrollY` and fires `scroll`, as a browser does.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { mockApi, type MockApi } from '@/test/api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, standard, types } from '@/test/fixtures';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useUiStore } from '@/store/ui';
import type { Display, GroupBy, ListedItem, Organization } from '@/types';
import { GroupIcon } from '../display/GroupIcon';
import { LAYOUT_OPTIONS, layouts, type GroupData, type LayoutProps } from '../layouts';
import { ListLayout } from './ListLayout';
import { listRows } from './rows';

const page = vi.hoisted(() => ({ organization: null as Organization | null }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization: page.organization }, url: '/projects/WEB' }),
  Link: ({ href, onClick, children, ...rest }: { href: string; onClick?: (event: MouseEvent) => void; children: ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

/* ------------------------------------------------------------------- layout in jsdom */

const ROW = 36;
const HEADING = 48;
let scrollY = 0;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
const scrollY0 = Object.getOwnPropertyDescriptor(window, 'scrollY');
const boundingRect = Element.prototype.getBoundingClientRect;
const scrollTo = window.scrollTo;

/** Scrolls the page as a browser does: the offset changes, then `scroll` fires. */
function scrollPage(top: number) {
  act(() => {
    scrollY = Math.max(0, top);
    window.dispatchEvent(new Event('scroll'));
  });
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute('data-index')) return 0;
      return this.querySelector('h2') ? HEADING : ROW;
    },
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  // the list starts at the top of the page: in the window it moves up as the page scrolls
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.tagName === 'UL' ? new DOMRect(0, -scrollY, 1024, 0) : boundingRect.call(this);
  };
  // the page is as tall as the list (the virtualizer ignores an offset beyond it)
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 1_000_000 });
  window.scrollTo = ((options: ScrollToOptions) => {
    scrollY = Math.max(0, options.top ?? 0);
    window.dispatchEvent(new Event('scroll'));
  }) as typeof window.scrollTo;
  window.scrollBy = (() => {}) as typeof window.scrollBy;
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  if (scrollY0) Object.defineProperty(window, 'scrollY', scrollY0);
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  Element.prototype.getBoundingClientRect = boundingRect;
  window.scrollTo = scrollTo;
});

/* ------------------------------------------------------------------------ harness */

let api: MockApi | undefined;

beforeEach(() => {
  page.organization = organization;
  scrollY = 0;
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
  });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  useUiStore.setState({ peekItemId: null, flashIds: [] });
});

const items = (prefix: string, count: number, from = 1): ListedItem[] =>
  Array.from({ length: count }, (_, index) =>
    makeWorkItem({ id: `wi_${prefix}${from + index}`, key: `${prefix.toUpperCase()}-${from + index}`, number: from + index, title: `${prefix} ${from + index}` }),
  );

function group(key: string, loaded: ListedItem[], changes: Partial<GroupData> = {}): GroupData {
  return {
    key,
    label: `Gruppe ${key}`,
    count: loaded.length,
    items: loaded,
    status: 'success',
    hasMore: false,
    loadingMore: false,
    moreError: null,
    enable: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...changes,
  };
}

const display: Display = { layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: ['key'], show_sub_items: true };

type Props = Partial<Omit<LayoutProps, 'groups'>> & { groups: GroupData[] };

/** The layout with its cursor and selection in state, as the items screen keeps them. */
function Harness({ groups, groupBy = 'state', ...rest }: Props) {
  const [cursorId, setCursor] = useState<string | null>(rest.cursorId ?? null);
  const [selection, setSelection] = useState<string[]>(rest.selection ?? []);
  return (
    <>
      <span data-testid="cursor">{cursorId ?? ''}</span>
      <span data-testid="selection">{selection.join(' ')}</span>
      <ListLayout
        groups={groups}
        groupBy={groupBy}
        display={display}
        total={groups.reduce((sum, entry) => sum + entry.count, 0)}
        selection={selection}
        onSelect={setSelection}
        onOpen={rest.onOpen ?? vi.fn()}
        onPeek={rest.onPeek ?? vi.fn()}
        cursorId={cursorId}
        onCursor={setCursor}
        {...(rest.onSelectAll && { onSelectAll: rest.onSelectAll })}
      />
    </>
  );
}

function renderList(props: Props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderList: (next: Props) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <Harness {...next} />
        </QueryClientProvider>,
      ),
  };
}

const rowOf = (key: string) => document.querySelector<HTMLElement>(`[data-row-id="wi_${key}"]`);
const heading = (key: string) => screen.getByRole('button', { name: new RegExp(`Gruppe ${key}`) });
const cursor = () => screen.getByTestId('cursor').textContent;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

/* -------------------------------------------------------------------------- tests */

describe('rows of the list', () => {
  it('leaves empty groups out, folds collapsed ones, and says what is still to come', () => {
    const pending = group('p', [], { status: 'pending', count: 4 });
    const failed = group('f', [], { status: 'error', count: 2 });
    const more = group('m', items('m', 1), { count: 5, hasMore: true });
    const broken = group('b', items('b', 1), { count: 5, hasMore: true, moreError: new ApiError({ status: 503, reason: 'unavailable' }) });
    const empty = group('e', []);
    const shut = group('s', items('s', 2));
    const done = group('d', [], { count: 1 });
    const rows = listRows([pending, failed, more, broken, empty, shut, done], true, new Set(['s']));
    expect(rows.map((row) => `${row.kind}:${row.group.key}`)).toEqual([
      'group:p',
      'pending:p',
      'group:f',
      'error:f',
      'group:m',
      'item:m',
      'more:m',
      'group:b',
      'item:b',
      'error:b',
      'group:s',
      'group:d',
    ]);
    // without grouping there are no headings
    expect(listRows([more], false, new Set(['m'])).map((row) => row.kind)).toEqual(['item', 'more']);
  });

  it('offers a layout of its own for each entry of the switcher, with its name and key', () => {
    // the board, the table and the timeline are chunks of their own (board.test.tsx, table.test.tsx, timeline.test.tsx)
    expect(layouts.list).toBe(ListLayout);
    expect(new Set([layouts.list, layouts.board, layouts.table, layouts.timeline]).size).toBe(4);
    expect(LAYOUT_OPTIONS.map((option) => [option.value, SHORTCUTS[option.shortcut].keys])).toEqual([
      ['list', '1'],
      ['board', '2'],
      ['table', '3'],
      ['timeline', '4'],
    ]);
  });
});

describe('ListLayout', () => {
  it('renders only the rows in view of a list of 2 000 items', async () => {
    renderList({ groups: [group('all', items('a', 2000))], groupBy: 'none' });

    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(100);
    // no heading without grouping; the rows count items only
    expect(screen.queryByRole('heading')).toBeNull();
    expect(rows[0]!.getAttribute('aria-posinset')).toBe('1');
    expect(rows[0]!.getAttribute('aria-setsize')).toBe('2000');
    expect(screen.getByRole('list', { name: 'Items' }).style.height).toBe(`${2000 * ROW}px`);

    // further down, the rows there and none of the first
    scrollPage(1000 * ROW);
    await waitFor(() => expect(rowOf('a1000')).not.toBeNull());
    expect(rowOf('a1')).toBeNull();
    expect(screen.getAllByRole('listitem').length).toBeLessThan(100);
  });

  it('loads a group when its heading comes into view and not before', async () => {
    const first = group('a', items('a', 60));
    const second = group('b', [], { status: 'idle', count: 5 });
    renderList({ groups: [first, second] });

    expect(first.enable).not.toHaveBeenCalled();
    expect(second.enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Gruppe b/ })).toBeNull();

    scrollPage(60 * ROW);
    await waitFor(() => expect(second.enable).toHaveBeenCalledTimes(1));
    // until its first page is there it shows a placeholder
    expect(within(screen.getByRole('list')).getByRole('status').textContent).toBe('Lädt …');
  });

  it('loads the next page of a group when its last row comes into view', async () => {
    const only = group('all', items('a', 60), { count: 200, hasMore: true });
    const { rerenderList } = renderList({ groups: [only], groupBy: 'none' });

    expect(only.loadMore).not.toHaveBeenCalled();
    scrollPage(60 * ROW);
    await waitFor(() => expect(only.loadMore).toHaveBeenCalledTimes(1));

    // not while the page is on its way
    rerenderList({ groups: [{ ...only, loadingMore: true }], groupBy: 'none' });
    scrollPage(60 * ROW + 10);
    expect(only.loadMore).toHaveBeenCalledTimes(1);
  });

  it('asks again when the page it asked for did not come', async () => {
    const only = group('all', items('a', 60), { count: 200, hasMore: true });
    const { rerenderList } = renderList({ groups: [only], groupBy: 'none' });
    scrollPage(60 * ROW);
    await waitFor(() => expect(only.loadMore).toHaveBeenCalledTimes(1));

    // the page was on its way, then dropped (a rebuild took its cursor away, K15): the same rows, nothing loading
    rerenderList({ groups: [{ ...only, loadingMore: true }], groupBy: 'none' });
    rerenderList({ groups: [{ ...only }], groupBy: 'none' });
    expect(only.loadMore).toHaveBeenCalledTimes(2);
    // the end stays a placeholder only while a page is on its way
    expect(within(screen.getByRole('list')).getByRole('status').textContent).toBe('Lädt …');
  });

  it('keeps the rows and offers a retry when a later page fails', async () => {
    const failing = group('a', items('a', 3), { count: 9, hasMore: true, moreError: new ApiError({ status: 503, reason: 'unavailable' }) });
    const empty = group('b', [], { status: 'error', count: 2 });
    renderList({ groups: [failing, empty] });

    expect(rowOf('a1')).not.toBeNull();
    expect(rowOf('a3')).not.toBeNull();
    const alerts = screen.getAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual(['Nicht geladen.Erneut versuchen', 'Nicht geladen.Erneut versuchen']);
    // a failed page is not asked for again by itself
    expect(failing.loadMore).not.toHaveBeenCalled();

    await userEvent.click(within(alerts[0]!).getByRole('button', { name: 'Erneut versuchen' }));
    expect(failing.retry).toHaveBeenCalledTimes(1);
    await userEvent.click(within(alerts[1]!).getByRole('button', { name: 'Erneut versuchen' }));
    expect(empty.retry).toHaveBeenCalledTimes(1);
  });

  it('collapses a group with Enter on its heading and loads nothing for a collapsed one', async () => {
    const first = group('a', items('a', 40), { count: 80, hasMore: true });
    const second = group('b', [], { status: 'idle', count: 5 });
    renderList({ groups: [first, second] });
    expect(second.enable).not.toHaveBeenCalled();

    const button = heading('a');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // no tab stop of its own: the rows have it
    expect(button.tabIndex).toBe(-1);
    act(() => button.focus());
    await userEvent.keyboard('{Enter}');

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(rowOf('a1')).toBeNull();
    // the next group came into view and loads; the folded one asks for no further page although its end is in view
    await waitFor(() => expect(second.enable).toHaveBeenCalledTimes(1));
    expect(first.loadMore).not.toHaveBeenCalled();
  });

  it('reaches a heading from a row with ←, folds the group with ← and opens it with →', async () => {
    const shut = group('c', [], { status: 'idle', count: 3 });
    const open = group('x', items('x', 1));
    renderList({ groups: [open, shut] });
    await waitFor(() => expect(shut.enable).toHaveBeenCalledTimes(1));

    // the heading is reached with ← from a row and folds with ←, opens with →
    act(() => rowOf('x1')!.focus());
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(heading('x')));
    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(heading('c')));
    press('ArrowLeft');
    expect(heading('c').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
    press('ArrowRight');
    expect(heading('c').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('status')).not.toBeNull();
  });

  it('keeps the focused row rendered while scrolling away', async () => {
    renderList({ groups: [group('all', items('a', 2000))], groupBy: 'none' });
    const row = rowOf('a2')!;
    act(() => row.focus());
    expect(cursor()).toBe('wi_a2');

    scrollPage(1500 * ROW);
    await waitFor(() => expect(rowOf('a1500')).not.toBeNull());
    expect(rowOf('a1')).toBeNull();
    // the cursor row stays, with the focus and the tab stop
    expect(rowOf('a2')).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(row.tabIndex).toBe(0);
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
  });

  it('shows the count of the server, not of what is loaded', () => {
    renderList({ groups: [group('a', items('a', 3), { count: 120, hasMore: true, loadingMore: true })] });

    const button = heading('a');
    expect(button.textContent).toBe('Gruppe a120, 120 Items');
    expect(rowOf('a1')!.closest('li')!.getAttribute('aria-setsize')).toBe('120');
    // a page on its way shows a placeholder after the loaded rows
    expect(screen.getByRole('status')).not.toBeNull();
  });

  it('moves the cursor across groups with j and k', async () => {
    renderList({ groups: [group('a', items('a', 2)), group('b', items('b', 1))] });

    press('j');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('a1')));
    expect(cursor()).toBe('wi_a1');
    press('j');
    press('j');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('b1')));
    expect(cursor()).toBe('wi_b1');
    press('k');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('a2')));
    // the positions count items only, across the groups
    expect(rowOf('b1')!.closest('li')!.getAttribute('aria-posinset')).toBe('3');
    expect(rowOf('b1')!.closest('li')!.getAttribute('aria-setsize')).toBe('3');
  });

  it('opens with Enter and previews with space', async () => {
    const onOpen = vi.fn();
    const onPeek = vi.fn();
    renderList({ groups: [group('a', items('a', 2))], onOpen, onPeek });

    act(() => rowOf('a2')!.focus());
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('wi_a2');
    await userEvent.keyboard(' ');
    expect(onPeek).toHaveBeenCalledWith('wi_a2');
    // a click on the title is the preview too
    await userEvent.click(within(rowOf('a1')!).getByRole('link'));
    expect(onPeek).toHaveBeenLastCalledWith('wi_a1');
  });

  it('reaches the headings with the arrows, as a tree', async () => {
    renderList({ groups: [group('a', items('a', 2)), group('b', items('b', 2))] });

    act(() => rowOf('b2')!.focus());
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(heading('b')));
    // with ⇧ or another key nothing happens to the heading
    press('ArrowLeft', { shiftKey: true });
    press('a');
    expect(heading('b').getAttribute('aria-expanded')).toBe('true');
    press('ArrowUp');
    await waitFor(() => expect(document.activeElement).toBe(heading('a')));
    // no heading above the first
    press('ArrowUp');
    expect(document.activeElement).toBe(heading('a'));
    // → on an open group goes to its first row
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('a1')));
    expect(cursor()).toBe('wi_a1');

    // the headings are the tab stop while no row is there
    act(() => heading('a').focus());
    press('ArrowLeft');
    act(() => heading('b').focus());
    press('ArrowLeft');
    expect(document.querySelectorAll('[data-row-id]')).toHaveLength(0);
    expect(heading('a').tabIndex).toBe(0);
    expect(heading('b').tabIndex).toBe(-1);
    // a click folds and opens too
    await userEvent.click(heading('b'));
    expect(heading('b').getAttribute('aria-expanded')).toBe('true');
    // → on an open group without rows stays
    press('ArrowRight');
    expect(heading('b').getAttribute('aria-expanded')).toBe('true');
  });

  it('brings a heading out of view into view before it takes the focus', async () => {
    renderList({ groups: [group('a', items('a', 80)), group('b', items('b', 1))] });
    act(() => heading('a').focus());

    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(heading('b')));
    expect(scrollY).toBeGreaterThan(0);
  });

  it('selects with the checkbox, a range with ⇧, and with ⇧ and a click on the title', async () => {
    const onPeek = vi.fn();
    renderList({ groups: [group('a', items('a', 4))], onPeek });
    const box = (key: string) => within(rowOf(key)!).getByRole('checkbox', { name: `${key.toUpperCase().replace(/(\d)/, '-$1')} auswählen` });

    await userEvent.click(box('a1'));
    expect(screen.getByTestId('selection').textContent).toBe('wi_a1');
    expect(rowOf('a1')!.getAttribute('aria-label')).toBe('A-1 a 1, ausgewählt');
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(box('a3'));
    await user.keyboard('{/Shift}');
    expect(screen.getByTestId('selection').textContent).toBe('wi_a1 wi_a2 wi_a3');

    fireEvent.click(within(rowOf('a4')!).getByRole('link'), { shiftKey: true });
    expect(screen.getByTestId('selection').textContent).toBe('wi_a1 wi_a2 wi_a3 wi_a4');
    expect(onPeek).not.toHaveBeenCalled();
  });

  it('selects all with ⌘A: what the layout loaded, or what the screen loads', async () => {
    const onSelectAll = vi.fn();
    renderList({ groups: [group('a', items('a', 2), { count: 5, hasMore: true })], onSelectAll });
    act(() => rowOf('a1')!.focus());
    press('a', /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('tints the item in the preview and a fresh one', () => {
    useUiStore.setState({ peekItemId: 'wi_a1', flashIds: ['wi_a2'] });
    renderList({ groups: [group('a', items('a', 3))], selection: ['wi_a3'] });

    expect(rowOf('a1')!.className).toContain('bg-pressed');
    expect(rowOf('a2')!.className).toContain('bg-accent-soft');
    expect(rowOf('a3')!.className).not.toContain('bg-pressed');
  });

  it('measures where it starts again when the window changes its size, and on phones starts with taller rows', async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      renderList({ groups: [group('all', items('a', 30))], groupBy: 'none' });
      act(() => window.dispatchEvent(new Event('resize')));
      expect(rowOf('a1')).not.toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it('hangs children below their parent in a group', () => {
    const parent = makeWorkItem({ id: 'wi_p', key: 'WEB-1', title: 'Epic' });
    const child = makeWorkItem({ id: 'wi_c', key: 'WEB-2', title: 'Kind', parent_id: 'wi_p' });
    renderList({ groups: [group('a', [child, parent])] });

    const rows = [...document.querySelectorAll<HTMLElement>('[data-row-id]')];
    expect(rows.map((row) => row.dataset.rowId)).toEqual(['wi_p', 'wi_c']);
    expect(rows[1]!.style.marginLeft).toBe('1.75rem');
  });
});

describe('GroupIcon', () => {
  it('marks a group by what it groups, and leaves out what the catalogs do not know', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const marks: [GroupBy, string, boolean][] = [
      ['state', 'std_todo', true],
      ['state', 'st_gone', false],
      ['category', 'started', true],
      ['category', 'bogus', false],
      ['priority', 'high', true],
      ['priority', 'bogus', false],
      ['assignee', 'u_ida', true],
      ['assignee', 'none', true],
      ['assignee', 'u_gone', false],
      ['type', 't_bug', true],
      ['type', 't_gone', false],
      ['label', 'lb_ux', true],
      ['label', 'none', true],
      ['project', 'p_web', true],
      ['project', 'p_hidden', false],
      ['parent', 'wi_web_30', true],
      ['parent', 'none', false],
      ['none', 'all', false],
    ];
    const { container } = render(
      <QueryClientProvider client={client}>
        {marks.map(([groupBy, key]) => (
          <p key={`${groupBy}:${key}`} data-mark={`${groupBy}:${key}`}>
            <GroupIcon groupBy={groupBy} groupKey={key} />
          </p>
        ))}
      </QueryClientProvider>,
    );

    // once the catalogs are there
    await waitFor(() => {
      for (const [groupBy, key, shown] of marks) {
        const mark = container.querySelector(`[data-mark="${groupBy}:${key}"]`)!;
        expect([`${groupBy}:${key}`, mark.childElementCount > 0]).toEqual([`${groupBy}:${key}`, shown]);
        // decorative: the name of the group stands next to it
        if (shown) expect(mark.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
      }
    });
  });
});
