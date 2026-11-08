/*
 * The board on the items screen against the fake REST API of `test/board.tsx` (items of WEB with the free standard
 * workflow and APP with the agency workflow, laid out in jsdom): columns, cards, the keyboard and moves. Ported from
 * the clickdummy's `BoardLayout.test.tsx`; pointer drags and the quick add are in drag.test.tsx.
 */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import type { BoardReason } from '@/domain/boardRules';
import { listCommands } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import {
  announced,
  app,
  board,
  cardIn,
  column,
  countOf,
  lastToast,
  layBoardOut,
  press,
  renderBoard as renderWithServer,
  sent,
  startBoardServer,
  stateOf,
  stopBoardServer,
  web50,
  type Body,
} from '@/test/board';
import { agency, lene, organization } from '@/test/fixtures';
import { reasonText } from './moves';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/APP?layout=board';
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
    usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: useSyncExternalStore(inertia.subscribe, () => inertia.url) }),
    router: {
      get: (url: string, _data: unknown, options: { onSuccess?: () => void; onFinish?: () => void }) => {
        inertia.go(url);
        options.onSuccess?.();
        options.onFinish?.();
      },
      visit: vi.fn(),
      replace: vi.fn(),
      on: () => () => {},
    },
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
  };
});

let restoreLayout = () => {};
beforeAll(() => {
  restoreLayout = layBoardOut();
});

afterAll(() => restoreLayout());

beforeEach(() => {
  startBoardServer();
  inertia.go('/projects/APP?layout=board');
  useUiStore.setState({ selection: [], peekItemId: null, paletteOpen: false });
  resetToasts();
});

afterEach(() => stopBoardServer());

const renderBoard = (path: string, options?: { palette?: boolean }) => renderWithServer(path, inertia.go, options);

/* -------------------------------------------------------------------------- tests */

describe('the board', () => {
  it('shows a column for every status of the workflow, empty ones included, with the cards in them', async () => {
    renderBoard('/projects/APP?layout=board');
    expect(await within(await screen.findByRole('region', { name: 'Kundenfreigabe' })).findByRole('article', { name: /^APP-15 / })).toBeTruthy();
    for (const name of ['Backlog', 'Todo', 'In Progress', 'Review', 'Done', 'Cancelled']) expect(column(name)).toBeTruthy();
    expect(cardIn('Todo', 'APP-16')).toBeTruthy();
    expect(countOf('Todo')).toBe(', 3 Items');
    expect(within(column('Review')).getByText('Keine Items')).toBeTruthy();
    // every column asked for its cards at once, the empty ones included
    expect(new Set(sent('POST', '/api/v1/work-items/query').map((body) => (body as Body).group))).toEqual(new Set(agency.states.map((state) => state.id)));
    // one card is the tab stop
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
  });

  it('moves the card under the cursor to the next allowed column with ⇧→ and keeps the focus on it', async () => {
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(stateOf('wi_app_16')).toBe('app_progress'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-16')));
    await waitFor(() => expect(announced()).toBe('APP-16 steht jetzt in In Progress.'));
    // no success toast: the status line says it
    expect(currentToasts()).toEqual([]);
  });

  it('refuses ⇧← where the workflow allows no move and names the transition in a toast', async () => {
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'APP-16 nicht verschoben', description: 'Von „Todo“ nach „Backlog“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.' });
    expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toEqual([]);
    expect(cardIn('Todo', 'APP-16')).toBe(document.activeElement);
  });

  it('asks for the resolution before a card moves into Done', async () => {
    const user = userEvent.setup();
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Kundenfreigabe', 'APP-15'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'APP-15 auf Done setzen' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /^Done/ })));
    // nothing went out yet
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(board.items.find((entry) => entry.id === 'wi_app_15')).toMatchObject({ state_id: 'app_done', resolution_id: 'res_done' }));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Done', 'APP-15')));
  });

  it('leaves the card where it is when the question of the resolution is cancelled', async () => {
    const user = userEvent.setup();
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Kundenfreigabe', 'APP-15'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await screen.findByRole('dialog', { name: 'APP-15 auf Done setzen' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(announced()).toBe('Abgebrochen. APP-15 bleibt in Kundenfreigabe.'));
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Kundenfreigabe', 'APP-15')));
  });

  it('moves the cursor down a column with ↓, stops at its end, and goes into the next column with →', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(within(column('Todo')).getAllByRole('article')).toHaveLength(3));
    // without a cursor j starts at the first card
    press('j');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Backlog', 'APP-13')));
    const todo = within(column('Todo')).getAllByRole('article');
    act(() => todo[0]!.focus());

    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(todo[1]));
    // at the end of a column ↓ and j stay there; in the order of the whole list they would go on to the next column
    act(() => todo.at(-1)!.focus());
    press('ArrowDown');
    expect(document.activeElement).toBe(todo.at(-1));
    press('j');
    expect(document.activeElement).toBe(todo.at(-1));
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-20')));
    // → passes the empty Review
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Kundenfreigabe', 'APP-15')));
    press('ArrowRight');
    expect(document.activeElement).toBe(cardIn('Kundenfreigabe', 'APP-15'));
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-20')));
    // ← takes the card at the same height: the first of Todo
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(todo[0]));
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
  });

  it('goes to the first card with → while no card has the cursor, and moves nothing with ⇧→ or ⌥↑', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Backlog', 'APP-13'));
    press('ArrowRight', { shiftKey: true });
    press('ArrowUp', { altKey: true });
    expect(currentToasts()).toEqual([]);

    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Backlog', 'APP-13')));
  });

  it('selects the range up to a card with ⇧ and a click on its title, and opens the preview with a plain click', async () => {
    renderBoard('/projects/APP?layout=board');
    const first = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => first.focus());
    press('x');
    expect(useUiStore.getState().selection).toEqual(['wi_app_16']);

    fireEvent.click(within(cardIn('Todo', 'APP-18')).getByRole('link'), { shiftKey: true });
    expect(useUiStore.getState().selection).toEqual(['wi_app_16', 'wi_app_17', 'wi_app_18']);
    expect(useUiStore.getState().peekItemId).toBeNull();

    fireEvent.click(within(cardIn('Todo', 'APP-17')).getByRole('link'));
    expect(useUiStore.getState().peekItemId).toBe('wi_app_17');
  });

  it('says why at the edge of the board when ⇧← finds no column', async () => {
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Backlog', 'APP-13'));
    act(() => card.focus());

    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', description: '„Backlog“ ist die erste Spalte.' });
  });

  it('moves the cursor card down its column from the palette, a way without dragging (WCAG 2.5.7)', async () => {
    renderBoard('/projects/WEB?layout=board', { palette: true });
    const card = await waitFor(() => cardIn('Todo', 'WEB-43'));
    act(() => card.focus());
    await waitFor(() => expect(listCommands().find((entry) => entry.id === 'board.list.move_down')?.when?.()).toBe(true));
    // the first card cannot go further up
    expect(listCommands().find((entry) => entry.id === 'board.list.move_up')?.when?.()).toBe(false);

    act(() => useUiStore.getState().setPaletteOpen(true));
    const input = await screen.findByRole('combobox', { name: 'Suchen oder Befehl eingeben' });
    fireEvent.change(input, { target: { value: 'Spalte nach unten' } });
    await screen.findByRole('option', { name: /Karte in der Spalte nach unten/ });
    fireEvent.keyDown(input, { key: 'Enter' });

    // between WEB-44 (a2) and WEB-48 (a3)
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_43')).toHaveLength(1));
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_43')[0] as { rank: string };
    expect('a2' < rank && rank < 'a3').toBe(true);
    await waitFor(() => expect(within(column('Todo')).getAllByRole('article').map((entry) => entry.getAttribute('data-card-id'))).toEqual(['wi_web_44', 'wi_web_43', 'wi_web_48']));
    await waitFor(() => expect(announced()).toBe('WEB-43 steht jetzt an Stelle 2 von 3 in Todo.'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Todo', 'WEB-43')));
  });

  it('changes the place of a card with ⌥↑ and ⌥↓, says when it is at the end, and that a sorted column keeps its order', async () => {
    renderBoard('/projects/WEB?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => card.focus());

    press('ArrowDown', { altKey: true });
    expect(announced()).toBe('WEB-48 steht schon unten in Todo.');
    press('ArrowUp', { altKey: true });
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_48')[0] as { rank: string };
    expect('a1' < rank && rank < 'a2').toBe(true);

    act(() => inertia.go('/projects/WEB?layout=board&sort=priority'));
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/groups').at(-1)).toMatchObject({ sort: { field: 'priority' } }));
    act(() => cardIn('Todo', 'WEB-44').focus());
    press('ArrowUp', { altKey: true });
    press('ArrowUp', { altKey: true });
    // one hint, not one per key, and no such command in the palette
    expect(currentToasts().filter((entry) => entry.title === 'Die Reihenfolge folgt der Sortierung')).toHaveLength(1);
    expect(listCommands().find((entry) => entry.id === 'board.list.move_down')?.when?.()).toBe(false);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_44')).toEqual([]);
  });

  it('does not move a card to the last loaded place of a column that has more cards to load', async () => {
    board.pageSize = 2;
    // the further pages of a column wait
    const inner = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      typeof init?.body === 'string' && (JSON.parse(init.body) as Body & { cursor?: string }).cursor !== undefined ? new Promise<Response>(() => {}) : inner(input, init);
    try {
      renderBoard('/projects/WEB?layout=board');
      const card = await waitFor(() => cardIn('Todo', 'WEB-43'));
      expect(within(column('Todo')).getAllByRole('article').map((entry) => entry.getAttribute('data-card-id'))).toEqual(['wi_web_43', 'wi_web_44']);
      act(() => card.focus());

      // below WEB-44 come cards that are not loaded yet: a rank after WEB-44 would put WEB-43 after all of them
      press('ArrowDown', { altKey: true });
      expect(lastToast()).toMatchObject({
        tone: 'error',
        title: 'WEB-43 nicht verschoben',
        description: 'Unter dieser Karte stehen in Todo noch Karten, die nicht geladen sind. Lade die Spalte weiter, dann verschiebe die Karte.',
      });
      expect(sent('PATCH', '/api/v1/work-items/wi_web_43')).toEqual([]);
    } finally {
      globalThis.fetch = inner;
    }
  });

  it('puts a card back in its place when the server refuses its new rank', async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      init?.method === 'PATCH' && typeof init.body === 'string' && 'rank' in (JSON.parse(init.body) as object)
        ? Promise.resolve(new Response(JSON.stringify({ reason: 'conflict', detail: 'Nicht erlaubt.' }), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }))
        : inner(input, init);
    try {
      renderBoard('/projects/WEB?layout=board');
      const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
      const before = within(column('Todo')).getAllByRole('article').map((entry) => entry.getAttribute('data-card-id'));
      act(() => card.focus());

      press('ArrowUp', { altKey: true });
      await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error' }));
      await waitFor(() => expect(within(column('Todo')).getAllByRole('article').map((entry) => entry.getAttribute('data-card-id'))).toEqual(before));
      expect(announced()).toBe('');
      // the next move of the card goes out again
      await waitFor(() => expect(cardIn('Todo', 'WEB-48').getAttribute('aria-busy')).toBeNull());
    } finally {
      globalThis.fetch = inner;
    }
  });

  it('keeps the cards of a viewer in place and says why', async () => {
    board.roles.WEB = 'viewer';
    renderBoard('/projects/WEB?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => card.focus());
    await waitFor(() => expect(listCommands().some((entry) => entry.id === 'board.list.move_right')).toBe(true));

    press('ArrowRight', { shiftKey: true });
    await waitFor(() =>
      expect(lastToast()).toMatchObject({ tone: 'error', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.' }),
    );
    press('ArrowUp', { altKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'WEB-48 nicht verschoben' });
    expect(stateOf('wi_web_48')).toBe('std_todo');
    // the palette offers no move it would refuse
    expect(listCommands().find((entry) => entry.id === 'board.list.move_right')?.when?.()).toBe(false);
  });

  it('takes the first allowed status of a category column and keeps the own status in the own category', async () => {
    board.fallBack = true;
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Unstarted', 'APP-16'));
    act(() => card.focus());

    // from Todo the agency workflow allows In Progress, not Review or Kundenfreigabe
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(stateOf('wi_app_16')).toBe('app_progress'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Started', 'APP-16')));
    // the card already in the category keeps its own status
    expect(stateOf('wi_app_15')).toBe('app_approval');
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
  });

  it('moves the card to its new column at once and fixes the counts', async () => {
    let release = () => {};
    board.holdMoves = new Promise((resolve) => (release = resolve));
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    await waitFor(() => expect(countOf('In Progress')).toBe(', 1 Item'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    // before the server answers
    await waitFor(() => expect(cardIn('In Progress', 'APP-16')).toBeTruthy());
    expect(countOf('Todo')).toBe(', 2 Items');
    expect(countOf('In Progress')).toBe(', 2 Items');
    expect(cardIn('In Progress', 'APP-16').getAttribute('aria-busy')).toBe('true');

    await act(async () => release());
    await waitFor(() => expect(cardIn('In Progress', 'APP-16').getAttribute('aria-busy')).toBeNull());
    expect(countOf('Todo')).toBe(', 2 Items');
    expect(countOf('In Progress')).toBe(', 2 Items');
  });

  it('sends a second move of the same card only after the first has landed', async () => {
    let release = () => {};
    board.holdMoves = new Promise((resolve) => (release = resolve));
    // the transitions that went out, as they leave the browser
    const started: unknown[] = [];
    const inner = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (String(input).includes('/transition')) started.push(JSON.parse(String(init?.body)));
      return inner(input, init);
    };
    try {
      renderBoard('/projects/APP?layout=board');
      const card = await waitFor(() => cardIn('Todo', 'APP-16'));
      act(() => card.focus());

      press('ArrowRight', { shiftKey: true });
      await waitFor(() => expect(cardIn('In Progress', 'APP-16')).toBeTruthy());
      press('ArrowRight', { shiftKey: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      // the second waits for the first: never two at once
      expect(started).toEqual([expect.objectContaining({ to_state_id: 'app_progress' })]);

      await act(async () => release());
      await waitFor(() => expect(started).toHaveLength(2));
      expect(started[1]).toMatchObject({ to_state_id: 'app_review' });
      await waitFor(() => expect(stateOf('wi_app_16')).toBe('app_review'));
      await waitFor(() => expect(cardIn('Review', 'APP-16').getAttribute('aria-busy')).toBeNull());
    } finally {
      globalThis.fetch = inner;
    }
  });

  it('drops a second move of a card whose first move the server refused', async () => {
    let release = () => {};
    board.holdMoves = new Promise((resolve) => (release = resolve));
    board.refuseMoves = true;
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(cardIn('In Progress', 'APP-16')).toBeTruthy());
    press('ArrowRight', { shiftKey: true });
    await act(async () => release());
    await waitFor(() => expect(cardIn('Todo', 'APP-16')).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toHaveLength(1);
  });

  it('keeps a card in place when its new rank would grow too long', async () => {
    // WEB-44 lies right after WEB-43, with a rank of 128 characters: between the two there is no room left
    board.items = board.items.map((entry) => (entry.id === 'wi_web_44' ? { ...entry, rank: `a1${'0'.repeat(125)}1` } : entry));
    renderBoard('/projects/WEB?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => card.focus());

    press('ArrowUp', { altKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'WEB-48 nicht verschoben', description: 'Hier ist kein Platz mehr. Verschiebe die Karte an eine andere Stelle.' });
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
  });

  it('moves a card to another priority and another person, and refuses one who cannot take it', async () => {
    board.items = board.items.map((entry) => (entry.id === 'wi_app_16' ? { ...entry, assignee_id: 'u_lene' } : entry));
    renderBoard('/projects/APP?layout=board&group=priority');
    const card = await waitFor(() => cardIn('None', 'APP-16'));
    act(() => card.focus());
    press('ArrowLeft', { shiftKey: true });
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_app_16')).toEqual([{ priority: 'low' }]));
    await waitFor(() => expect(announced()).toBe('APP-16 hat jetzt die Priorität Low.'));

    act(() => inertia.go('/projects/APP?layout=board&group=assignee'));
    const assigned = await waitFor(() => cardIn('Lene Vogt', 'APP-16'));
    act(() => assigned.focus());
    await waitFor(() => expect(listCommands().find((entry) => entry.id === 'board.list.move_left')?.when?.()).toBe(false));
    // Ida is no member of APP; Mara is an org admin
    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', description: 'Ida Brenner ist nicht Mitglied im Projekt APP und kann das Item nicht übernehmen.' });
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(announced()).toBe('APP-16 ist jetzt Mara Lindqvist zugewiesen.'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Mara Lindqvist', 'APP-16')));
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(announced()).toBe('APP-16 ist jetzt niemandem zugewiesen.'));
    expect(sent('PATCH', '/api/v1/work-items/wi_app_16').slice(1)).toEqual([{ assignee_id: 'u_mara' }, { assignee_id: null }]);
  });

  it('puts the card back with the focus when the server refuses the move', async () => {
    board.refuseMoves = true;
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error', description: 'Nicht erlaubt.' }));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Todo', 'APP-16')));
    expect(countOf('Todo')).toBe(', 3 Items');
    expect(announced()).toBe('');
  });

  it('says when a column could not load and loads it again', async () => {
    board.failing.add('app_todo');
    renderBoard('/projects/APP?layout=board');
    const alert = await within(await screen.findByRole('region', { name: 'Todo' })).findByRole('alert');
    expect(alert.textContent).toContain('Nicht geladen.');

    board.failing.clear();
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(column('Todo')).findByRole('article', { name: /^APP-16 / })).toBeTruthy();
  });

  it('loads the next page of a column at its end, and offers to try again when it fails', async () => {
    board.pageSize = 2;
    let release = () => {};
    board.holdMore = new Promise((resolve) => (release = resolve));
    board.failing.add('more');
    renderBoard('/projects/APP?layout=board');
    // the end of the column shows: the next page is on its way
    expect(await within(await screen.findByRole('region', { name: 'Todo' })).findByText('Weitere Items werden geladen …')).toBeTruthy();
    await act(async () => release());
    const alert = await within(await screen.findByRole('region', { name: 'Todo' })).findByRole('alert');
    expect(within(column('Todo')).getAllByRole('article')).toHaveLength(2);

    board.failing.clear();
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(column('Todo')).findByRole('article', { name: /^APP-18 / })).toBeTruthy();
    expect(within(column('Todo')).queryByText('Weitere Items werden geladen …')).toBeNull();
  });

  it('renders only the cards in view of a column with 500 cards', async () => {
    board.items = Array.from({ length: 500 }, (_, index) => app(index + 1, `Aufgabe ${index + 1}`, 'app_todo'));
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(countOf('Todo')).toBe(', 500 Items'));
    const shown = await waitFor(() => {
      const cards = within(column('Todo')).getAllByRole('article');
      expect(cards.length).toBeGreaterThan(0);
      return cards;
    });
    // 600 px of 96 px cards and a few beyond
    expect(shown.length).toBeLessThan(15);
    // the next page is not asked for until the end of the cards shows
    expect(sent('POST', '/api/v1/work-items/query').filter((body) => (body as Body).cursor !== undefined)).toEqual([]);

    // the cursor goes beyond the cards in view: its card is rendered and gets the focus
    act(() => shown[0]!.focus());
    for (let step = 0; step < 20; step += 1) press('j');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-card-id')).toBe('wi_app_21'));
    expect(within(column('Todo')).getAllByRole('article').length).toBeLessThan(16);
  });
});

describe('the epic on the cards of child items', () => {
  /** What a card names before its key: its epic, in the row of its tab. */
  const epicOf = (card: HTMLElement) => card.querySelector<HTMLElement>('[data-parent-crumb]');

  it('a board grouped by parent names none: its columns are the epics', async () => {
    renderBoard('/projects/WEB?layout=board&group=parent');
    const card = await waitFor(() => cardIn('WEB-30 Relaunch Phase 1', 'WEB-42'));
    expect(epicOf(card)).toBeNull();
    expect(card.getAttribute('aria-label')).toBe('WEB-42 Startseite: Hero und Teaser bauen');
    // grouped by parent a card stays in its column
    act(() => card.focus());
    press('ArrowRight', { shiftKey: true });
    expect(lastToast()?.description).toBe(reasonText({ code: 'stays_parent', params: {} } satisfies BoardReason));
  });

  it('names the right epic where the filter leaves the epic out (Typ = Task)', async () => {
    const filter = encodeURIComponent(JSON.stringify([{ field: 'type', op: 'is', value: 't_task' }]));
    renderBoard(`/projects/WEB?layout=board&filter=${filter}`);
    const card = await waitFor(() => cardIn('In Progress', 'WEB-42'));
    expect(within(column('In Progress')).queryByRole('article', { name: /^WEB-30 / })).toBeNull();
    expect(epicOf(card)?.textContent).toBe('Relaunch Phase 1');
    expect(card.getAttribute('aria-label')).toContain('Teil von WEB-30 Relaunch Phase 1');
  });

  it('⇧P gives a card another epic, and the card names the new one', async () => {
    renderBoard('/projects/WEB?layout=board', { palette: true });
    const card = await waitFor(() => cardIn('In Progress', 'WEB-42'));
    act(() => card.focus());
    await waitFor(() => expect(listCommands().find((entry) => entry.id === 'item.parent')?.when?.()).toBe(true));

    press('P', { shiftKey: true });
    const list = await screen.findByRole('listbox', { name: 'Eltern-Item setzen …' });
    fireEvent.click(await within(list).findByRole('option', { name: /Relaunch Phase 2/ }));

    await waitFor(() => expect(epicOf(cardIn('In Progress', 'WEB-42'))?.textContent).toBe('Relaunch Phase 2'));
    expect(cardIn('In Progress', 'WEB-42').getAttribute('aria-label')).toBe('WEB-42 Startseite: Hero und Teaser bauen, Teil von WEB-50 Relaunch Phase 2');
    expect(board.items.find((entry) => entry.id === 'wi_web_42')?.parent_id).toBe(web50.id);
  });
});

describe('the sentence of a refusal', () => {
  it('names a status the rules do not know as an unknown status', () => {
    expect(reasonText({ code: 'transition', params: { from: '', to: 'Done', workflow: 'Standard' } })).toBe('Von „Unbekannter Status“ nach „Done“ ist im Workflow „Standard“ nicht erlaubt.');
    expect(reasonText({ code: 'start_transition', params: { initial: '', to: 'Done', workflow: 'Standard' } })).toBe(
      'Neue Items starten in „Unbekannter Status“. Von dort nach „Done“ ist im Workflow „Standard“ nicht erlaubt.',
    );
    expect(reasonText({ code: 'transition', params: { from: 'Todo', to: 'Done', workflow: 'Standard' } })).toBe('Von „Todo“ nach „Done“ ist im Workflow „Standard“ nicht erlaubt.');
  });

  it('says a finished sentence of the permissions as it is', () => {
    expect(reasonText({ sentence: 'Im Projekt APP darfst du nur lesen.' })).toBe('Im Projekt APP darfst du nur lesen.');
  });
});
