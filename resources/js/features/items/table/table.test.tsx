/*
 * The table layout against groups built by hand, as the list's tests do (K18): each group's `enable`, `loadMore` and
 * `retry` are spies. The catalogs the cells read and the changes they send go to a fake REST API (`mockApi`). jsdom lays
 * nothing out: the scroll box reports a height (`clientHeight`), every row one (`offsetHeight`), and `scrollTo` on the
 * box moves its offset and fires `scroll`, as a browser does.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { editReasonOf } from '@/components/fields/itemData';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { cachedZone } from '@/domain/tz';
import { mockApi, type MockApi } from '@/test/api';
import { ida, labels, lene, list, makeWorkItem, mara, organization, person, project, properties as catalog, standard, types as typeCatalog } from '@/test/fixtures';
import { useUiStore } from '@/store/ui';
import type { Display, ListedItem, Organization, Property, ProjectRole, WorkItemType } from '@/types';
import type { GroupData, LayoutProps } from '../layouts';
import { tableColumns, typeHasProperty, typePropertyOf } from './columns';
import { useRefusals } from './cells/PropertyCells';
import { TableLayout } from './TableLayout';
import { cellOf } from './useGridKeys';

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

const ROW = 41;
const BOX = 410;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;
const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!;
const scrollTo = Element.prototype.scrollTo;

/** Scrolls the box of the table as a browser does: the offset changes, then `scroll` fires. */
function scrollBox(top: number) {
  const box = document.querySelector<HTMLElement>('[data-table-scroller]')!;
  act(() => {
    box.scrollTop = Math.max(0, top);
    box.dispatchEvent(new Event('scroll'));
  });
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-index') ? ROW : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute('data-table-scroller') ? BOX : 0;
    },
  });
  // the box is as tall as its rows (the virtualizer scrolls no further)
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute('data-table-scroller') ? 1_000_000 : 0;
    },
  });
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop;
    this.dispatchEvent(new Event('scroll'));
  } as typeof Element.prototype.scrollTo;
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  Object.defineProperty(Element.prototype, 'clientHeight', clientHeight);
  Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight);
  Element.prototype.scrollTo = scrollTo;
});

/* --------------------------------------------------------------------- catalogs */

const prop = (id: string, key: string, label: string, field_type: Property['field_type'], changes: Partial<Property> = {}): Property => ({
  id,
  key,
  label,
  field_type,
  help: '',
  default_value: null,
  settings: {},
  options: [],
  ...changes,
});

const customer = catalog.find((entry) => entry.key === 'customer')!;
const effort = catalog.find((entry) => entry.key === 'effort')!;
const tags = prop('pr_tags', 'tags', 'Tags', 'dropdown', {
  settings: { multiple: true },
  options: [
    { id: 'opt_a', label: 'Alpha', color: 'sky', position: 1, archived_at: null },
    { id: 'opt_b', label: 'Beta', color: 'moss', position: 0, archived_at: null },
    { id: 'opt_old', label: 'Alt', color: 'slate', position: 2, archived_at: '2026-09-01T00:00:00Z' },
  ],
});
const owner = prop('pr_owner', 'owner', 'Verantwortlich', 'member');
const reviewers = prop('pr_reviewers', 'reviewers', 'Review', 'member', { settings: { multiple: true } });
const release = prop('pr_release', 'release', 'Release', 'date');
const signed = prop('pr_signed', 'signed', 'Abgenommen', 'boolean');
const note = prop('pr_note', 'note', 'Notiz', 'text');
const site = prop('pr_site', 'site', 'Seite', 'url');
const brief = prop('pr_brief', 'brief', 'Briefing', 'rich_text');
const properties = [...catalog, tags, owner, reviewers, release, signed, note, site, brief];

const taskProperties = [customer, effort, tags, owner, reviewers, release, signed, note, site, brief];
const types: WorkItemType[] = typeCatalog.map((type) =>
  type.id === 't_task' ? { ...type, properties: taskProperties.map((entry, position) => ({ property_id: entry.id, required: entry.key === 'note', position })) } : type,
);

/** Someone who once was in the project: no member, no admin. */
const tom = person('u_tom', 'Tom Weber', 'tom');

let api: MockApi | undefined;
let role: ProjectRole = 'admin';
/** What the server answers to a PATCH of an item: the item as it is (the tests look at what was sent). */
let patchAnswer: (body: unknown) => { status?: number; body?: unknown } = () => ({ body: { data: makeWorkItem() } });

beforeEach(() => {
  page.organization = organization;
  role = 'admin';
  patchAnswer = () => ({ body: { data: makeWorkItem() } });
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list([project('WEB', role)]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene, tom]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/resolutions': () => ({ body: list([]) }),
    'GET /api/v1/projects/p_web/members': () => ({
      body: list([
        { project_id: 'p_web', user_id: 'u_ida', role: 'member' },
        { project_id: 'p_web', user_id: 'u_lene', role: 'member' },
      ]),
    }),
    'PATCH /api/v1/work-items/wi_1': (body) => patchAnswer(body),
    'POST /api/v1/work-items/wi_1/transition': () => ({ body: { data: makeWorkItem({ state_id: 'std_progress' }) } }),
  });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  resetToasts();
  useUiStore.setState({ peekItemId: null, flashIds: [] });
});

/* ------------------------------------------------------------------------ harness */

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

const web1 = makeWorkItem({ id: 'wi_1', key: 'WEB-1', title: 'Kontaktformular', values: { effort: 3, customer: 'opt_nordlicht' }, start_date: '2026-11-02' });
const web2 = makeWorkItem({ id: 'wi_2', key: 'WEB-2', number: 2, title: 'Relaunch', type_id: 't_epic' });
const web3 = makeWorkItem({ id: 'wi_3', key: 'WEB-3', number: 3, title: 'Logo', state_id: 'std_progress' });

const baseDisplay: Display = { layout: 'table', group_by: 'none', sort: { field: 'rank', direction: 'asc' }, fields: ['key', 'state', 'priority', 'property:effort'], show_sub_items: true };

type Props = Partial<Omit<LayoutProps, 'groups' | 'display'>> & { groups: GroupData[]; display?: Partial<Display> };

function Harness({ groups, groupBy = 'none', display, ...rest }: Props) {
  const [cursorId, setCursor] = useState<string | null>(rest.cursorId ?? null);
  const [selection, setSelection] = useState<string[]>(rest.selection ?? []);
  return (
    <>
      <span data-testid="cursor">{cursorId ?? ''}</span>
      <span data-testid="selection">{selection.join(' ')}</span>
      <button type="button">vorher</button>
      <TableLayout
        groups={groups}
        groupBy={groupBy}
        display={{ ...baseDisplay, ...display }}
        total={groups.reduce((sum, entry) => sum + entry.count, 0)}
        selection={selection}
        onSelect={setSelection}
        onOpen={rest.onOpen ?? vi.fn()}
        onPeek={rest.onPeek ?? vi.fn()}
        cursorId={cursorId}
        onCursor={setCursor}
        {...(rest.onSelectAll && { onSelectAll: rest.onSelectAll })}
      />
      <button type="button">danach</button>
    </>
  );
}

function renderTable(props: Props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

/** The cell of an item in a column (its first row, when it has two). */
const cell = (id: string, column: number) => document.querySelector<HTMLElement>(`[data-item-id="${id}"][data-column="${column}"]`);
const cursor = () => screen.getByTestId('cursor').textContent;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const toastTexts = () => currentToasts().map((entry) => [entry.title, 'description' in entry ? entry.description : undefined]);
const patches = () => api!.calls.filter((call) => call.method === 'PATCH').map((call) => call.body);

/** Focuses a cell once the catalogs have arrived (the cells read them). */
async function focusCell(id: string, column: number, label?: string) {
  if (label) await waitFor(() => expect(cell(id, column)!.querySelector(`[aria-label^="${label}"]`)).toBeTruthy());
  await waitFor(() => expect(cell(id, column)).toBeTruthy());
  act(() => cell(id, column)!.focus());
}

/** Waits until the rights have come: before, every cell is read-only and says they are still loading. */
const rightsLoaded = () =>
  waitFor(() => {
    expect(document.querySelector('[data-cell]')).toBeTruthy();
    expect(document.querySelector('[data-cell] [aria-disabled="true"]')).toBeNull();
  });

/**
 * A pointer presses in a cell and the focus lands on `target` meanwhile. The table forgets the press in the task after
 * it (`setTimeout` 0): the fake timer runs that task at once, so the next focus is one without a pointer (20a-M3).
 */
function pointAt(inCell: HTMLElement, target: HTMLElement) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    fireEvent.pointerDown(inCell);
    act(() => target.focus());
    const kept = document.activeElement;
    act(() => vi.runOnlyPendingTimers());
    // the timers ran no focus of their own
    expect(document.activeElement).toBe(kept);
  } finally {
    vi.useRealTimers();
  }
}

/** Two frames: Base UI opens a popup and sets its focus a frame after the render that asks for it. */
const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Waits for the search field of an open picker to have the focus (Base UI sets it a frame later). */
async function searchField(placeholder: string) {
  const field = await screen.findByPlaceholderText(placeholder);
  await waitFor(() => expect(document.activeElement).toBe(field));
  return field;
}

/* -------------------------------------------------------------------------- tests */

describe('columns of the table', () => {
  it('makes a column of every field of the display but the key and the title, and none of a property that is gone', () => {
    const columns = tableColumns(['key', 'title', 'state', 'project', 'property:effort', 'property:gone', 'nothing'], properties);
    expect(columns.map((entry) => [entry.field, entry.label, entry.width, entry.readOnly, entry.numeric])).toEqual([
      ['state', 'Status', 10, null, false],
      ['project', 'Projekt', 8, 'items.table.read_only.project', false],
      ['property:effort', 'Aufwand (h)', 7.5, null, true],
    ]);
    expect(typeHasProperty(types, web1, effort)).toBe(true);
    expect(typeHasProperty(types, web2, effort)).toBe(false);
    expect(typeHasProperty(undefined, web1, effort)).toBe(false);
    expect(cellOf(null)).toBeNull();
    expect(cellOf(document.createElement('td'))).toBeNull();
  });

  it('shares the helpers of the cells: the assignment of a property and why an item does not change (T20-M2)', () => {
    expect(typePropertyOf(types, web1, note)).toEqual({ property_id: 'pr_note', required: true, position: 7 });
    expect(typePropertyOf(types, web2, note)).toBeUndefined();
    expect(typePropertyOf(undefined, web1, note)).toBeUndefined();

    const reason = vi.fn(() => 'Keine Rechte.');
    expect(editReasonOf(web1, reason)).toBe('Keine Rechte.');
    expect(reason).toHaveBeenCalledWith('item.edit', web1.project_id);
    const archived = makeWorkItem({ key: 'WEB-9', archived_at: '2026-10-20T08:00:00Z' });
    expect(editReasonOf(archived, reason)).toBe('WEB-9 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.');
    expect(reason).toHaveBeenCalledTimes(1);
  });
});

describe('TableLayout', () => {
  it('shows the chosen columns, properties included, with a fixed header and first column', async () => {
    renderTable({ groups: [group('all', [web1, web2])], display: { fields: ['key', 'state', 'priority', 'property:effort', 'property:gone', 'project', 'created_at', 'updated_at'] } });

    const grid = screen.getByRole('grid', { name: 'Items' });
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Item', 'Status', 'Priorität', 'Aufwand (h)', 'Projekt', 'Erstellt', 'Geändert']));
    const headers = within(grid).getAllByRole('columnheader');
    expect(grid.getAttribute('aria-colcount')).toBe('7');
    // the header stays on top, the first column at the left
    for (const header of headers) expect(header.className).toMatch(/\bsticky\b.*\btop-0\b/);
    expect(headers[0]!.className).toMatch(/\bleft-0\b/);
    expect(cell('wi_1', 0)!.className).toMatch(/\bsticky\b.*\bleft-0\b/);
    expect(within(cell('wi_1', 0)!).getByText('WEB-1')).toBeTruthy();
    expect(within(cell('wi_1', 0)!).getByText('Kontaktformular')).toBeTruthy();
    // the values: a number on the right, the project, the days in the zone of the organisation
    await waitFor(() => expect(cell('wi_1', 3)!.textContent).toBe('3'));
    expect(cell('wi_1', 3)!.className).toMatch(/text-right/);
    await waitFor(() => expect(cell('wi_1', 4)!.textContent).toMatch(/WEB$/));
    expect(cell('wi_1', 5)!.textContent).toBe('01.10.2026');
    // only one cell is the tab stop
    expect(document.querySelectorAll('[data-cell][tabindex="0"]')).toHaveLength(1);
    expect(cell('wi_1', 0)!.tabIndex).toBe(0);
  });

  it('moves through the cells with the arrow keys and edits the state with Enter', async () => {
    const user = userEvent.setup();
    renderTable({ groups: [group('all', [web1, web2, web3])] });
    await focusCell('wi_1', 0);

    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 1)));
    expect(cursor()).toBe('wi_1');
    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_2', 1)));
    expect(cursor()).toBe('wi_2');
    // the tab stop follows the cursor
    expect(cell('wi_2', 1)!.tabIndex).toBe(0);
    expect(cell('wi_1', 0)!.tabIndex).toBe(-1);
    press('ArrowUp');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 1)));
    // j and k too
    press('j');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_2', 1)));
    press('k');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 1)));
    // at the edges it stays
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 0)));
    press('ArrowLeft');
    expect(document.activeElement).toBe(cell('wi_1', 0));
    press('End');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 3)));
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 3)));
    press('Home');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 0)));
    press('End', { ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_3', 0)));
    press('Home', { metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 0)));
    // other combinations are not the grid's
    press('ArrowRight', { metaKey: true });
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { altKey: true });
    expect(document.activeElement).toBe(cell('wi_1', 0));

    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 1)));
    press('Enter');
    await searchField('Status suchen …');
    await user.keyboard('In Prog');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(api!.calls.find((call) => call.url === '/api/v1/work-items/wi_1/transition')?.body).toEqual({ to_state_id: 'std_progress', resolution_id: null }));
    // the picker gave the focus back: the cell has it
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 1)));
  });

  it('leaves an editor with Escape and stays in the cell', async () => {
    const user = userEvent.setup();
    renderTable({ groups: [group('all', [web1])] });
    await focusCell('wi_1', 2);
    press('Enter');
    await searchField('Priorität suchen …');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByPlaceholderText('Priorität suchen …')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 2)));
    expect(patches()).toEqual([]);
    // the arrows go on from the cell
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 1)));
  });

  it('saves a number property from its cell and shows the error of the server at it', async () => {
    const user = userEvent.setup();
    patchAnswer = () => ({ status: 422, body: { status: 422, reason: 'validation_failed', errors: { 'values.effort': ['Höchstens 100 Stunden.'] } } });
    renderTable({ groups: [group('all', [web1])] });
    await focusCell('wi_1', 3, 'Aufwand (h)');
    press('Enter');
    const field = await screen.findByRole('textbox', { name: 'Aufwand (h)' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    // the keys come as keys, Escape says what each press does
    const hint = document.getElementById(field.getAttribute('aria-describedby')!)!;
    expect(within(hint).getByRole('img', { name: 'Eingabe' })).toBeTruthy();
    // the key Enter is a picture without text (Kbd), so the sentence starts with its space: untrimmed on purpose, the
    // space belongs between the key and the words (20a-M6)
    expect(hint.textContent).toBe(' speichert. Esc nimmt das Getippte zurück, ein zweites schließt.');
    await user.clear(field);
    await user.keyboard('120,5{Enter}');
    await waitFor(() => expect(patches()).toEqual([{ values: { effort: 120.5 } }]));
    // the editor closed, the cell has the focus and the words of the server
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 3)));
    await waitFor(() => expect(within(cell('wi_1', 3)!).getByText('Höchstens 100 Stunden.')).toBeTruthy());
    expect(cell('wi_1', 3)!.querySelector('[aria-invalid="true"]')).toBeTruthy();
    // opened again, the field says it too
    press('Enter');
    const again = await screen.findByRole('textbox', { name: 'Aufwand (h)' });
    expect(again.getAttribute('aria-invalid')).toBe('true');
    // the value it has goes out no more; another one clears the words when it goes
    patchAnswer = () => ({ body: { data: web1 } });
    await waitFor(() => expect(document.activeElement).toBe(again));
    await user.clear(again);
    await user.keyboard('3{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 3)));
    expect(patches()).toHaveLength(1);
    press('Enter');
    const third = await screen.findByRole('textbox', { name: 'Aufwand (h)' });
    await waitFor(() => expect(document.activeElement).toBe(third));
    await user.clear(third);
    await user.keyboard('4{Enter}');
    await waitFor(() => expect(within(cell('wi_1', 3)!).queryByText('Höchstens 100 Stunden.')).toBeNull());
    expect(patches()).toEqual([{ values: { effort: 120.5 } }, { values: { effort: 4 } }]);
  });

  it('says that a cell does not exist for the type of the item', async () => {
    renderTable({ groups: [group('all', [web1, web2])] });
    await waitFor(() => expect(within(cell('wi_2', 3)!).getByText('Gibt es für diesen Typ nicht')).toBeTruthy());
    await focusCell('wi_2', 3);
    press('Enter');
    expect(toastTexts()).toEqual([['Nicht änderbar', '„Aufwand (h)“ gibt es für den Typ „Epic“ nicht.']]);
    expect(document.activeElement).toBe(cell('wi_2', 3));
  });

  it('says why a read-only cell does not open', async () => {
    renderTable({ groups: [group('all', [web1])], display: { fields: ['project', 'created_at', 'updated_at'] } });
    await focusCell('wi_1', 1);
    press('Enter');
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 2)));
    press('Enter');
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 3)));
    press('Enter');
    expect(toastTexts()).toEqual([
      ['Nicht änderbar', 'Das Projekt eines Items lässt sich nicht ändern.'],
      ['Nicht änderbar', 'Wann ein Item angelegt wurde, lässt sich nicht ändern.'],
      ['Nicht änderbar', '„Geändert“ setzt werkbuch bei jeder Änderung selbst.'],
    ]);
  });

  it('says why a viewer and an archived item cannot change a cell, and shows the values read-only', async () => {
    role = 'viewer';
    const archived = makeWorkItem({ id: 'wi_9', key: 'WEB-9', number: 9, archived_at: '2026-10-20T08:00:00Z', values: { signed: true, note: 'Hallo' } });
    renderTable({ groups: [group('all', [web1, archived])], display: { fields: ['state', 'labels', 'property:signed', 'property:note'] } });
    await waitFor(() => expect(within(cell('wi_1', 1)!).getByRole('button', { name: /^Status: Todo/ }).getAttribute('aria-disabled')).toBe('true'));
    // without the right to add a label, an empty one is a dash
    expect(cell('wi_1', 2)!.textContent).toBe('—');
    expect(within(cell('wi_1', 3)!).getByRole('button', { name: 'Abgenommen: Nein' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(cell('wi_9', 3)!).getByRole('button', { name: 'Abgenommen: Ja' })).toBeTruthy();
    expect(within(cell('wi_9', 4)!).getByRole('button', { name: 'Notiz: Hallo' }).getAttribute('aria-disabled')).toBe('true');
    await focusCell('wi_1', 1);
    press('Enter');
    act(() => cell('wi_9', 1)!.focus());
    press('Enter');
    const [viewer, archive] = toastTexts();
    expect(viewer).toEqual(['Nicht änderbar', 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.']);
    expect(archive).toEqual(['Nicht änderbar', 'WEB-9 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.']);
  });

  it('closes an open editor for good when the rights go: when they come back, it stays closed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const show = (entry: ListedItem) => (
      <QueryClientProvider client={client}>
        <Harness groups={[group('all', [entry])]} display={{ fields: ['state', 'labels', 'start_date', 'property:note'] }} />
      </QueryClientProvider>
    );
    const archived = { ...web1, archived_at: '2026-10-20T08:00:00Z' };
    const view = render(show(web1));
    await rightsLoaded();
    // each editor: a picker, the labels (a dash without the right and without labels), the calendar, a typed property
    const editors: [number, string, () => HTMLElement | null][] = [
      [1, 'Status', () => screen.queryByPlaceholderText('Status suchen …')],
      [2, 'Labels', () => screen.queryByPlaceholderText('Label suchen …')],
      [3, 'Start', () => screen.queryByRole('grid', { name: /^Start/ })],
      [4, 'Notiz', () => screen.queryByRole('textbox', { name: 'Notiz' })],
    ];
    for (const [column, label, editor] of editors) {
      await focusCell('wi_1', column, label);
      press('Enter');
      await waitFor(() => expect(editor()).toBeTruthy());
      view.rerender(show(archived));
      await waitFor(() => expect(editor()).toBeNull());
      view.rerender(show(web1));
      await rightsLoaded();
      await act(nextFrames);
      expect([label, editor()]).toEqual([label, null]);
    }
  });

  it('keeps the group toggles out of the tab order', async () => {
    const enable = vi.fn();
    renderTable({ groups: [group('a', items('a', 2)), group('b', items('b', 2)), group('c', [], { status: 'idle', count: 3, enable })], groupBy: 'state' });
    const toggle = (key: string) => screen.getByRole('button', { name: new RegExp(`^Gruppe ${key}`) });
    for (const key of ['a', 'b', 'c']) expect(toggle(key).tabIndex).toBe(-1);
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // a group comes into view and loads; the rows of one that waits for its page are a placeholder
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));

    // ← on the first column goes to the heading of the row's group
    await focusCell('wi_b1', 0);
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(toggle('b')));
    press('ArrowUp');
    await waitFor(() => expect(document.activeElement).toBe(toggle('a')));
    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(toggle('b')));
    press('ArrowLeft');
    expect(toggle('b').getAttribute('aria-expanded')).toBe('false');
    expect(cell('wi_b1', 0)).toBeNull();
    // folded, its items are out of the order of the keys
    press('ArrowRight');
    expect(toggle('b').getAttribute('aria-expanded')).toBe('true');
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_b1', 0)));
    // keys with modifiers and other keys on a heading are not its own
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(toggle('b')));
    press('ArrowLeft', { shiftKey: true });
    press('x');
    expect(toggle('b').getAttribute('aria-expanded')).toBe('true');

    // with every group folded, the first heading is the tab stop
    fireEvent.click(toggle('a'));
    fireEvent.click(toggle('b'));
    fireEvent.click(toggle('c'));
    await waitFor(() => expect(toggle('a').tabIndex).toBe(0));
  });

  it('renders only the rows in view of 2 000 items', async () => {
    renderTable({ groups: [group('all', items('a', 2000))] });

    const rows = () => document.querySelectorAll('tbody tr[data-index]');
    expect(rows().length).toBeGreaterThan(5);
    expect(rows().length).toBeLessThan(100);
    expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('2001');
    expect(cell('wi_a1', 0)).toBeTruthy();

    scrollBox(1000 * ROW);
    await waitFor(() => expect(cell('wi_a1000', 0)).toBeTruthy());
    expect(cell('wi_a1', 0)).toBeNull();
    expect(rows().length).toBeLessThan(100);
  });

  it('keeps the cell of the cursor rendered while scrolling away, and brings a far row into view for the focus', async () => {
    renderTable({ groups: [group('all', items('a', 2000))] });
    await focusCell('wi_a1', 0);
    scrollBox(1000 * ROW);
    await waitFor(() => expect(cell('wi_a1000', 0)).toBeTruthy());
    expect(document.activeElement).toBe(cell('wi_a1', 0));

    press('End', { metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_a2000', 0)));
    // two steps before the first one landed: the second wins
    press('ArrowUp');
    press('ArrowUp');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_a1998', 0)));
  });

  it('keeps the height of the rows it does not render, also between the cursor row and the rows in view', async () => {
    renderTable({ groups: [group('all', items('a', 2000))] });
    await focusCell('wi_a1', 0);
    scrollBox(1000 * ROW);
    await waitFor(() => expect(cell('wi_a1000', 0)).toBeTruthy());
    expect(cell('wi_a1', 0)).toBeTruthy();
    // the rendered rows and the spacers between them make the whole height, so the box neither shrinks nor jumps
    const spacers = [...document.querySelectorAll<HTMLElement>('[data-spacer] td')].map((td) => Number.parseFloat(td.style.height));
    const rendered = document.querySelectorAll('tbody tr[data-index]').length;
    expect(spacers.length).toBe(2);
    expect(spacers.reduce((sum, height) => sum + height, 0) + rendered * ROW).toBe(2000 * ROW);
    // the gap after the cursor row is the rows between it and the first one in view
    const next = Number(cell('wi_a1', 0)!.closest('tr')!.nextElementSibling!.nextElementSibling!.getAttribute('data-index'));
    expect(spacers[0]).toBe((next - 1) * ROW);
  });

  it('addresses the row, not the item: an item with two labels has one editor open and stays in its row', async () => {
    const user = userEvent.setup();
    const twice = makeWorkItem({ id: 'wi_x', key: 'WEB-7', number: 7, title: 'Zweimal', label_ids: ['lb_ux', 'lb_forms'] });
    const other = makeWorkItem({ id: 'wi_y', key: 'WEB-8', number: 8, title: 'Einmal', label_ids: ['lb_ux'] });
    renderTable({ groups: [group('lb_ux', [twice, other]), group('lb_forms', [twice])], groupBy: 'label', display: { fields: ['key', 'state', 'priority'] } });
    await rightsLoaded();
    const rowCell = (group: string, id: string, column: number) => document.querySelector<HTMLElement>(`[data-cell="${group}:${id}:${column}"]`);
    expect(document.querySelectorAll('[data-item-id="wi_x"][data-column="0"]')).toHaveLength(2);

    // ↓ goes row by row: from the second row of the first group to the item's row in the second group
    act(() => rowCell('lb_ux', 'wi_y', 1)!.focus());
    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(rowCell('lb_forms', 'wi_x', 1)));
    expect(cursor()).toBe('wi_x');
    // → stays in that row
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(rowCell('lb_forms', 'wi_x', 2)));
    expect(rowCell('lb_forms', 'wi_x', 2)!.tabIndex).toBe(0);
    expect(rowCell('lb_ux', 'wi_x', 2)!.tabIndex).toBe(-1);
    // Enter opens the editor of this row only
    press('Enter');
    await searchField('Priorität suchen …');
    expect(screen.getAllByPlaceholderText('Priorität suchen …')).toHaveLength(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(rowCell('lb_forms', 'wi_x', 2)));
    // ↑ goes back row by row
    press('ArrowUp');
    await waitFor(() => expect(document.activeElement).toBe(rowCell('lb_ux', 'wi_y', 2)));
  });

  it('brings a heading out of view into view before it takes the focus', async () => {
    renderTable({ groups: [group('a', items('a', 5)), group('b', items('b', 300))], groupBy: 'state' });
    scrollBox(200 * ROW);
    await waitFor(() => expect(cell('wi_b200', 0)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Gruppe b/ })).toBeNull();
    act(() => cell('wi_b200', 0)!.focus());
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Gruppe b/ })));
  });

  it('stops looking for a heading that does not come into view, and keeps the focus where it was', async () => {
    renderTable({ groups: [group('a', items('a', 5)), group('b', items('b', 300))], groupBy: 'state' });
    scrollBox(200 * ROW);
    await waitFor(() => expect(cell('wi_b200', 0)).toBeTruthy());
    act(() => cell('wi_b200', 0)!.focus());
    // the box does not scroll (a browser that refuses it): the heading never renders
    const stuck = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {});
    press('ArrowLeft');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(document.activeElement).toBe(cell('wi_b200', 0));
    stuck.mockRestore();
  });

  it('shows the sort of the display in its column heading', async () => {
    const fields = ['key', 'state', 'priority', 'due_date'];
    const { rerender } = renderTable({ groups: [group('all', [web1])], display: { fields, sort: { field: 'priority', direction: 'desc' } } });
    const sortOf = () => screen.getAllByRole('columnheader').map((header) => [header.textContent, header.getAttribute('aria-sort')]);
    expect(sortOf()).toEqual([
      ['Item', null],
      ['Status', null],
      ['Priorität', 'descending'],
      ['Due-Date', null],
    ]);
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <Harness groups={[group('all', [web1])]} display={{ fields, sort: { field: 'key', direction: 'asc' } }} />
      </QueryClientProvider>,
    );
    expect(sortOf()[0]).toEqual(['Item', 'ascending']);
    rerender(
      <QueryClientProvider client={client}>
        <Harness groups={[group('all', [web1])]} display={{ fields, sort: { field: 'state_category', direction: 'asc' } }} />
      </QueryClientProvider>,
    );
    expect(sortOf()[1]).toEqual(['Status', 'ascending']);
  });

  it('opens with Enter on the first column, previews with space, and leaves the grid with Tab', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onPeek = vi.fn();
    renderTable({ groups: [group('all', [web1, web2])], onOpen, onPeek });
    await focusCell('wi_1', 0);
    press('Enter');
    expect(onOpen).toHaveBeenCalledWith('wi_1');
    press(' ');
    expect(onPeek).toHaveBeenCalledWith('wi_1');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'danach' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cell('wi_1', 0));
    // a click on the title is the preview
    fireEvent.click(within(cell('wi_2', 0)!).getByRole('link'));
    expect(onPeek).toHaveBeenLastCalledWith('wi_2');
  });

  it('selects with the checkbox, a range with ⇧, with ⇧ and a click on the title, with ⇧↓, and all from the heading', async () => {
    const onSelectAll = vi.fn();
    renderTable({ groups: [group('all', [web1, web2, web3])] });
    const box = (id: string) => within(cell(id, 0)!).getByRole('checkbox');
    fireEvent.click(box('wi_1'));
    expect(screen.getByTestId('selection').textContent).toBe('wi_1');
    fireEvent.click(box('wi_3'), { shiftKey: true });
    expect(screen.getByTestId('selection').textContent).toBe('wi_1 wi_2 wi_3');
    // the heading: all of them off, then on again
    const all = screen.getByRole('checkbox', { name: 'Alle Items auswählen' });
    expect(all.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(all);
    expect(screen.getByTestId('selection').textContent).toBe('');
    fireEvent.click(all);
    expect(screen.getByTestId('selection').textContent).toBe('wi_1 wi_2 wi_3');
    fireEvent.click(all);

    fireEvent.click(box('wi_2'));
    fireEvent.click(within(cell('wi_3', 0)!).getByRole('link'), { shiftKey: true });
    expect(screen.getByTestId('selection').textContent).toBe('wi_2 wi_3');

    // ⇧↓ in the grid extends the selection as ⇧J does
    await focusCell('wi_1', 0);
    press('Escape');
    press('ArrowDown', { shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_2', 0)));
    expect(screen.getByTestId('selection').textContent).toBe('wi_1 wi_2');
    press('ArrowDown', { ctrlKey: true });
    expect(document.activeElement).toBe(cell('wi_2', 0));

    // a screen with more than it loaded selects them all itself
    const view = renderTable({ groups: [group('more', [web3], { count: 40 })], onSelectAll });
    fireEvent.click(within(view.container).getByRole('checkbox', { name: 'Alle Items auswählen' }));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('loads the next page of a group at its end, and offers a retry when it fails', async () => {
    const loadMore = vi.fn();
    const retry = vi.fn();
    renderTable({
      groups: [group('a', items('a', 2), { count: 6, hasMore: true, loadMore }), group('b', items('b', 1), { count: 3, moreError: new Error('kaputt') as never, retry }), group('c', [], { status: 'pending', count: 2 })],
      groupBy: 'state',
    });
    await waitFor(() => expect(loadMore).toHaveBeenCalled());
    expect(screen.getByRole('alert').textContent).toMatch(/Nicht geladen/);
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(retry).toHaveBeenCalled();
  });

  it('counts its rows only while every open group is loaded, else says the count is unknown', () => {
    // a heading and two rows, the header row above them
    const loaded = renderTable({ groups: [group('a', items('a', 2))], groupBy: 'state' });
    expect(within(loaded.container).getByRole('grid').getAttribute('aria-rowcount')).toBe('4');
    loaded.unmount();

    const more = renderTable({ groups: [group('a', items('a', 2), { count: 6, hasMore: true })], groupBy: 'state' });
    expect(within(more.container).getByRole('grid').getAttribute('aria-rowcount')).toBe('-1');
    more.unmount();

    const waiting = renderTable({ groups: [group('a', items('a', 1)), group('b', [], { status: 'pending', count: 2 })], groupBy: 'state' });
    expect(within(waiting.container).getByRole('grid').getAttribute('aria-rowcount')).toBe('-1');
  });

  it('tints the selected item, the one in the preview and a fresh one', () => {
    useUiStore.setState({ peekItemId: 'wi_2', flashIds: ['wi_3'] });
    renderTable({ groups: [group('all', [web1, web2, web3])], selection: ['wi_1'] });
    expect(cell('wi_1', 0)!.className).toMatch(/select-wash/);
    expect(cell('wi_2', 0)!.className).toMatch(/--pressed/);
    // the other cells of the previewed row keep the hover tone
    expect(cell('wi_2', 1)!.className).toMatch(/--hover/);
    expect(cell('wi_3', 0)!.className).toMatch(/accent-soft/);
    expect(document.querySelector('tr[aria-selected="true"]')).toBe(cell('wi_1', 0)!.parentElement);
  });

  it('leaves the focus on a control a pointer pressed in a cell', async () => {
    renderTable({ groups: [group('all', [web1])] });
    await rightsLoaded();
    const trigger = within(cell('wi_1', 2)!).getByRole('combobox', { name: /^Priorität/ });
    pointAt(cell('wi_1', 2)!, trigger);
    expect(document.activeElement).toBe(trigger);
    // without a pointer the cell takes it
    act(() => cell('wi_1', 1)!.focus());
    act(() => trigger.focus());
    expect(document.activeElement).toBe(cell('wi_1', 2));
  });

  it('takes every step of held arrows, also two in one frame (T20-M3)', async () => {
    renderTable({ groups: [group('all', [web1, web2, web3])] });
    await focusCell('wi_1', 0);
    // the cell is rendered: it has the focus at once, not a frame later
    press('ArrowRight');
    expect(document.activeElement).toBe(cell('wi_1', 1));
    // so every press of a held key starts where the one before went
    press('ArrowRight');
    press('ArrowDown');
    press('ArrowDown');
    expect(document.activeElement).toBe(cell('wi_3', 2));
    expect(cursor()).toBe('wi_3');
    press('ArrowLeft');
    press('ArrowUp');
    expect(document.activeElement).toBe(cell('wi_2', 1));
  });

  it('moves with the arrows from a control a pointer left the focus on, while no editor is open (T20-M9)', async () => {
    renderTable({ groups: [group('all', [web1, web2])] });
    await rightsLoaded();
    const trigger = (id: string) => within(cell(id, 2)!).getByRole('combobox', { name: /^Priorität/ });
    const pointAtTrigger = (id: string) => {
      pointAt(cell(id, 2)!, trigger(id));
      expect(document.activeElement).toBe(trigger(id));
    };
    pointAtTrigger('wi_1');
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', 3)));
    pointAtTrigger('wi_1');
    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_2', 2)));
    expect(cursor()).toBe('wi_2');
    pointAtTrigger('wi_2');
    press('End');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_2', 3)));

    // with its editor open, the keys on the control are the editor's
    act(() => cell('wi_2', 2)!.focus());
    press('Enter');
    await searchField('Priorität suchen …');
    act(() => trigger('wi_2').focus());
    press('ArrowRight');
    expect(document.activeElement).toBe(trigger('wi_2'));
    expect(screen.getByPlaceholderText('Priorität suchen …')).toBeTruthy();
  });

  it('keeps the refusal of a property cell when its row scrolls away and back (T20-M5)', async () => {
    const user = userEvent.setup();
    patchAnswer = () => ({ status: 422, body: { status: 422, reason: 'validation_failed', errors: { 'values.effort': ['Höchstens 100 Stunden.'] } } });
    renderTable({ groups: [group('all', [web1, ...items('a', 1999)])] });
    await focusCell('wi_1', 3, 'Aufwand (h)');
    press('Enter');
    const field = await screen.findByRole('textbox', { name: 'Aufwand (h)' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.clear(field);
    await user.keyboard('120{Enter}');
    await waitFor(() => expect(within(cell('wi_1', 3)!).getByText('Höchstens 100 Stunden.')).toBeTruthy());

    // the cursor goes far away, the row is no longer rendered
    scrollBox(1000 * ROW);
    await waitFor(() => expect(cell('wi_a1000', 0)).toBeTruthy());
    act(() => cell('wi_a1000', 0)!.focus());
    await waitFor(() => expect(cell('wi_1', 3)).toBeNull());
    // back in view, the cell still says it
    scrollBox(0);
    await waitFor(() => expect(cell('wi_1', 3)).toBeTruthy());
    expect(within(cell('wi_1', 3)!).getByText('Höchstens 100 Stunden.')).toBeTruthy();
    expect(cell('wi_1', 3)!.querySelector('[aria-invalid="true"]')).toBeTruthy();
    expect(patches()).toEqual([{ values: { effort: 120 } }]);
  });

  it('keeps the editor open with a text it cannot read on a click beside it, and says why (T20-M10)', async () => {
    const user = userEvent.setup();
    renderTable({ groups: [group('all', [web1])] });
    await focusCell('wi_1', 3, 'Aufwand (h)');
    press('Enter');
    const field = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Aufwand (h)' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.clear(field);
    // a text that may still become valid: its error waits for Enter or a click beside it
    await user.keyboard('1.500');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'danach' }));
    expect(await screen.findByText(/^Mehrdeutig/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Aufwand (h)' })).toBe(field);
    expect(field.value).toBe('1.500');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(patches()).toEqual([]);

    // the first Escape takes the typing back, the second closes
    await user.keyboard('{Escape}');
    expect(field.value).toBe('3');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Aufwand (h)' })).toBeNull());

    // a text it can read goes out on a click beside it, and the editor closes
    act(() => cell('wi_1', 3)!.focus());
    press('Enter');
    const again = await screen.findByRole('textbox', { name: 'Aufwand (h)' });
    await waitFor(() => expect(document.activeElement).toBe(again));
    await user.clear(again);
    await user.keyboard('4');
    await user.click(screen.getByRole('button', { name: 'danach' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Aufwand (h)' })).toBeNull());
    expect(patches()).toEqual([{ values: { effort: 4 } }]);
  });

  it('measures where its box starts when the window changes its size', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 200, 1024, 0));
    renderTable({ groups: [group('all', [web1])] });
    const box = document.querySelector<HTMLElement>('[data-table-scroller]')!;
    expect(box.style.maxHeight).toMatch(/^calc\(100dvh - 200px/);
    rect.mockReturnValue(new DOMRect(0, 260, 1024, 0));
    act(() => window.dispatchEvent(new Event('resize')));
    expect(box.style.maxHeight).toMatch(/^calc\(100dvh - 260px/);
    rect.mockRestore();
  });

  it('indents children and leaves out the key when the display does not show it', async () => {
    const child = makeWorkItem({ id: 'wi_4', key: 'WEB-4', number: 4, title: 'Kind', parent_id: 'wi_2', parent: { id: 'wi_2', key: 'WEB-2', title: 'Relaunch', type_id: 't_epic' } });
    renderTable({ groups: [group('all', [web2, child])], display: { fields: ['state'] } });
    expect(within(cell('wi_4', 0)!).getByText('WEB-4').className).toBe('sr-only');
    expect((cell('wi_4', 0)!.firstElementChild as HTMLElement).style.paddingLeft).toBe('1.25rem');
    await waitFor(() => expect(within(cell('wi_2', 0)!).getByText('Relaunch').className).toMatch(/font-medium/));
  });
});

describe('cells of the table', () => {
  const today = cachedZone(organization.timezone).date(new Date());
  const allFields = ['labels', 'start_date', 'due_date', 'assignee', ...taskProperties.map((entry) => `property:${entry.key}`)];
  const column = (field: string) => allFields.indexOf(field) + 1;

  it('edits labels, assignee and the dates, and refuses a start after the due date', async () => {
    const user = userEvent.setup();
    const late = makeWorkItem({ id: 'wi_1', key: 'WEB-1', due_date: '2000-01-01', start_date: null });
    renderTable({ groups: [group('all', [late])], display: { fields: allFields } });
    await rightsLoaded();
    await waitFor(() => expect(cell('wi_1', column('labels'))!.textContent).toMatch(/Label/));

    await focusCell('wi_1', column('labels'));
    press('Enter');
    await searchField('Label suchen …');
    await user.keyboard('UX{Enter}');
    await waitFor(() => expect(patches()).toEqual([{ label_ids: ['lb_ux'] }]));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('labels'))));

    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('start_date'))));
    press('Enter');
    const day = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-day][tabindex="0"]');
      expect(document.activeElement).toBe(found);
      return found!;
    });
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Der Start liegt nach dem Due-Date (01.01.2000). Wähle einen Tag bis dahin oder verschiebe zuerst das Due-Date.')).toBeTruthy();
    expect(day).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('start_date'))));

    // the due date: any day is fine without a start
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('due_date'))));
    expect(cell('wi_1', column('due_date'))!.textContent).toMatch(/überfällig/);
    press('Enter');
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-day')).toBe(true));
    // the calendar starts on the day it has; the next one
    await user.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ due_date: '2000-01-02' }));
  });

  it('refuses a due date before the start in the calendar', async () => {
    const user = userEvent.setup();
    renderTable({ groups: [group('all', [makeWorkItem({ id: 'wi_1', key: 'WEB-1', start_date: '2999-01-01' })])], display: { fields: ['start_date', 'due_date'] } });
    await rightsLoaded();
    await waitFor(() => expect(cell('wi_1', 1)!.textContent).toMatch(/01\.01/));
    expect(cell('wi_1', 2)!.textContent).toBe('—');
    await focusCell('wi_1', 2);
    press('Enter');
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-day')).toBe(true));
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Das Due-Date liegt vor dem Start (01.01.2999). Wähle einen Tag ab dann oder verschiebe zuerst den Start.')).toBeTruthy();
    expect(patches()).toEqual([]);
  });

  it('chooses options and people from their pickers, one or many, and none', async () => {
    const user = userEvent.setup();
    const item = makeWorkItem({ id: 'wi_1', key: 'WEB-1', values: { customer: 'opt_nordlicht', tags: ['opt_old', 'opt_a'], reviewers: ['u_tom'] } });
    renderTable({ groups: [group('all', [item])], display: { fields: allFields } });
    // the first of many, then how many more; an archived option stays while it is set
    await waitFor(() => expect(cell('wi_1', column('property:tags'))!.textContent).toBe('Alpha+1'));
    await waitFor(() => expect(cell('wi_1', column('property:reviewers'))!.textContent).toMatch(/Tom Weber$/));
    expect(cell('wi_1', column('property:owner'))!.textContent).toBe('—');

    await focusCell('wi_1', column('property:customer'));
    press('Enter');
    await searchField('Option suchen …');
    await user.keyboard('Hafen{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { customer: 'opt_hafenkontor' } }));
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('property:customer'))));
    press('Enter');
    await searchField('Option suchen …');
    await user.keyboard('Keine{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { customer: null } }));

    act(() => cell('wi_1', column('property:tags'))!.focus());
    press('Enter');
    await searchField('Option suchen …');
    expect(screen.getByRole('option', { name: /Alt/ }).textContent).toMatch(/archiviert/);
    await user.keyboard('Beta{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { tags: ['opt_a', 'opt_old', 'opt_b'] } }));
    await user.keyboard('{Escape}');

    act(() => cell('wi_1', column('property:owner'))!.focus());
    press('Enter');
    await searchField('Person suchen …');
    await user.keyboard('Ida{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { owner: 'u_ida' } }));
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('property:owner'))));

    // Tom, set before and no longer offered (no member), stays while he is set
    act(() => cell('wi_1', column('property:reviewers'))!.focus());
    press('Enter');
    await searchField('Person suchen …');
    expect(screen.getByRole('option', { name: /Tom Weber/ }).textContent).toMatch(/nicht mehr wählbar/);
    await user.keyboard('Lene{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { reviewers: ['u_tom', 'u_lene'] } }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('property:reviewers'))));
  });

  it('switches yes/no with Enter and a click, sets a date, and types text, links and plain rich text', async () => {
    const user = userEvent.setup();
    const item = makeWorkItem({ id: 'wi_1', key: 'WEB-1', values: { note: 'Alt' } });
    renderTable({ groups: [group('all', [item])], display: { fields: allFields } });
    await waitFor(() => expect(within(cell('wi_1', column('property:signed'))!).getByRole('switch', { name: 'Abgenommen' })).toBeTruthy());

    await focusCell('wi_1', column('property:signed'));
    press('Enter');
    await waitFor(() => expect(patches()).toEqual([{ values: { signed: true } }]));
    expect(document.activeElement).toBe(cell('wi_1', column('property:signed')));
    fireEvent.click(within(cell('wi_1', column('property:signed'))!).getByRole('switch'));
    await waitFor(() => expect(patches()).toHaveLength(1));

    act(() => cell('wi_1', column('property:release'))!.focus());
    press('Enter');
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-day')).toBe(true));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { release: today } }));

    act(() => cell('wi_1', column('property:site'))!.focus());
    press('Enter');
    const address = await screen.findByRole('textbox', { name: 'Seite' });
    await waitFor(() => expect(document.activeElement).toBe(address));
    await user.keyboard('https://example.com{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { site: 'https://example.com' } }));

    // a required text cannot be emptied
    await waitFor(() => expect(document.activeElement).toBe(cell('wi_1', column('property:site'))));
    act(() => cell('wi_1', column('property:note'))!.focus());
    press('Enter');
    const text = await screen.findByRole('textbox', { name: 'Notiz' });
    await waitFor(() => expect(document.activeElement).toBe(text));
    await user.clear(text);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('„Notiz“ ist ein Pflichtfeld und lässt sich nicht leeren.')).toBeTruthy();
    await user.keyboard('{Escape}{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Notiz' })).toBeNull());

    act(() => cell('wi_1', column('property:brief'))!.focus());
    press('Enter');
    const area = await screen.findByRole('textbox', { name: 'Briefing' });
    await waitFor(() => expect(document.activeElement).toBe(area));
    const hint = document.getElementById(area.getAttribute('aria-describedby')!)!;
    expect(within(hint).getByRole('img', { name: 'Steuerung Eingabe' })).toBeTruthy();
    expect(hint.textContent).toBe('Strg speichert, Enter beginnt eine neue Zeile. Esc nimmt das Getippte zurück, ein zweites schließt.');
    await user.keyboard('Zeile eins{Control>}{Enter}{/Control}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { brief: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zeile eins' }] }] } } }));
  });
});

describe('the refusals of the property cells', () => {
  const effortOf = catalog.find((entry) => entry.key === 'effort')!;
  const refusal = (words: string) => new ApiError({ status: 422, reason: 'validation_failed', errors: { 'values.effort': [words] } });
  /** A save that waits until the test answers it. */
  const held = () => {
    let answer: { resolve: (value: unknown) => void; reject: (error: Error) => void } = { resolve: () => {}, reject: () => {} };
    const call = new Promise((resolve, reject) => (answer = { resolve, reject }));
    return { call, ...answer };
  };
  const item = makeWorkItem({ id: 'wi_1', updated_at: '2026-10-28T09:00:00Z' });

  it('keeps the words of the newest save only, when two saves of a cell are on their way at once (20a-M1)', async () => {
    const { result } = renderHook(() => useRefusals());
    const [first, second] = [held(), held()];
    act(() => result.current('row', effortOf, item).track(first.call));
    act(() => result.current('row', effortOf, item).track(second.call));
    // the second goes through, then the first comes back refused
    await act(async () => second.resolve({}));
    await act(async () => first.reject(refusal('Höchstens 100 Stunden.')));
    expect(result.current('row', effortOf, item).refusal).toBeNull();

    // the newest save refused: its words stay, whatever an earlier one answers
    const [third, fourth] = [held(), held()];
    act(() => result.current('row', effortOf, item).track(third.call));
    act(() => result.current('row', effortOf, item).track(fourth.call));
    await act(async () => fourth.reject(refusal('Nur ganze Stunden.')));
    await act(async () => third.reject(refusal('Höchstens 100 Stunden.')));
    expect(result.current('row', effortOf, item).refusal).toBe('Nur ganze Stunden.');
  });

  it('shows the words only while the item is as the refused save found it (20a-M2)', async () => {
    const { result } = renderHook(() => useRefusals());
    const save = held();
    act(() => result.current('row', effortOf, item).track(save.call));
    await act(async () => save.reject(refusal('Höchstens 100 Stunden.')));
    expect(result.current('row', effortOf, item).refusal).toBe('Höchstens 100 Stunden.');
    // the item changed another way (live, the preview, another row of it): the words are no longer its
    expect(result.current('row', effortOf, { ...item, updated_at: '2026-10-28T09:05:00Z' }).refusal).toBeNull();
    // other cells and rows have none
    expect(result.current('other', effortOf, item).refusal).toBeNull();
  });
});
