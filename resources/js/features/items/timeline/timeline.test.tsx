/*
 * The timeline on the items screen against the fake REST API of `test/board.tsx` (WEB with the free standard
 * workflow, APP with the agency workflow): epics by project, bars, "Ohne Datum", the keys, the pointer and the
 * virtualized rows. Ported from the clickdummy's `TimelineLayout.test.tsx` (same names where they match). jsdom lays
 * nothing out: the scroll box reports its size and place, the title column its width, the grid its place, so the
 * virtualizer renders what fits and a pointer finds the day under it. The clock stands at 2026-10-28, 11:00 in Berlin.
 */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { app, board, press, rankOf, renderBoard as renderWithServer, sent, startBoardServer, stopBoardServer, web } from '@/test/board';
import { lene, organization } from '@/test/fixtures';
import type { WorkItem } from '@/types';
import { PLANNED_DAYS, SAVE_DELAY } from './TimelineLayout';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/my-items?layout=timeline';
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
      replace: ({ url }: { url: string }) => inertia.go(url),
      visit: inertia.visit,
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

/* ------------------------------------------------------------------- layout in jsdom */

/** The scroll box: 1000 × 440 px, 100 px below the top of the window; the title column is 136 px wide. */
const BOX = { left: 0, top: 100, width: 1000, height: 440 };
const LABEL = 136;
/** The list of "Ohne Datum" scrolls in a box of its own, 400 px tall; an epic there (card and button) is 120 px. */
const UNPLANNED = { height: 400, entry: 120 };
const descriptors = {
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!,
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!,
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!,
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!,
};
const boundingRect = Element.prototype.getBoundingClientRect;
/** Where the rows stand in the window (all at the same place): above the box at first, so a focused row scrolls up. */
let rowTop = 0;
const scrollTo = Element.prototype.scrollTo;
const windowScroll = { scrollTo: window.scrollTo, scrollBy: window.scrollBy };

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      if (this.hasAttribute('data-unplanned-list')) return UNPLANNED.height;
      return this.hasAttribute('data-timeline-scroller') ? BOX.height : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-unplanned-entry') ? UNPLANNED.entry : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute('data-timeline-scroller') ? BOX.width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-timeline-label') ? LABEL : 0;
    },
  });
  // the grid begins after the title column; it stands still here, whatever the box scrolled
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-timeline-scroller')) return new DOMRect(BOX.left, BOX.top, BOX.width, BOX.height);
    if (this.hasAttribute('data-timeline-grid')) return new DOMRect(BOX.left + LABEL, BOX.top + 56, 4000, 2000);
    if (this.matches('[role="group"][data-nav-target]')) return new DOMRect(0, rowTop, BOX.width, 44);
    return boundingRect.call(this);
  };
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop;
    this.dispatchEvent(new Event('scroll'));
  } as typeof Element.prototype.scrollTo;
  // the page scrolls a row below the toolbar, and the list (1) scrolls with the window
  window.scrollBy = (() => {}) as typeof window.scrollBy;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterAll(() => {
  Object.defineProperty(Element.prototype, 'clientHeight', descriptors.clientHeight);
  Object.defineProperty(Element.prototype, 'clientWidth', descriptors.clientWidth);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', descriptors.offsetWidth);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptors.offsetHeight);
  Element.prototype.getBoundingClientRect = boundingRect;
  Element.prototype.scrollTo = scrollTo;
  Object.assign(window, windowScroll);
});

/* --------------------------------------------------------------------- the items */

const epic = (changes: Partial<WorkItem>) => ({ type_id: 't_epic', ...changes });
const web30 = web(30, 'Relaunch Phase 1', 'std_progress', epic({ start_date: '2026-10-01', due_date: '2026-11-15', children_progress: { done: 1, total: 2 } }));
const app5 = app(5, 'Onboarding-Strecke', 'app_progress', epic({ start_date: '2026-10-20', due_date: '2026-12-20' }));
const web50 = web(50, 'Relaunch Phase 2', 'std_backlog', epic({}));
const task = web(41, 'Kontaktformular sendet doppelt', 'std_progress', { start_date: '2026-10-05', due_date: '2026-10-09' });

beforeEach(() => {
  rowTop = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
  startBoardServer();
  board.items = [web30, app5, web50, task];
  useUiStore.setState({ selection: [], peekItemId: null, paletteOpen: false, createOpen: false, createDefaults: null });
  resetToasts();
  inertia.visit.mockClear();
});

afterEach(() => {
  stopBoardServer();
  vi.useRealTimers();
});

const renderTimeline = (path = '/my-items?layout=timeline') => renderWithServer(path, inertia.go);

/* ------------------------------------------------------------------------- reading */

/** An epic's row on the time axis, named by its key. */
const row = (key: string) => screen.getByRole('group', { name: new RegExp(`^${key} `) });
const findRow = (key: string) => screen.findByRole('group', { name: new RegExp(`^${key} `) });
const aside = () => screen.getByRole('complementary', { name: 'Ohne Datum' });
const card = (key: string) => within(aside()).getByRole('article', { name: new RegExp(`^${key} `) });
const scroller = () => document.querySelector<HTMLElement>('[data-timeline-scroller]')!;
const barOf = (id: string) => document.querySelector<HTMLElement>(`[data-timeline-bar="${id}"]`)!;
const announced = () => screen.getByRole('status', { name: 'Mitteilungen der Timeline' }).textContent;
const patches = (id: string) => sent('PATCH', `/api/v1/work-items/${id}`);
const stored = (id: string) => board.items.find((entry) => entry.id === id)!;
const lastToast = () => currentToasts().at(-1);

/** The pointer: pressed on an element, moved and let go on the window, as a browser sends it. */
const pointerDown = (target: Element, init: PointerEventInit = {}) => act(() => void fireEvent.pointerDown(target, { button: 0, pointerType: 'mouse', pointerId: 1, ...init }));
const pointerMove = (init: PointerEventInit) => act(() => void fireEvent.pointerMove(window, { pointerId: 1, ...init }));
const pointerUp = (init: PointerEventInit = {}) => act(() => void fireEvent.pointerUp(window, { pointerId: 1, ...init }));

/** The rows of the timeline can be changed once the rights are known: the grips show. */
const editable = (id: string) => waitFor(() => expect(barOf(id).querySelector('[data-edge="due"]')).toBeTruthy());

/** The organisation of the test in another zone or with another first weekday, back to the fixture after it. */
function inZone(changes: Partial<typeof organization>) {
  const before = { ...organization };
  Object.assign(organization, changes);
  onTestFinished(() => {
    Object.assign(organization, before);
  });
}

/** Focuses an epic's row, the cursor goes with it. */
async function focusRow(key: string) {
  const element = await findRow(key);
  act(() => element.focus());
  return element;
}

/* --------------------------------------------------------------------------- tests */

describe('the timeline', () => {
  it('shows only the epics, grouped by project', async () => {
    renderTimeline();
    const relaunch = await screen.findByRole('region', { name: 'Website-Relaunch' });
    expect(within(relaunch).getByRole('group', { name: /^WEB-30 Relaunch Phase 1, 01\.10\.2026 bis 15\.11\.2026/ })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Kunden-App' })).getByRole('group', { name: /^APP-5 Onboarding-Strecke, 20\.10\.2026 bis 20\.12\.2026$/ })).toBeTruthy();
    // a task is no epic
    expect(screen.queryByText('Kontaktformular sendet doppelt')).toBeNull();
    // the server is asked for the epics alone, by project, in the order of their start
    const body = sent('POST', '/api/v1/work-items/query').at(-1) as { filter: { conditions: unknown[] }; group_by: string; sort: unknown };
    expect(body.filter.conditions).toContainEqual({ field: 'epic', op: 'is', value: true });
    expect(body.group_by).toBe('project');
    expect(body.sort).toEqual({ field: 'start_date', direction: 'asc' });
    // the projects in the order of the server, the axis around the dates and today
    const regions = screen.getAllByRole('region');
    expect(regions.indexOf(screen.getByRole('region', { name: 'Kunden-App' }))).toBeLessThan(regions.indexOf(relaunch));
    expect(screen.getByText('Epics nach Projekt, September 2026 bis Januar 2027')).toBeTruthy();
    // one row is the tab stop
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
  });

  it('moves the selected epic by one unit with ⇧→ and saves both dates', async () => {
    renderTimeline();
    await focusRow('WEB-30');

    // month zoom: one unit is a week
    press('ArrowRight', { shiftKey: true });
    // the bar moves at once and says so, the axis names its days
    expect(announced()).toBe('WEB-30: 08.10.2026 bis 22.11.2026');
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/^WEB-30 Relaunch Phase 1, 08\.10\.2026 bis 22\.11\.2026/);
    expect(document.querySelector('[data-timeline-axis]')!.textContent).toContain('08.10.');
    expect(patches('wi_web_30')).toEqual([]);

    await waitFor(() => expect(stored('wi_web_30')).toMatchObject({ start_date: '2026-10-08', due_date: '2026-11-22' }), { timeout: 2000 });
    expect(patches('wi_web_30')).toEqual([{ start_date: '2026-10-08', due_date: '2026-11-22' }]);
    await waitFor(() => expect(announced()).toBe('WEB-30 gespeichert: 08.10.2026 bis 22.11.2026.'));
    expect(document.activeElement).toBe(row('WEB-30'));
  });

  it('keeps the focus on an epic that moves past another of its project', async () => {
    const discovery = web(31, 'Discovery', 'std_progress', epic({ start_date: '2026-10-01', due_date: '2026-10-05' }));
    const design = web(32, 'Design', 'std_progress', epic({ start_date: '2026-10-05', due_date: '2026-10-20' }));
    board.items = [discovery, design];
    renderTimeline();
    const order = () => within(screen.getByRole('region', { name: 'Website-Relaunch' })).getAllByRole('group').map((element) => element.getAttribute('aria-label')!.split(' ')[0]);
    await focusRow('WEB-31');
    expect(order()).toEqual(['WEB-31', 'WEB-32']);

    // a week later it starts after the second one: once saved, the group sorts anew (React moves the focused row's
    // element), and the row keeps the focus
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(announced()).toBe('WEB-31 gespeichert: 08.10.2026 bis 12.10.2026.'), { timeout: 2000 });
    await waitFor(() => expect(order()).toEqual(['WEB-32', 'WEB-31']));
    expect(document.activeElement).toBe(row('WEB-31'));
  });

  it('changes the duration of the selected epic with ⌥→ and ⌥←', async () => {
    renderTimeline();
    await focusRow('WEB-30');

    press('ArrowRight', { altKey: true });
    press('ArrowRight', { altKey: true, repeat: true });
    press('ArrowLeft', { altKey: true });
    await waitFor(() => expect(stored('wi_web_30')).toMatchObject({ start_date: '2026-10-01', due_date: '2026-11-22' }), { timeout: 2000 });
    // held keys save once they rest
    expect(patches('wi_web_30')).toHaveLength(1);
  });

  it('saves nothing when the keys come back to the saved dates', async () => {
    renderTimeline();
    await focusRow('WEB-30');
    press('ArrowRight', { shiftKey: true });
    press('ArrowLeft', { shiftKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY + 100));
    });
    expect(patches('wi_web_30')).toEqual([]);
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/01\.10\.2026 bis 15\.11\.2026/);
  });

  it('asks before the page goes while moved dates are not saved yet', async () => {
    // the dates of WEB-30 wait on their way
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'PATCH' && String(input).endsWith('/wi_web_30')) await gate;
      return inner(input, init);
    };
    onTestFinished(() => {
      globalThis.fetch = inner;
    });
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    renderTimeline();
    await focusRow('WEB-30');
    expect(leave()).toBe(false);
    press('ArrowRight', { shiftKey: true });
    // the keys rest for a moment, then the dates are on their way
    expect(leave()).toBe(true);
    await waitFor(() => expect(row('WEB-30').getAttribute('aria-busy')).toBe('true'), { timeout: 2000 });
    expect(leave()).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(stored('wi_web_30').start_date).toBe('2026-10-08'));
    await waitFor(() => expect(leave()).toBe(false));
  });

  it('saves what was moved when the layout goes before the keys rest', async () => {
    renderTimeline();
    await focusRow('WEB-30');
    press('ArrowRight', { shiftKey: true });
    // 1: the list
    press('1');
    await waitFor(() => expect(patches('wi_web_30')).toEqual([{ start_date: '2026-10-08', due_date: '2026-11-22' }]));
  });

  it('moves by a day at week zoom', async () => {
    renderTimeline();
    await findRow('APP-5');
    fireEvent.click(screen.getByRole('button', { name: 'Woche' }));
    // the zoom is part of the address, the rest of it stays
    expect(inertia.url).toBe('/my-items?layout=timeline&zoom=week');
    await focusRow('APP-5');

    press('ArrowLeft', { shiftKey: true });
    await waitFor(() => expect(stored('wi_app_5')).toMatchObject({ start_date: '2026-10-19', due_date: '2026-12-19' }), { timeout: 2000 });

    // the month needs no parameter
    fireEvent.click(screen.getByRole('button', { name: 'Monat' }));
    expect(inertia.url).toBe('/my-items?layout=timeline');
  });

  it('opens at the zoom the address names', async () => {
    renderTimeline('/my-items?layout=timeline&zoom=quarter');
    await findRow('WEB-30');
    expect(screen.getByRole('button', { name: 'Quartal' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Q4 2026')).toBeTruthy();
  });

  it('brings today back into view with "Heute"', async () => {
    renderTimeline();
    await findRow('WEB-30');
    // today stands at a third of the axis: 57 days after 2026-09-01, at 12 px a day
    const third = 57 * 12 - (BOX.width - LABEL) / 3;
    expect(scroller().scrollLeft).toBe(third);
    act(() => {
      scroller().scrollLeft = 0;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Heute' }));
    expect(scroller().scrollLeft).toBe(third);
  });

  it('lists epics without dates under "Ohne Datum" and plans one from today', async () => {
    renderTimeline();
    await findRow('WEB-30');
    expect(within(aside()).getByText('1')).toBeTruthy();
    expect(card('WEB-50').getAttribute('aria-label')).toBe('WEB-50 Relaunch Phase 2, ohne Datum');

    fireEvent.click(within(aside()).getByRole('button', { name: 'WEB-50 ab heute einplanen' }));
    expect(announced()).toBe('WEB-50 eingeplant: 28.10.2026 bis 10.11.2026.');
    await waitFor(() => expect(stored('wi_web_50')).toMatchObject({ start_date: '2026-10-28', due_date: '2026-11-10' }));
    expect(PLANNED_DAYS).toBe(14);
    expect(await within(screen.getByRole('region', { name: 'Website-Relaunch' })).findByRole('group', { name: /^WEB-50 / })).toBeTruthy();
    await waitFor(() => expect(within(aside()).getByText('Alle Epics dieser Liste stehen auf der Zeitachse.')).toBeTruthy());
  });

  it('plans the epic under the cursor with ⇧→ and takes the focus to its new row', async () => {
    renderTimeline();
    await findRow('WEB-30');
    act(() => card('WEB-50').focus());

    // ⌥→ has nothing to lengthen yet
    press('ArrowRight', { altKey: true });
    expect(announced()).toBe('WEB-50 hat noch keine Daten. Umschalt mit Pfeil rechts plant es ab heute ein.');

    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(row('WEB-50')));
    await waitFor(() => expect(stored('wi_web_50')).toMatchObject({ start_date: '2026-10-28', due_date: '2026-11-10' }));
  });

  it('keeps the dates of a viewer and says why', async () => {
    board.roles = { WEB: 'viewer', APP: 'admin' };
    renderTimeline();
    await focusRow('WEB-30');
    await waitFor(() => expect(within(aside()).getByRole('button', { name: 'WEB-50 ab heute einplanen' }).getAttribute('aria-disabled')).toBe('true'));

    press('ArrowRight', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'WEB-30 nicht geändert', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.' });
    // the palette offers no move that would be refused
    expect(listCommands().find((command) => command.id === 'timeline.list.move_right')!.when!()).toBe(false);
    // a drag moves nothing; let go, it opens the preview
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    pointerMove({ clientX: 600 });
    pointerUp({ clientX: 600 });
    expect(useUiStore.getState().peekItemId).toBe('wi_web_30');
    // nor does the card of "Ohne Datum" leave its place
    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300 });
    pointerMove({ clientX: 600, clientY: 300 });
    pointerUp({ clientX: 600, clientY: 300 });
    expect(document.querySelector('.fixed.z-40')).toBeNull();
    // planning by key says why as well
    act(() => card('WEB-50').focus());
    press('ArrowRight', { shiftKey: true });
    expect(lastToast()).toMatchObject({ title: 'WEB-50 nicht geändert' });

    expect(patches('wi_web_30')).toEqual([]);
    expect(stored('wi_web_30').start_date).toBe('2026-10-01');
  });

  it('explains an empty timeline: only epics stand on it', async () => {
    board.items = [task];
    renderTimeline('/projects/WEB?layout=timeline');
    expect(await screen.findByText('Keine Epics in dieser Liste')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Neues Epic' }));
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: { project_id: 'p_web', type_id: 't_epic' } });
  });

  it('offers to reset the filter on an empty timeline', async () => {
    const filter = encodeURIComponent(JSON.stringify([{ field: 'type', op: 'is', value: 't_task' }]));
    renderTimeline(`/projects/WEB?layout=timeline&filter=${filter}`);
    expect(await screen.findByText('Kein Epic passt zum Filter')).toBeTruthy();
    expect(screen.getByText('Ändere die Bedingungen oder setze den Filter zurück.')).toBeTruthy();
    expect(screen.queryByText('Keine Epics in dieser Liste')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    // back to the filter of the project: its epics stand on the timeline again
    await waitFor(() => expect(inertia.url).toBe('/projects/WEB?layout=timeline'));
    expect(await findRow('WEB-30')).toBeTruthy();
  });

  it('says where an epic of the list has no dates yet', async () => {
    board.items = [web50, task];
    renderTimeline();
    expect(await screen.findByText(/^Noch hat kein Epic dieser Liste ein Datum\./)).toBeTruthy();
    expect(card('WEB-50')).toBeTruthy();
  });

  it('shows the progress of the children', async () => {
    renderTimeline();
    const element = await findRow('WEB-30');
    expect(element.getAttribute('aria-label')).toBe('WEB-30 Relaunch Phase 1, 01.10.2026 bis 15.11.2026, 1 von 2 erledigt');
    expect(barOf('wi_web_30').querySelector<HTMLElement>('[data-progress]')!.style.width).toBe('50%');
    expect(element.textContent).toMatch(/50\s%/);
    // an epic without children has no fill
    expect(barOf('wi_app_5').querySelector('[data-progress]')).toBeNull();
  });

  it('draws today in the zone of the organisation', async () => {
    // neither Berlin nor UTC: 03:30 in UTC is still the day before in Los Angeles
    inZone({ timezone: 'America/Los_Angeles' });
    vi.setSystemTime(new Date('2026-10-29T03:30:00Z'));
    renderTimeline();
    await findRow('WEB-30');
    expect(document.querySelector('[data-today]')!.textContent).toBe('Heute 28.10.');
  });

  it('begins the weeks on the first weekday of the organisation', async () => {
    // not the Monday of the fixture: the axis begins on a Sunday
    inZone({ week_start: 0 });
    renderTimeline('/my-items?layout=timeline&zoom=week');
    await findRow('WEB-30');
    // a week before the earliest epic (Thursday 2026-09-24), from the Sunday of its week; from Monday it would be the 21st
    const days = [...document.querySelectorAll('[data-timeline-axis] span.tabular-nums')].map((day) => day.textContent);
    expect(days.slice(0, 2)).toEqual(['So 20', 'Mo 21']);
  });

  it('renders only the rows in view of 300 epics', async () => {
    board.items = Array.from({ length: 300 }, (_, index) =>
      web(index + 1, `Epic ${index + 1}`, 'std_backlog', epic({ start_date: '2026-10-01', due_date: '2026-10-14', rank: rankOf(index + 1) })),
    );
    renderTimeline();
    await findRow('WEB-1');
    // every page of the epics is loaded: the axis spans them all
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/query').map((body) => (body as { cursor?: string }).cursor)).toEqual(expect.arrayContaining(['100', '200'])));
    const rendered = () => document.querySelectorAll('[role="group"][data-nav-target]');
    expect(rendered().length).toBeGreaterThan(5);
    expect(rendered().length).toBeLessThan(40);
    expect(within(aside()).getByText('Alle Epics dieser Liste stehen auf der Zeitachse.')).toBeTruthy();

    // the row of the cursor stays while the box scrolls away from it
    await focusRow('WEB-1');
    act(() => {
      scroller().scrollTop = 32 + 300 * 44 - BOX.height;
      scroller().dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(row('WEB-300')).toBeTruthy());
    expect(row('WEB-1')).toBe(document.activeElement);
    expect(rendered().length).toBeLessThan(40);

    // j brings the next row into view: the box goes back up to it, and a row below its edge scrolls into it
    rowTop = BOX.top + BOX.height + 20;
    const before = scroller().scrollTop;
    press('j');
    await waitFor(() => expect(document.activeElement).toBe(row('WEB-2')));
    expect(scroller().scrollTop).toBeLessThan(before);
    expect(scroller().scrollTop).toBeGreaterThan(0);
  });
});

describe('"Ohne Datum" with many epics', () => {
  const unplannedList = () => document.querySelector<HTMLElement>('[data-unplanned-list]')!;
  const cards = () => within(aside()).queryAllByRole('article');

  it('renders only the visible undated epics (T21-M8)', async () => {
    board.items = Array.from({ length: 500 }, (_, index) => web(index + 1, `Ohne Datum ${index + 1}`, 'std_backlog', epic({ rank: rankOf(index + 1) })));
    renderTimeline();
    await waitFor(() => expect(within(aside()).getByText('500')).toBeTruthy(), { timeout: 5000 });
    // 400 px of 120 px each, and a few around them: never the 500
    await waitFor(() => expect(cards().length).toBeGreaterThan(2));
    expect(cards().length).toBeLessThan(15);
    expect(card('WEB-1')).toBeTruthy();

    // the card of the cursor stays while the list scrolls away from it
    act(() => card('WEB-1').focus());
    act(() => {
      unplannedList().scrollTop = 500 * UNPLANNED.entry - UNPLANNED.height;
      unplannedList().dispatchEvent(new Event('scroll'));
    });
    // (the cards not measured yet count 140 px: the window stands somewhere past the 400th)
    await waitFor(() => expect(within(aside()).queryByRole('article', { name: /^WEB-2 / })).toBeNull());
    expect(cards().some((element) => Number(/^WEB-(\d+) /.exec(element.getAttribute('aria-label')!)![1]) > 400)).toBe(true);
    expect(document.activeElement).toBe(card('WEB-1'));
    expect(cards().length).toBeLessThan(15);

    // j goes to the next card, which is out of view: the list scrolls back to it
    press('j');
    await waitFor(() => expect(document.activeElement).toBe(card('WEB-2')));
    expect(unplannedList().scrollTop).toBeLessThanOrEqual(2 * UNPLANNED.entry);
    expect(cards().length).toBeLessThan(15);
  });
});

describe('the keys and the palette', () => {
  it('takes the focus from the row of the list to the epic of the cursor with 4', async () => {
    renderTimeline('/my-items');
    const listRow = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-row-id="wi_web_30"]');
      expect(element).toBeTruthy();
      return element!;
    });
    act(() => listRow.focus());
    // the epics by project take a moment
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const answering = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/groups') && typeof init?.body === 'string' && (JSON.parse(init.body) as { group_by?: string }).group_by === 'project') await gate;
      return answering(input, init);
    };

    press('4');
    expect(inertia.url).toBe('/my-items?layout=timeline');
    // the timeline comes as a chunk of its own; the rows of the list before do not stand on it meanwhile
    await waitFor(() => expect(document.querySelector('[data-skeleton="timeline"]')).toBeTruthy());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelector('[data-skeleton="timeline"]')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /^WEB-30 / })).toBeNull();

    // then the focus is on the epic of the cursor
    await act(async () => release());
    await waitFor(() => expect(document.activeElement).toBe(row('WEB-30')));
  });

  it('offers the moves in the palette, named by the unit of the zoom, and in the help', async () => {
    renderTimeline();
    await focusRow('WEB-30');
    const command = (id: string) => listCommands().find((entry) => entry.id === id)!;
    await waitFor(() => expect(command('timeline.list.move_right').label).toBe('Epic eine Woche später'));
    expect(['timeline.list.move_left', 'timeline.list.shorter', 'timeline.list.longer'].map((id) => command(id).label)).toEqual([
      'Epic eine Woche früher',
      'Epic eine Woche kürzer',
      'Epic eine Woche länger',
    ]);
    expect(command('timeline.list.longer').when!()).toBe(true);
    act(() => command('timeline.list.longer').run());
    expect(announced()).toBe('WEB-30: 01.10.2026 bis 22.11.2026');
    // the help names each key once
    expect(listShortcuts().filter((entry) => entry.keys === 'alt+left')).toHaveLength(1);

    // an epic without dates can only be planned
    act(() => card('WEB-50').focus());
    expect(command('timeline.list.move_right').when!()).toBe(true);
    expect(command('timeline.list.longer').when!()).toBe(false);
  });

  it('opens an epic with Enter, previews it from its title and selects a range with ⇧ and a click', async () => {
    renderTimeline();
    const element = await focusRow('WEB-30');
    act(() => void fireEvent.keyDown(element, { key: 'Enter' }));
    expect(inertia.visit).toHaveBeenCalledWith('/items/WEB-30');

    fireEvent.click(within(row('APP-5')).getByRole('link'));
    expect(useUiStore.getState().peekItemId).toBe('wi_app_5');
    fireEvent.click(within(row('WEB-30')).getByRole('link'));
    press('x');
    fireEvent.click(within(row('APP-5')).getByRole('link'), { shiftKey: true });
    expect(useUiStore.getState().selection).toEqual(expect.arrayContaining(['wi_app_5', 'wi_web_30']));
    expect(row('APP-5').getAttribute('aria-label')).toMatch(/, ausgewählt$/);
  });
});

describe('dragging', () => {
  it('moves a bar by dragging it and saves both dates', async () => {
    renderTimeline();
    await findRow('WEB-30');
    await editable('wi_web_30');
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    // the row becomes the cursor
    expect(document.activeElement).toBe(row('WEB-30'));
    // a few pixels are no drag yet
    pointerMove({ clientX: 502 });
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/01\.10\.2026 bis 15\.11\.2026/);
    // seven days at 12 px a day
    pointerMove({ clientX: 584 });
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/08\.10\.2026 bis 22\.11\.2026/);
    expect(barOf('wi_web_30').className).toContain('cursor-grabbing');
    pointerUp({ clientX: 584 });
    await waitFor(() => expect(patches('wi_web_30')).toEqual([{ start_date: '2026-10-08', due_date: '2026-11-22' }]));
  });

  it('puts the bar back when the server refuses the dates (T21-M6)', async () => {
    board.refuseDates = true;
    renderTimeline();
    await findRow('WEB-30');
    await editable('wi_web_30');
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    pointerMove({ clientX: 584 });
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/08\.10\.2026 bis 22\.11\.2026/);
    pointerUp({ clientX: 584 });
    await waitFor(() => expect(patches('wi_web_30')).toHaveLength(1));
    // the saved dates show again, nothing was stored, and the toast says the refusal
    await waitFor(() => expect(row('WEB-30').getAttribute('aria-label')).toMatch(/01\.10\.2026 bis 15\.11\.2026/));
    expect(stored('wi_web_30')).toMatchObject({ start_date: '2026-10-01', due_date: '2026-11-15' });
    await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error' }));
    expect(lastToast()?.title).toBe('Änderung nicht gespeichert');
  });

  it('keeps the dates of a drag that follows a key before the keys rest', async () => {
    renderTimeline();
    await focusRow('WEB-30');
    await editable('wi_web_30');
    press('ArrowRight', { shiftKey: true });
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/08\.10\.2026 bis 22\.11\.2026/);
    // within the delay of the key, a drag by seven more days
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    pointerMove({ clientX: 584 });
    pointerUp({ clientX: 584 });
    await waitFor(() => expect(patches('wi_web_30')).toEqual([{ start_date: '2026-10-15', due_date: '2026-11-29' }]));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY + 100));
    });
    // the key's timer does not save its older dates over the drag's
    expect(patches('wi_web_30')).toEqual([{ start_date: '2026-10-15', due_date: '2026-11-29' }]);
    expect(stored('wi_web_30')).toMatchObject({ start_date: '2026-10-15', due_date: '2026-11-29' });
  });

  it('changes the due date at its end and the start at its start, never past each other', async () => {
    renderTimeline();
    await findRow('WEB-30');
    await editable('wi_web_30');
    pointerDown(barOf('wi_web_30').querySelector('[data-edge="due"]')!, { clientX: 900 });
    pointerMove({ clientX: 876 });
    pointerUp({ clientX: 876 });
    await waitFor(() => expect(patches('wi_web_30')).toEqual([{ start_date: '2026-10-01', due_date: '2026-11-13' }]));

    await waitFor(() => expect(stored('wi_web_30').due_date).toBe('2026-11-13'));
    pointerDown(barOf('wi_web_30').querySelector('[data-edge="start"]')!, { clientX: 300 });
    pointerMove({ clientX: 3000 });
    pointerUp({ clientX: 3000 });
    await waitFor(() => expect(patches('wi_web_30').at(-1)).toEqual({ start_date: '2026-11-13', due_date: '2026-11-13' }));

    await waitFor(() => expect(stored('wi_web_30').start_date).toBe('2026-11-13'));
    pointerDown(barOf('wi_web_30').querySelector('[data-edge="due"]')!, { clientX: 900 });
    pointerMove({ clientX: 0 });
    pointerUp({ clientX: 0 });
    // the due date stops at the start: nothing changed
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(patches('wi_web_30')).toHaveLength(2);
  });

  it('opens the preview with a click or a tap on a bar', async () => {
    renderTimeline();
    await findRow('APP-5');
    pointerDown(barOf('wi_app_5'), { clientX: 500 });
    pointerUp({ clientX: 500 });
    expect(useUiStore.getState().peekItemId).toBe('wi_app_5');
    // a click after a mouse press is the press's: nothing more
    act(() => useUiStore.getState().openPeek(null));
    fireEvent.click(barOf('wi_app_5'));
    expect(useUiStore.getState().peekItemId).toBeNull();

    // touch scrolls the axis: a tap is a click on the bar
    pointerDown(barOf('wi_web_30'), { clientX: 500, pointerType: 'touch' });
    fireEvent.click(barOf('wi_web_30'));
    expect(useUiStore.getState().peekItemId).toBe('wi_web_30');
    // another button than the main one does nothing
    pointerDown(barOf('wi_web_30'), { clientX: 500, button: 2 });
    pointerMove({ clientX: 700 });
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/01\.10\.2026 bis 15\.11\.2026/);
  });

  it('cancels a drag with Escape and keeps the dates', async () => {
    renderTimeline();
    await focusRow('WEB-30');
    press('x');
    expect(useUiStore.getState().selection).toEqual(['wi_web_30']);
    await editable('wi_web_30');

    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    pointerMove({ clientX: 584 });
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/08\.10\.2026 bis 22\.11\.2026/);
    press('Escape');
    // the saved dates again, the selection stays, the status line says it
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/01\.10\.2026 bis 15\.11\.2026/);
    expect(useUiStore.getState().selection).toEqual(['wi_web_30']);
    expect(announced()).toBe('WEB-30: Ziehen abgebrochen, die Daten bleiben.');
    // the pointer that comes up afterwards does nothing
    pointerMove({ clientX: 700 });
    pointerUp({ clientX: 700 });
    expect(patches('wi_web_30')).toEqual([]);
    expect(useUiStore.getState().peekItemId).toBeNull();

    // Escape before the bar moved is the list's: it clears the selection
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    press('Escape');
    expect(useUiStore.getState().selection).toEqual([]);
    pointerUp({ clientX: 500 });
  });

  it('gives the dates back when the browser cancels a drag', async () => {
    renderTimeline();
    await findRow('WEB-30');
    await editable('wi_web_30');
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    pointerMove({ clientX: 584 });
    act(() => void fireEvent.pointerCancel(window, { pointerId: 1 }));
    expect(row('WEB-30').getAttribute('aria-label')).toMatch(/01\.10\.2026 bis 15\.11\.2026/);
    // a press that the browser cancels before it moved changes nothing either
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    act(() => void fireEvent.pointerCancel(window, { pointerId: 1 }));
    expect(patches('wi_web_30')).toEqual([]);
  });

  it('plans an epic dragged from "Ohne Datum" onto the day under the pointer', async () => {
    renderTimeline();
    await findRow('WEB-30');
    await waitFor(() => expect(card('WEB-50').parentElement!.className).toContain('cursor-grab'));
    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300 });
    pointerMove({ clientX: 1102, clientY: 301 });
    expect(document.querySelector('.fixed.z-40')).toBeNull();
    // 464 px into the axis at 12 px a day: 38 days after 2026-09-01
    pointerMove({ clientX: LABEL + 464, clientY: 300 });
    expect(document.querySelector('.fixed.z-40')).toBeTruthy();
    expect(document.querySelector('[data-timeline-axis]')!.textContent).toContain('ab 09.10.');
    pointerUp({ clientX: LABEL + 464, clientY: 300 });
    await waitFor(() => expect(stored('wi_web_50')).toMatchObject({ start_date: '2026-10-09', due_date: '2026-10-22' }));
    expect(document.querySelector('.fixed.z-40')).toBeNull();
  });

  it('lets a card from "Ohne Datum" spring back where it was let go off the axis, or on Escape', async () => {
    renderTimeline();
    await findRow('WEB-30');
    await waitFor(() => expect(card('WEB-50').parentElement!.className).toContain('cursor-grab'));
    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300 });
    pointerMove({ clientX: 1100, clientY: 600 });
    // below the box: no day
    expect(document.querySelector('[data-timeline-axis]')!.textContent).not.toContain('ab ');
    pointerUp({ clientX: 1100, clientY: 600 });
    expect(announced()).toBe('WEB-50 bleibt ohne Datum.');
    expect(document.querySelector('.fixed.z-40')!.className).toContain('transition-transform');
    await waitFor(() => expect(document.querySelector('.fixed.z-40')).toBeNull());

    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300 });
    pointerMove({ clientX: LABEL + 464, clientY: 300 });
    press('Escape');
    await waitFor(() => expect(document.querySelector('.fixed.z-40')).toBeNull());
    pointerUp({ clientX: LABEL + 464, clientY: 300 });
    expect(stored('wi_web_50').start_date).toBeNull();

    // a drag the browser cancels goes back as well
    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300 });
    pointerMove({ clientX: LABEL + 464, clientY: 300 });
    act(() => void fireEvent.pointerCancel(window, { pointerId: 1 }));
    await waitFor(() => expect(document.querySelector('.fixed.z-40')).toBeNull());

    // the browser's own drag of the title link would swallow the pointer
    expect(fireEvent.dragStart(card('WEB-50'))).toBe(false);

    // a press that never moved, a tap and Escape before the drag are nothing to plan
    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300 });
    press('Escape');
    pointerUp({ clientX: 1100, clientY: 300 });
    pointerDown(card('WEB-50'), { clientX: 1100, clientY: 300, pointerType: 'touch' });
    pointerMove({ clientX: LABEL + 464, clientY: 300 });
    expect(document.querySelector('.fixed.z-40')).toBeNull();
    expect(patches('wi_web_50')).toEqual([]);
  });

  it('ends a drag when the timeline goes', async () => {
    const view = renderTimeline();
    await findRow('WEB-30');
    await editable('wi_web_30');
    pointerDown(barOf('wi_web_30'), { clientX: 500 });
    pointerMove({ clientX: 584 });
    view.unmount();
    // the window hears nothing of it any more
    pointerUp({ clientX: 584 });
    expect(patches('wi_web_30')).toEqual([]);
  });
});

describe('where the timeline starts', () => {
  /** A stand-in for the browser's ResizeObserver (jsdom has none): the test says when an observed box changed size. */
  const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
  let measured = 0;

  beforeEach(() => {
    observers.length = 0;
    measured = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private entry: (typeof observers)[number];
        constructor(callback: ResizeObserverCallback) {
          this.entry = { callback, targets: [] };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.push(target);
        }
        unobserve() {}
        disconnect() {
          this.entry.targets = [];
        }
      },
    );
    const stubbed = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute('data-timeline-scroller')) measured += 1;
      return stubbed.call(this);
    };
    const top = BOX.top;
    onTestFinished(() => {
      Element.prototype.getBoundingClientRect = stubbed;
      BOX.top = top;
      vi.unstubAllGlobals();
    });
  });

  it('reads where its box starts not on every render (T21-M9)', async () => {
    renderTimeline();
    await focusRow('WEB-30');
    // the count sees the box: the timeline read it when it laid out
    expect(measured).toBeGreaterThan(0);

    // the selection changes: a render with the same rows reads no box
    measured = 0;
    press('x');
    await waitFor(() => expect(useUiStore.getState().selection).toEqual([web30.id]));
    expect(measured).toBe(0);

    // and a page that changes size is read again
    act(() => observers.filter((entry) => entry.targets.includes(document.body)).forEach((entry) => entry.callback([], {} as ResizeObserver)));
    expect(measured).toBeGreaterThan(0);
  });

  it('fills the window below a bar above it that grows', async () => {
    renderTimeline();
    await findRow('WEB-30');
    expect(scroller().style.maxHeight).toContain(`- ${BOX.top}px`);

    // the bulk bar pushes the box down: the page grows, the box keeps to the window
    BOX.top += 40;
    act(() => observers.filter((entry) => entry.targets.includes(document.body)).forEach((entry) => entry.callback([], {} as ResizeObserver)));
    expect(scroller().style.maxHeight).toContain(`- ${BOX.top}px`);
  });
});
