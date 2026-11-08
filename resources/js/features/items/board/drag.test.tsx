/*
 * Dragging cards with the pointer and the quick add of a column, on the items screen against the fake REST API of
 * `test/board.tsx`. jsdom lays the board out there: columns 270 px apart, cards 96 px high under a 44 px header, so a
 * pointer can be pressed on a card and let go over another one or over a column. dnd-kit's mouse sensor starts a drag
 * after 5 px; jsdom has no Web Animations, so the drop animation finishes at once.
 */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { useUiStore } from '@/store/ui';
import {
  announced,
  app,
  board,
  cardIn,
  column,
  countOf,
  keysIn,
  lastToast,
  layBoardOut,
  rankOf,
  renderBoard as renderWithServer,
  sent,
  startBoardServer,
  stateOf,
  stopBoardServer,
  web,
} from '@/test/board';
import { lene, organization } from '@/test/fixtures';

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
const animate = Element.prototype.animate;
beforeAll(() => {
  restoreLayout = layBoardOut();
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
  startBoardServer();
  useUiStore.setState({ selection: [], peekItemId: null, paletteOpen: false, flashIds: [] });
  resetToasts();
});

afterEach(() => stopBoardServer());

const renderBoard = (path: string) => renderWithServer(path, inertia.go);

/* ---------------------------------------------------------------------- the pointer */

interface Point {
  clientX: number;
  clientY: number;
}

/** The middle of an element, as the layout of `layBoardOut` places it. */
function middle(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

const frameOf = (columnName: string, key: string) => cardIn(columnName, key).closest('[data-card-frame]')!;

/** Presses the pointer on a card and moves it past the 5 px that start a drag. */
async function pickUp(columnName: string, key: string): Promise<void> {
  // a card can be picked up once the rights are known
  await waitFor(() => expect(cardIn(columnName, key).className).toContain('select-none'));
  const frame = frameOf(columnName, key);
  const at = middle(frame);
  act(() => void fireEvent.mouseDown(frame, { button: 0, ...at }));
  act(() => void fireEvent.mouseMove(document, { clientX: at.clientX + 8, clientY: at.clientY + 8 }));
  // dnd-kit says it picked the card up, and at once where it is
  await waitFor(() => expect(dndSaid()).toMatch(new RegExp(`^${key} (aufgenommen|über ${columnName})\\.`)));
}

/** What dnd-kit's live region says last. */
const dndSaid = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';

/** Moves the pointer there and lets the board measure and answer. */
async function moveTo(point: Point): Promise<void> {
  act(() => void fireEvent.mouseMove(document, point));
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

/** Lets the pointer go where it is. */
async function letGo(point: Point): Promise<void> {
  act(() => void fireEvent.mouseUp(document, point));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Drags a card onto a place: over another card, or over the empty part of a column. */
async function drag(columnName: string, key: string, to: () => Point): Promise<void> {
  await pickUp(columnName, key);
  await moveTo(to());
  await moveTo(to());
  await letGo(to());
}

/** A place in the empty part of a column, below its cards. */
const below = (columnName: string): Point => ({ clientX: middle(column(columnName)).clientX, clientY: 560 });
const onCard = (columnName: string, key: string) => () => middle(frameOf(columnName, key));

/* ---------------------------------------------------------------------------- drags */

describe('dragging a card', () => {
  it('cancels a pointer drag with Escape and keeps the selection', async () => {
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => useUiStore.getState().setSelection(['wi_web_44']));

    await pickUp('Todo', 'WEB-48');
    act(() => void fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' }));
    await waitFor(() => expect(dndSaid()).toBe('Abgebrochen. WEB-48 liegt wieder an seinem Platz.'));
    expect(useUiStore.getState().selection).toEqual(['wi_web_44']);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
    // the next Escape is the list's again: it clears the selection
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => void fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' }));
    expect(useUiStore.getState().selection).toEqual([]);
  });

  it('shows the dragged card as a picture that assistive tech and the keyboard leave out', async () => {
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => cardIn('Todo', 'WEB-48'));

    await pickUp('Todo', 'WEB-48');
    // the live region stands at the end of the body: a dialog opening on the drop (the resolution of a closing move)
    // keeps live regions readable and would hide the board along with one inside it
    expect(document.querySelector('[id^="DndLiveRegion"]')?.parentElement).toBe(document.body);
    const overlay = document.querySelector('[inert]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.querySelector('[data-card-id="wi_web_48"], article')).toBeTruthy();
    // one card of that name, the one in its column
    expect(screen.getAllByRole('article', { name: /^WEB-48 / })).toHaveLength(1);
    act(() => void fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' }));
    await waitFor(() => expect(dndSaid()).toBe('Abgebrochen. WEB-48 liegt wieder an seinem Platz.'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('moves a card dropped on another column there, and the server has it', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Todo', 'APP-16'));

    await drag('Todo', 'APP-16', () => below('In Progress'));
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toEqual([{ to_state_id: 'app_progress', resolution_id: null }]));
    await waitFor(() => expect(announced()).toBe('APP-16 steht jetzt in In Progress.'));
    expect(stateOf('wi_app_16')).toBe('app_progress');
    expect(cardIn('In Progress', 'APP-16')).toBeTruthy();
    expect(countOf('Todo')).toBe(', 2 Items');
    expect(countOf('In Progress')).toBe(', 2 Items');
    // the card has the focus, the cursor with it
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-16')));
  });

  it('springs back from a column the workflow does not allow, dims it while the card is over it, and says why', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Todo', 'APP-16'));

    await pickUp('Todo', 'APP-16');
    // over In Progress the card stands there; over Done it waits at home and names the reason
    await moveTo(below('In Progress'));
    await moveTo(below('In Progress'));
    await waitFor(() => expect(keysIn('In Progress')).toContain('APP-16'));
    await moveTo(below('Done'));
    await moveTo(below('Done'));
    const reason = 'Von „Todo“ nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.';
    await waitFor(() => expect(screen.getAllByText(reason).length).toBeGreaterThan(0));
    expect(keysIn('Todo')).toContain('APP-16');
    expect(keysIn('In Progress')).not.toContain('APP-16');
    // a column the card may not enter is dimmed and marked
    expect(column('Done').querySelector('header')?.className).toContain('opacity-40');
    expect(column('In Progress').querySelector('header')?.className).not.toContain('opacity-40');

    await letGo(below('Done'));
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'APP-16 nicht verschoben', description: reason });
    expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toEqual([]);
    expect(keysIn('Todo')).toContain('APP-16');
    expect(column('Done').querySelector('header')?.className).not.toContain('opacity-40');
  });

  it('puts a card back and fixes the counts when the server refuses the move', async () => {
    board.refuseMoves = true;
    let release = () => {};
    board.holdMoves = new Promise((resolve) => (release = resolve));
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(countOf('In Progress')).toBe(', 1 Item'));
    await waitFor(() => cardIn('Todo', 'APP-16'));

    await drag('Todo', 'APP-16', () => below('In Progress'));
    // until the server answers the card stands in its new column, the counts with it
    await waitFor(() => expect(cardIn('In Progress', 'APP-16').getAttribute('aria-busy')).toBe('true'));
    expect(countOf('Todo')).toBe(', 2 Items');
    expect(countOf('In Progress')).toBe(', 2 Items');

    await act(async () => release());
    await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error', description: 'Nicht erlaubt.' }));
    await waitFor(() => expect(keysIn('Todo')).toEqual(['APP-16', 'APP-17', 'APP-18']));
    expect(keysIn('In Progress')).toEqual(['APP-20']);
    expect(countOf('Todo')).toBe(', 3 Items');
    expect(countOf('In Progress')).toBe(', 1 Item');
    expect(announced()).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Todo', 'APP-16')));
  });

  it('puts a card back when the server does not answer, and offers to try again', async () => {
    board.failMoves = true;
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Todo', 'APP-16'));

    await drag('Todo', 'APP-16', () => below('In Progress'));
    await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error', title: 'Statuswechsel nicht gespeichert', description: 'Wartung.' }));
    expect(lastToast()?.action?.label).toBe('Erneut versuchen');
    await waitFor(() => expect(keysIn('Todo')).toEqual(['APP-16', 'APP-17', 'APP-18']));
    expect(countOf('In Progress')).toBe(', 1 Item');
  });

  it('keeps a card in its column on a board grouped by parent and says why', async () => {
    renderBoard('/projects/WEB?layout=board&group=parent');
    await waitFor(() => cardIn('WEB-30 Relaunch Phase 1', 'WEB-42'));

    await drag('WEB-30 Relaunch Phase 1', 'WEB-42', () => below('Ohne Eltern-Item'));
    expect(lastToast()).toMatchObject({
      tone: 'error',
      title: 'WEB-42 nicht verschoben',
      description: 'Nach Eltern-Item gruppiert bleiben Karten in ihrer Spalte. Das Eltern-Item änderst du mit ⇧P.',
    });
    expect(keysIn('WEB-30 Relaunch Phase 1')).toEqual(['WEB-42']);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_42')).toEqual([]);
  });

  it('asks for the resolution of a card dropped on Done, and puts it back when the question is cancelled', async () => {
    const user = userEvent.setup();
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Kundenfreigabe', 'APP-15'));

    await drag('Kundenfreigabe', 'APP-15', () => below('Done'));
    await screen.findByRole('dialog', { name: 'APP-15 auf Done setzen' });
    // while the question is open the card waits in Done (the dialog hides the board from the roles)
    const done = document.querySelector('[data-column-key="app_done"]')!;
    expect([...done.querySelectorAll('[data-card-id]')].map((card) => card.getAttribute('data-card-id'))).toEqual(['wi_app_15']);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(announced()).toBe('Abgebrochen. APP-15 bleibt in Kundenfreigabe.'));
    await waitFor(() => expect(keysIn('Kundenfreigabe')).toEqual(['APP-15']));
    expect(keysIn('Done')).toEqual([]);
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
  });

  it('keeps a card dropped again while its first move is on its way where the second drop put it', async () => {
    let release = () => {};
    board.holdMoves = new Promise((resolve) => (release = resolve));
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Todo', 'APP-16'));

    await drag('Todo', 'APP-16', () => below('In Progress'));
    await waitFor(() => expect(cardIn('In Progress', 'APP-16').getAttribute('aria-busy')).toBe('true'));
    // the second drop waits for the first, then asks for the resolution
    await drag('In Progress', 'APP-16', () => below('Cancelled'));
    await act(async () => release());
    await screen.findByRole('dialog', { name: 'APP-16 auf Cancelled setzen' });
    // the end of the first move leaves the place of the second alone: the card waits in Cancelled
    const cancelled = document.querySelector('[data-column-key="app_cancelled"]')!;
    expect([...cancelled.querySelectorAll('[data-card-id]')].map((card) => card.getAttribute('data-card-id'))).toEqual(['wi_app_16']);
    expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toEqual([{ to_state_id: 'app_progress', resolution_id: null }]);

    // the question is answered: the second move goes out
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toHaveLength(2));
    await waitFor(() => expect(stateOf('wi_app_16')).toBe('app_cancelled'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('drops a card between two others and sends the rank between them', async () => {
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-44', 'WEB-48']));

    // WEB-48 onto WEB-44: it takes the place of WEB-44, which moves down
    await drag('Todo', 'WEB-48', onCard('Todo', 'WEB-44'));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_48')[0] as { rank: string };
    expect('a1' < rank && rank < 'a2').toBe(true);
    await waitFor(() => expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-48', 'WEB-44']));
    await waitFor(() => expect(announced()).toBe('WEB-48 steht jetzt an Stelle 2 von 3 in Todo.'));
  });

  it('drops a card between two cards of equal rank from different projects', async () => {
    // on Meine Items the items of both projects meet in the columns of the categories; APP-16 and WEB-44 share a rank
    board.items = board.items.map((entry) => (entry.id === 'wi_app_16' ? { ...entry, rank: 'a2' } : entry));
    renderBoard('/my-items?layout=board&sort=rank');
    await waitFor(() => expect(keysIn('Unstarted').slice(0, 4)).toEqual(['WEB-43', 'APP-16', 'WEB-44', 'WEB-48']));

    await drag('Unstarted', 'WEB-48', onCard('Unstarted', 'WEB-44'));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    // no rank lies between two equal ones: the card goes just past them, never between ranks it would equal, and stays
    // above the card that comes after them (T19-M5)
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_48')[0] as { rank: string };
    expect(keysIn('Unstarted')[4]).toBe('APP-17');
    expect('a2' < rank && rank < rankOf(17)).toBe(true);
  });

  it('redistributes the ranks when a dropped card has no room, and keeps the card in its new place meanwhile', async () => {
    // WEB-44 lies right after WEB-43, with a rank of 128 characters: between the two there is no room left
    board.items = board.items.map((entry) => (entry.id === 'wi_web_44' ? { ...entry, rank: `a1${'0'.repeat(125)}1` } : entry));
    let release = () => {};
    board.holdRanks = new Promise((resolve) => (release = resolve));
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-44', 'WEB-48']));

    await drag('Todo', 'WEB-48', onCard('Todo', 'WEB-44'));
    await waitFor(() => expect(announced()).toBe('Ordnung wird neu verteilt …'));
    expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-48', 'WEB-44']);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
    await act(async () => release());
    await waitFor(() => expect(sent('POST', '/api/v1/projects/p_web/redistribute-ranks')).toHaveLength(1));

    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_48')[0] as { rank: string };
    expect('a0' < rank && rank < 'a1').toBe(true);
    await waitFor(() => expect(announced()).toBe('WEB-48 steht jetzt an Stelle 2 von 3 in Todo.'));
    expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-48', 'WEB-44']);
  });

  it('puts the card back when the redistribution fails', async () => {
    board.items = board.items.map((entry) => (entry.id === 'wi_web_44' ? { ...entry, rank: `a1${'0'.repeat(125)}1` } : entry));
    board.failRanks = true;
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-44', 'WEB-48']));

    await drag('Todo', 'WEB-48', onCard('Todo', 'WEB-44'));
    await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error', title: 'WEB-48 nicht verschoben', description: 'Wartung.', action: { label: 'Erneut versuchen' } }));
    await waitFor(() => expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-44', 'WEB-48']));
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
    await waitFor(() => expect(cardIn('Todo', 'WEB-48').getAttribute('aria-busy')).toBeNull());

    // "Try again" makes room and moves the card where it was dropped
    board.failRanks = false;
    act(() => lastToast()!.action!.onClick());
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    expect(sent('POST', '/api/v1/projects/p_web/redistribute-ranks')).toHaveLength(2);
    await waitFor(() => expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-48', 'WEB-44']));
  });

  it('keeps the order of a column sorted by something else and says so once', async () => {
    renderBoard('/projects/WEB?layout=board&sort=priority');
    await waitFor(() => cardIn('Todo', 'WEB-48'));

    await drag('Todo', 'WEB-48', onCard('Todo', 'WEB-43'));
    await drag('Todo', 'WEB-48', onCard('Todo', 'WEB-43'));
    expect(currentToasts().filter((entry) => entry.title === 'Die Reihenfolge folgt der Sortierung')).toHaveLength(1);
    // dropped on its own place: nothing to say
    resetToasts();
    await drag('Todo', 'WEB-48', onCard('Todo', 'WEB-48'));
    expect(currentToasts()).toEqual([]);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
  });

  it('puts a card dropped beside every column back where it was', async () => {
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => cardIn('Todo', 'WEB-48'));

    // far away from the board: the card was last over its own place
    await drag('Todo', 'WEB-48', () => ({ clientX: 9000, clientY: -9000 }));
    expect(keysIn('Todo')).toEqual(['WEB-43', 'WEB-44', 'WEB-48']);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
    expect(currentToasts()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Todo', 'WEB-48')));
  });

  it('does not take the click that ends a drag for a click on the card', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Todo', 'APP-17'));
    // the browser's own drag of the link would swallow the pointer moves
    expect(fireEvent.dragStart(frameOf('Todo', 'APP-17'))).toBe(false);

    await pickUp('Todo', 'APP-17');
    await moveTo(onCard('Todo', 'APP-17')());
    // the browser sends the click right after the pointer comes up
    act(() => {
      fireEvent.mouseUp(document, onCard('Todo', 'APP-17')());
      fireEvent.click(within(cardIn('Todo', 'APP-17')).getByRole('link'));
    });
    expect(useUiStore.getState().peekItemId).toBeNull();
    // a click later is a click again (dnd-kit stops clicks for 50 ms after a drag)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    fireEvent.click(within(cardIn('Todo', 'APP-17')).getByRole('link'));
    expect(useUiStore.getState().peekItemId).toBe('wi_app_17');
  });

  it('puts a card dropped on another column where the sort of the board puts it', async () => {
    renderBoard('/projects/APP?layout=board&sort=state_category');
    await waitFor(() => cardIn('Todo', 'APP-16'));

    await pickUp('Todo', 'APP-16');
    await moveTo(onCard('In Progress', 'APP-20')());
    await moveTo(onCard('In Progress', 'APP-20')());
    // one category in the column: then the rank, and APP-16 comes before APP-20
    await waitFor(() => expect(keysIn('In Progress')).toEqual(['APP-16', 'APP-20']));
    await letGo(onCard('In Progress', 'APP-20')());
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toHaveLength(1));
    // a move to another column sends no rank
    expect(sent('PATCH', '/api/v1/work-items/wi_app_16')).toEqual([]);
  });

  it('does not drag on a board grouped by label', async () => {
    board.items = board.items.map((entry) => (entry.id === 'wi_app_16' ? { ...entry, label_ids: ['lb_ux', 'lb_forms'] } : entry));
    renderBoard('/projects/APP?layout=board&group=label');
    const card = await waitFor(() => cardIn('UX', 'APP-16'));
    // no card lies in a frame dnd-kit could pick up
    expect(document.querySelector('[data-card-frame]')).toBeNull();

    act(() => void fireEvent.mouseDown(card, { button: 0, ...middle(card) }));
    act(() => void fireEvent.mouseMove(document, { clientX: 700, clientY: 400 }));
    act(() => void fireEvent.mouseUp(document, { clientX: 700, clientY: 400 }));
    expect(dndSaid()).toBe('');
    expect(keysIn('UX')).toEqual(['APP-16']);
    expect(sent('PATCH', '/api/v1/work-items/wi_app_16')).toEqual([]);
  });

  it('does not pick up the card of a viewer', async () => {
    board.roles.WEB = 'viewer';
    renderBoard('/projects/WEB?layout=board');
    await waitFor(() => cardIn('Todo', 'WEB-48'));
    await waitFor(() => expect(within(column('Todo')).getByRole('button', { name: 'Item in Todo anlegen' }).getAttribute('aria-disabled')).toBe('true'));

    const frame = frameOf('Todo', 'WEB-48');
    act(() => void fireEvent.mouseDown(frame, { button: 0, ...middle(frame) }));
    act(() => void fireEvent.mouseMove(document, { clientX: 700, clientY: 400 }));
    expect(dndSaid()).toBe('');
    act(() => void fireEvent.mouseUp(document, { clientX: 700, clientY: 400 }));
  });
});

/* ------------------------------------------------------------------------- quick add */

describe('the quick add of a column', () => {
  it('creates an item in the status of the column with its quick add', async () => {
    renderBoard('/projects/APP?layout=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Testflug planen' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(sent('POST', '/api/v1/work-items')).toEqual([{ project_id: 'p_app', state_id: 'app_todo', type_id: 't_task', title: 'Testflug planen' }]));
    expect(await within(column('Todo')).findByRole('article', { name: /Testflug planen/ })).toBeTruthy();
    await waitFor(() => expect(announced()).toBe('APP-21 in Todo angelegt.'));
    // the new card lights up; the form waits for the next title
    await waitFor(() => expect(useUiStore.getState().flashIds).toContain('wi_app_21'));
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);

    // Escape closes the form and gives the focus back to the "+"
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Item in Todo anlegen' })));
    expect(screen.queryByRole('textbox', { name: 'Neues Item in Todo' })).toBeNull();
  });

  it('creates a child of the epic with the quick add of its column, also when the default type is an epic', async () => {
    board.webDefaultType = 't_epic';
    renderBoard('/projects/WEB?layout=board&group=parent');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in WEB-30 Relaunch Phase 1 anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in WEB-30 Relaunch Phase 1' });
    fireEvent.change(input, { target: { value: 'Pressebereich anlegen' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(sent('POST', '/api/v1/work-items')).toEqual([{ project_id: 'p_web', parent_id: 'wi_web_30', type_id: 't_task', title: 'Pressebereich anlegen' }]));
  });

  it('lights up a new card that comes with a later page of its column', async () => {
    board.pageSize = 2;
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(keysIn('Todo')).toEqual(['APP-16', 'APP-17', 'APP-18']));
    let release = () => {};
    board.holdMore = new Promise((resolve) => (release = resolve));

    fireEvent.click(screen.getByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    fireEvent.change(input, { target: { value: 'Testflug planen' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(announced()).toBe('APP-21 in Todo angelegt.'));
    // the column loads its pages again: the board waits for them before it looks for the card
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useUiStore.getState().flashIds).toEqual([]);

    await act(async () => release());
    await waitFor(() => expect(useUiStore.getState().flashIds).toContain('wi_app_21'));
    expect(currentToasts()).toEqual([]);
  });

  it('says where a new card stands that a later page of its column will bring, and opens it from the toast', async () => {
    // more cards in Todo than the first page holds, and than the column shows: the next page is not asked for
    board.items.push(...Array.from({ length: 12 }, (_, index) => app(30 + index, `Aufgabe ${30 + index}`, 'app_todo')));
    board.pageSize = 12;
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(keysIn('Todo')).toContain('APP-30'));

    fireEvent.click(screen.getByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    fireEvent.change(input, { target: { value: 'Testflug planen' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'APP-42 angelegt', description: 'APP-42 steht weiter unten in „Todo“.' }));
    expect(useUiStore.getState().flashIds).toEqual([]);
    act(() => lastToast()!.action!.onClick());
    expect(useUiStore.getState().peekItemId).toBe('wi_app_42');
  });

  it('keeps an empty quick add open, says what is missing and puts the focus on the title', async () => {
    renderBoard('/projects/APP?layout=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    const send = screen.getByRole('button', { name: 'Anlegen' });
    act(() => send.focus());
    fireEvent.click(send);

    expect(await screen.findByText('Gib einen Titel ein.')).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(sent('POST', '/api/v1/work-items')).toEqual([]);
    // typing takes the hint away
    fireEvent.change(input, { target: { value: 'L' } });
    expect(screen.queryByText('Gib einen Titel ein.')).toBeNull();
  });

  it('offers no quick add in a status a new item may not start in, and says why', async () => {
    renderBoard('/projects/APP?layout=board');
    const add = await screen.findByRole('button', { name: 'Item in Done anlegen' });
    await waitFor(() =>
      expect(document.getElementById(add.getAttribute('aria-describedby')!)?.textContent).toBe(
        'Neue Items starten in „Backlog“. Von dort nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.',
      ),
    );
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(screen.queryByRole('textbox', { name: 'Neues Item in Done' })).toBeNull();
  });

  it('offers no quick add to a viewer, and says why', async () => {
    board.roles.APP = 'viewer';
    renderBoard('/projects/APP?layout=board');
    const add = await screen.findByRole('button', { name: 'Item in Todo anlegen' });
    await waitFor(() => expect(document.getElementById(add.getAttribute('aria-describedby')!)?.textContent).toContain('nur lesen'));
  });

  it('shows the refusal of the server at the title, and offers to try again when it did not answer', async () => {
    renderBoard('/projects/APP?layout=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    fireEvent.change(input, { target: { value: 'Zu lang' } });

    const answering = globalThis.fetch;
    let answer: { status: number; body: unknown } = { status: 422, body: { reason: 'validation_failed', errors: { title: ['Höchstens 255 Zeichen.'] } } };
    globalThis.fetch = (input, init) =>
      init?.method === 'POST' && String(input).endsWith('/api/v1/work-items')
        ? Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/problem+json' } }))
        : answering(input, init);
    try {
      fireEvent.submit(input.closest('form')!);
      expect(await screen.findByText('Höchstens 255 Zeichen.')).toBeTruthy();
      expect(document.activeElement).toBe(input);

      answer = { status: 422, body: { reason: 'validation_failed', errors: { state_id: ['Den Status gibt es nicht.'] } } };
      fireEvent.submit(input.closest('form')!);
      expect(await screen.findByText('Den Status gibt es nicht.')).toBeTruthy();

      answer = { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };
      fireEvent.submit(input.closest('form')!);
      await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error', title: 'Item nicht angelegt', description: 'Wartung.' }));
    } finally {
      globalThis.fetch = answering;
    }
    // the title stays for another try
    expect((input as HTMLInputElement).value).toBe('Zu lang');
    act(() => lastToast()!.action!.onClick());
    await waitFor(() => expect(sent('POST', '/api/v1/work-items')).toHaveLength(1));
  });

  it('says so when the filter of the list leaves the new item out, and opens it from the toast', async () => {
    const filter = encodeURIComponent(JSON.stringify([{ field: 'type', op: 'is', value: 't_task' }]));
    board.webDefaultType = 't_bug';
    renderBoard(`/projects/WEB?layout=board&filter=${filter}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    fireEvent.change(input, { target: { value: 'Fehler im Footer' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'WEB-51 angelegt', description: 'Es passt nicht zum Filter dieser Liste und steht darum nicht hier.' }));
    act(() => lastToast()!.action!.onClick());
    expect(useUiStore.getState().peekItemId).toBe('wi_web_51');
  });

  it('chooses the project on a board of several, the one with the most cards first, and assigns the item to me on Meine Items', async () => {
    const user = userEvent.setup();
    board.items = [...board.items, web(60, 'Sitemap', 'std_todo')];
    renderBoard('/my-items?layout=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Backlog anlegen' }));
    const form = screen.getByRole('textbox', { name: 'Neues Item in Backlog' }).closest('form')!;
    const select = within(form).getByRole('combobox', { name: 'Projekt' });
    expect(select.textContent).toContain('Website-Relaunch (WEB)');

    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Kunden-App (APP)' }));
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Onboarding' } });
    fireEvent.submit(form);
    await waitFor(() => expect(sent('POST', '/api/v1/work-items')).toEqual([{ project_id: 'p_app', assignee_id: 'u_lene', type_id: 't_task', title: 'Onboarding' }]));
  });

  it('lets the column say who takes the item on Meine Items grouped by assignee, also nobody', async () => {
    renderBoard('/my-items?layout=board&group=assignee');
    const add = await screen.findByRole('button', { name: 'Item in Nicht zugewiesen anlegen' });
    // the board offers it once projects, workflows and types are there
    await waitFor(() => expect(add.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(add);
    const input = screen.getByRole('textbox', { name: 'Neues Item in Nicht zugewiesen' });
    fireEvent.change(input, { target: { value: 'Sitemap' } });
    fireEvent.submit(input.closest('form')!);

    // no assignee: the list's own "assigned to me" does not overrule the column
    await waitFor(() => expect(sent('POST', '/api/v1/work-items')).toEqual([{ project_id: 'p_web', type_id: 't_task', title: 'Sitemap' }]));
    await waitFor(() => expect(announced()).toBe('WEB-51 in Nicht zugewiesen angelegt.'));
    await waitFor(() => expect(useUiStore.getState().flashIds).toContain('wi_web_51'));
    expect(currentToasts()).toEqual([]);

    // a column of a person gives the item to that person
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Item in Mara Lindqvist anlegen' }));
    const mara = screen.getByRole('textbox', { name: 'Neues Item in Mara Lindqvist' });
    fireEvent.change(mara, { target: { value: 'Impressum prüfen' } });
    fireEvent.submit(mara.closest('form')!);
    await waitFor(() => expect(sent('POST', '/api/v1/work-items').at(-1)).toEqual({ project_id: 'p_web', assignee_id: 'u_mara', type_id: 't_task', title: 'Impressum prüfen' }));
  });

  it('makes an item in the project of its column on a board grouped by project', async () => {
    renderBoard('/my-items?layout=board&group=project');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Kunden-App anlegen' }));
    const form = screen.getByRole('textbox', { name: 'Neues Item in Kunden-App' }).closest('form')!;
    expect(within(form).queryByRole('combobox')).toBeNull();
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Onboarding' } });
    fireEvent.submit(form);
    await waitFor(() => expect(sent('POST', '/api/v1/work-items')).toEqual([{ project_id: 'p_app', assignee_id: 'u_lene', type_id: 't_task', title: 'Onboarding' }]));
  });
});
