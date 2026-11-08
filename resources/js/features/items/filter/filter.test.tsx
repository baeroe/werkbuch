/*
 * The filter bar against a fake REST API (`mockApi`) for its catalogs: a harness keeps the filter as the list would
 * (the address) and records every change. The keys go to the page as a person presses them; the tests wait for the
 * search field of a list before they type (Base UI sets the focus a frame later).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { mockApi, queried, type MockApi, type MockRoute } from '@/test/api';
import { agency, labels, lene, list, makeWorkItem, mara, organization, person, project, properties, queryItems, standard, theo, types, web30, web47 } from '@/test/fixtures';
import type { Condition, Filter, Project, Property, User } from '@/types';
import { FilterBar } from './FilterBar';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: '/projects/WEB' }),
}));

/* -------------------------------------------------------------------------- data */

const web = project('WEB', 'member');
const app = project('APP', 'member', { workflow_id: 'wf_agency' });
const pixel: User = { ...person('u_pixel', 'Pixel', 'pixel'), type: 'bot', email: null };
const sven: User = { ...person('u_sven', 'Sven Roth', 'sven'), disabled_at: '2026-09-01T10:00:00.000Z' };

const extra = (key: string, label: string, field_type: Property['field_type'], settings: Property['settings'] = {}): Property => ({
  id: `pr_${key}`,
  key,
  label,
  field_type,
  help: '',
  default_value: null,
  settings,
  options: [],
});
const catalog: Property[] = [
  ...properties.map((entry) => (entry.key === 'customer' ? { ...entry, options: [...entry.options, { id: 'opt_old', label: 'Altkunde', color: 'slate' as const, position: 3, archived_at: '2026-09-01T00:00:00.000Z' }] } : entry)),
  extra('notes', 'Notiz', 'text'),
  extra('reviewer', 'Prüferin', 'member', { multiple: true }),
  extra('launch', 'Livegang', 'date'),
  extra('approved', 'Freigegeben', 'boolean'),
];
const archivedType = { ...types[0]!, id: 't_old', name: 'Altlast', archived_at: '2026-09-01T00:00:00.000Z' };
const appEpic = makeWorkItem({ id: 'wi_app_9', project_id: 'p_app', number: 9, key: 'APP-9', type_id: 't_epic', title: 'App 2.0' });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;
afterEach(() => {
  api?.restore();
  api = undefined;
});

const conditions = (...entries: Condition[]): Filter => ({ version: 1, conditions: entries });

function renderBar(initial: Filter = conditions(), { project: shown, routes = {}, gate }: { project?: Project; routes?: Record<string, MockRoute>; gate?: Promise<void> } = {}) {
  api = mockApi({
    'GET /api/v1/properties': () => ({ body: list(catalog) }),
    'GET /api/v1/projects': () => ({ body: list([web, app]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/users': () => ({ body: list([mara, lene, theo, sven, pixel]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list([...types, archivedType]) }),
    'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([web30, web47, appEpic], body)) }),
    ...routes,
  });
  if (gate) {
    // the properties answer once the test opens the gate
    const answer = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/properties')) await gate;
      return answer(input, init);
    };
  }
  const changes: Filter[] = [];
  function Harness() {
    const [filter, setFilter] = useState(initial);
    return (
      <FilterBar
        filter={filter}
        project={shown}
        onChange={(next) => {
          changes.push(next);
          setFilter(next);
        }}
        actions={<button type="button">Neues Item</button>}
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { changes, last: () => changes.at(-1)?.conditions };
}

/** Waits until the search field of an open list has the focus (Base UI sets it a frame later). */
async function searchFocused(name: string) {
  const field = await screen.findByRole('combobox', { name });
  await waitFor(() => expect(document.activeElement).toBe(field));
  return field;
}

/** `f`, then the field typed and chosen with Enter. */
async function addField(user: ReturnType<typeof userEvent.setup>, typed: string) {
  await waitFor(() => expect(screen.queryByText('Lädt …')).toBeNull());
  await user.keyboard('f');
  await searchFocused('Feld suchen …');
  await user.keyboard(`${typed}{Enter}`);
}

/** What an element shows in words, without its decorative parts (icons, avatars with initials). */
function visibleText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent ?? '';
}

/** Tab until `reached` holds, a few steps at most (a popover is short). */
async function tabUntil(user: ReturnType<typeof userEvent.setup>, reached: () => boolean) {
  for (let step = 0; step < 12 && !reached(); step++) await user.tab();
  expect(reached()).toBe(true);
}

const chip = (name: RegExp) => screen.getByRole('group', { name });
const findChip = (name: RegExp) => screen.findByRole('group', { name });

/* ------------------------------------------------------------------------ tests */

describe('the filter bar', () => {
  it('adds a condition with f, picks the field by typing and the value from its list', async () => {
    const user = userEvent.setup();
    const { last } = renderBar();
    await screen.findByRole('combobox', { name: 'Filter' });
    await addField(user, 'prio');
    // the value list opens at once, the condition waits for its value
    expect(await findChip(/Filter: Priorität ist kein Wert, noch ohne Wert/)).toBeTruthy();
    await searchFocused('Priorität suchen …');
    await user.keyboard('urg{Enter}');
    expect(last()).toEqual([{ field: 'priority', op: 'is', value: 'urgent' }]);
    await user.keyboard('{Escape}');
    expect(chip(/^Filter: Priorität ist Urgent$/)).toBeTruthy();
    // a second value: "ist eines von"
    fireEvent.click(within(chip(/Priorität/)).getByRole('combobox', { name: /Priorität: Urgent/ }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    expect(last()).toEqual([{ field: 'priority', op: 'in', value: ['urgent', 'high'] }]);
    expect(within(chip(/Priorität ist eines von Urgent, High/)).getByText('+1')).toBeTruthy();
  });

  it('adds a flag complete at once and switches it to no', async () => {
    const user = userEvent.setup();
    const { last } = renderBar();
    await addField(user, 'Blockiert');
    expect(last()).toEqual([{ field: 'blocked', op: 'is', value: true }]);
    // a flag offers one operator: no menu
    const blocked = await findChip(/^Filter: Blockiert ist ja$/);
    expect(within(blocked).queryByRole('button', { name: /Operator/ })).toBeNull();
    await user.click(within(blocked).getByRole('button', { name: 'Blockiert: ja' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'nein' }));
    expect(last()).toEqual([{ field: 'blocked', op: 'is', value: false }]);
    await user.click(within(chip(/Blockiert ist nein/)).getByRole('button', { name: 'Blockiert: nein' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'ja' }));
    expect(last()).toEqual([{ field: 'blocked', op: 'is', value: true }]);
  });

  it('changes the operator and keeps the values that still fit', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'state', op: 'in', value: ['std_todo', 'std_progress'] }));
    const state = await findChip(/Status ist eines von Todo, In Progress/);
    await user.click(within(state).getByRole('button', { name: 'Operator: ist eines von' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'ist nicht' }));
    expect(last()).toEqual([{ field: 'state', op: 'not_in', value: ['std_todo', 'std_progress'] }]);
    expect(await findChip(/Status ist keines von Todo, In Progress/)).toBeTruthy();
    // "ist leer" needs no value, and Status cannot be empty: not offered
    await user.click(within(chip(/Status/)).getByRole('button', { name: /Operator/ }));
    expect(screen.queryByRole('menuitemradio', { name: 'ist leer' })).toBeNull();
  });

  it('asks for a value when the operator needs one again', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'assignee', op: 'is_empty' }));
    const assignee = await findChip(/^Filter: Assignee ist leer$/);
    await user.click(within(assignee).getByRole('button', { name: 'Operator: ist leer' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'ist nicht' }));
    expect(last()).toEqual([{ field: 'assignee', op: 'not_in', value: [] }]);
    // the list opens and takes the focus
    await searchFocused('Assignee suchen …');
    await user.keyboard('Theo{Enter}');
    expect(last()).toEqual([{ field: 'assignee', op: 'is_not', value: 'u_theo' }]);
  });

  it('keeps an unfinished condition when the operator menu changes it', async () => {
    const user = userEvent.setup();
    const { last } = renderBar();
    await addField(user, 'Aufwand');
    const field = await screen.findByRole('textbox', { name: 'Aufwand (h) ist' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Operator: ist' }));
    await user.keyboard('{Enter}');
    const greater = await screen.findByRole('menuitemradio', { name: 'größer als' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('menuitemradio')[0]));
    await user.click(greater);
    // the condition is still there and asks for its value
    const unfinished = await findChip(/Aufwand \(h\) größer als kein Wert, noch ohne Wert/);
    const input = within(unfinished).getByRole('textbox', { name: 'Aufwand (h) größer als' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.keyboard('5{Enter}');
    expect(last()).toEqual([{ field: 'property:effort', op: 'gt', value: 5 }]);
  });

  it('keeps the first value of between when tabbing to the second', async () => {
    const user = userEvent.setup();
    const { last, changes } = renderBar();
    await addField(user, 'Aufwand');
    const field = await screen.findByRole('textbox', { name: 'Aufwand (h) ist' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.click(within(chip(/Aufwand/)).getByRole('button', { name: 'Operator: ist' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'zwischen' }));
    const from = await screen.findByRole('textbox', { name: 'Aufwand (h) von' });
    await waitFor(() => expect(document.activeElement).toBe(from));
    await user.keyboard('2');
    await user.tab();
    const to = screen.getByRole('textbox', { name: 'Aufwand (h) bis' });
    expect(document.activeElement).toBe(to);
    // the chip stays with its first value, and nothing unfinished went to the filter
    expect((screen.getByRole('textbox', { name: 'Aufwand (h) von' }) as HTMLInputElement).value).toBe('2');
    expect(chip(/Aufwand \(h\) zwischen 2 und kein Wert, noch ohne Wert/)).toBeTruthy();
    expect(changes).toHaveLength(0);
    await user.keyboard('8{Enter}');
    expect(last()).toEqual([{ field: 'property:effort', op: 'between', value: [2, 8] }]);
    expect(chip(/^Filter: Aufwand \(h\) zwischen 2 und 8$/)).toBeTruthy();
    expect(changes).toHaveLength(1);
  });

  it('drops an unfinished condition once the focus leaves it', async () => {
    const user = userEvent.setup();
    const { changes, last } = renderBar(conditions({ field: 'property:effort', op: 'between', value: [1, null] }));
    const effort = await findChip(/noch ohne Wert/);
    expect(within(effort).getByText('und')).toBeTruthy();
    await user.click(within(effort).getByRole('textbox', { name: 'Aufwand (h) bis' }));
    await user.click(screen.getByRole('button', { name: 'Neues Item' }));
    await waitFor(() => expect(last()).toEqual([]));
    expect(changes).toHaveLength(1);

    // a new condition without a value goes the same way, and never joins the filter
    await addField(user, 'Notiz');
    const notes = await screen.findByRole('textbox', { name: 'Notiz enthält' });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    // a click on nothing in particular: the focus goes to the page, a few frames later the condition goes
    act(() => notes.blur());
    await waitFor(() => expect(screen.queryByRole('group', { name: /Notiz/ })).toBeNull());
    expect(changes).toHaveLength(1);
  });

  it('removes a condition with its button and with backspace on the chip', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(
      conditions({ field: 'priority', op: 'is', value: 'urgent' }, { field: 'title', op: 'contains', value: 'Logo' }, { field: 'blocked', op: 'is', value: true }),
    );
    const priority = await findChip(/Priorität ist Urgent/);
    await user.click(within(priority).getByRole('button', { name: 'Filter „Priorität“ entfernen' }));
    expect(last()).toEqual([
      { field: 'title', op: 'contains', value: 'Logo' },
      { field: 'blocked', op: 'is', value: true },
    ]);
    // the focus goes on to the next chip
    const blocked = chip(/Blockiert ist ja/);
    expect(blocked.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Backspace}');
    expect(last()).toEqual([{ field: 'title', op: 'contains', value: 'Logo' }]);
    // no chip is left: the focus goes to "Filter"
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Filter' }));
  });

  it('removes a new condition before it has a value, and Backspace in its field stays typing', async () => {
    const user = userEvent.setup();
    const { changes } = renderBar(conditions({ field: 'blocked', op: 'is', value: true }));
    await addField(user, 'Notiz');
    const notes = await screen.findByRole('textbox', { name: 'Notiz enthält' });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    await user.keyboard('ab{Backspace}');
    expect((notes as HTMLInputElement).value).toBe('a');
    await user.clear(notes);
    await user.click(within(chip(/Notiz/)).getByRole('button', { name: 'Filter „Notiz“ entfernen' }));
    expect(screen.queryByRole('group', { name: /Notiz/ })).toBeNull();
    // the focus goes to the chip before it; the filter never had the new condition
    expect(chip(/Blockiert/).contains(document.activeElement)).toBe(true);
    expect(changes).toHaveLength(0);

    // typed and then removed: the × keeps nothing typed first, the chip just goes (T16-M4)
    await addField(user, 'Notiz');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Notiz enthält' })));
    await user.keyboard('Rückruf');
    await user.click(within(chip(/Notiz/)).getByRole('button', { name: 'Filter „Notiz“ entfernen' }));
    expect(screen.queryByRole('group', { name: /Notiz/ })).toBeNull();
    expect(changes).toHaveLength(0);
    expect(chip(/^Filter: Blockiert ist ja$/)).toBeTruthy();
  });

  it('focuses the title search with / and filters by title on Enter', async () => {
    const user = userEvent.setup();
    const { last, changes } = renderBar();
    await screen.findByRole('combobox', { name: 'Filter' });
    await user.keyboard('/');
    const search = screen.getByRole('searchbox', { name: 'Titel durchsuchen' });
    expect(document.activeElement).toBe(search);
    await user.keyboard('Logo{Enter}');
    expect(last()).toEqual([{ field: 'title', op: 'contains', value: 'Logo' }]);
    // the search is no chip
    expect(screen.queryByRole('list', { name: 'Bedingungen' })).toBeNull();
    // Enter again changes nothing; leaving the field applies what was typed
    await user.keyboard('{Enter}');
    expect(changes).toHaveLength(1);
    await user.type(search, ' austauschen');
    await user.tab();
    expect(last()).toEqual([{ field: 'title', op: 'contains', value: 'Logo austauschen' }]);
    // the first Escape empties, the second leaves the field
    await user.click(search);
    await user.keyboard('{Escape}');
    expect(last()).toEqual([]);
    await user.keyboard('{Escape}');
    expect(document.activeElement).not.toBe(search);
    await user.click(search);
    await user.keyboard('Form');
    await user.click(screen.getByRole('button', { name: 'Suche leeren' }));
    expect((search as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(search);
  });

  it('shows a title from outside, and replaces the one there is', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'blocked', op: 'is', value: true }, { field: 'title', op: 'contains', value: 'Logo' }));
    const search = await screen.findByRole('searchbox', { name: 'Titel durchsuchen' });
    expect((search as HTMLInputElement).value).toBe('Logo');
    await user.clear(search);
    await user.type(search, 'Footer{Enter}');
    expect(last()).toEqual([
      { field: 'blocked', op: 'is', value: true },
      { field: 'title', op: 'contains', value: 'Footer' },
    ]);
  });

  it('offers me first for the assignee', async () => {
    const user = userEvent.setup();
    const { last } = renderBar();
    await addField(user, 'Assignee');
    await searchFocused('Assignee suchen …');
    const options = await screen.findAllByRole('option');
    // Ich, then the active people by name, then the bots; deactivated accounts are not offered
    expect(options.map(visibleText)).toEqual(['IchLene Vogt', 'Lene Vogt', 'Mara Lindqvist', 'Theo Okafor', 'PixelBot']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(last()).toEqual([{ field: 'assignee', op: 'is', value: 'me' }]);
    await user.keyboard('{Escape}');
    expect(await findChip(/^Filter: Assignee ist Ich$/)).toBeTruthy();
  });

  it('offers me for a people property, and the epics as parents', async () => {
    const user = userEvent.setup();
    renderBar();
    await addField(user, 'Prüferin');
    await searchFocused('Prüferin suchen …');
    expect(visibleText((await screen.findAllByRole('option'))[0]!)).toBe('IchLene Vogt');
    await user.keyboard('{Escape}');
    await addField(user, 'Eltern');
    await searchFocused('Eltern-Item suchen …');
    expect((await screen.findAllByRole('option')).map(visibleText)).toEqual(['Relaunch Phase 1WEB-30', 'App 2.0APP-9']);
  });

  it('offers the epics of the project as parents, and its states', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions(), { project: web });
    await addField(user, 'Eltern');
    await searchFocused('Eltern-Item suchen …');
    expect((await screen.findAllByRole('option')).map(visibleText)).toEqual(['Relaunch Phase 1WEB-30']);
    await user.keyboard('{ArrowDown}{Enter}{Escape}');
    expect(last()).toEqual([{ field: 'parent', op: 'is', value: 'wi_web_30' }]);
    // the project is the list itself: no field "Projekt"
    await user.keyboard('f');
    await searchFocused('Feld suchen …');
    expect(screen.queryByRole('option', { name: 'Projekt' })).toBeNull();
    await user.keyboard('Status{Enter}');
    await searchFocused('Status suchen …');
    expect((await screen.findAllByRole('option')).map(visibleText)).toEqual(standard.states.map((state) => state.name));
  });

  /** `GET /references` for the epics of the fixtures: an id it does not know the reader does not see. */
  const references: MockRoute = (_body, url) => ({
    body: { data: { items: [web30, web47, appEpic].filter((item) => (url.searchParams.get('items') ?? '').split(',').includes(item.id)), pages: [] } },
  });
  const epicLists = () => api!.calls.filter((call) => call.url === '/api/v1/work-items/query' && queried(call.body).epic);

  it('names a parent chip without loading the epics (T16-M1)', async () => {
    const user = userEvent.setup();
    renderBar(conditions({ field: 'parent', op: 'in', value: ['wi_web_30', 'wi_app_9'] }), { routes: { 'GET /api/v1/references': references } });
    expect(await findChip(/^Filter: Eltern-Item ist eines von Relaunch Phase 1, App 2\.0$/)).toBeTruthy();
    // the names came from the references of the two values, in one request; no list of every epic was read for them
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/references')).map((call) => call.url)).toEqual(['/api/v1/references?items=wi_web_30%2Cwi_app_9']);
    expect(epicLists()).toHaveLength(0);

    // the list opens: now the epics load, and the chosen ones stay checked
    await user.click(within(chip(/Eltern-Item/)).getByRole('combobox', { name: /^Eltern-Item:/ }));
    await searchFocused('Eltern-Item suchen …');
    expect(await screen.findByRole('option', { name: /Relaunch Phase 1/, selected: true })).toBeTruthy();
    expect(epicLists()).toHaveLength(1);
  });

  it('names a parent the reader does not see hidden, without the epics', async () => {
    renderBar(conditions({ field: 'parent', op: 'is', value: 'wi_secret' }), { routes: { 'GET /api/v1/references': references } });
    expect(await findChip(/^Filter: Eltern-Item ist Verborgen$/)).toBeTruthy();
    expect(api!.calls.some((call) => call.url.startsWith('/api/v1/references'))).toBe(true);
    expect(epicLists()).toHaveLength(0);
  });

  it('offers the states of every workflow in view, named by workflow', async () => {
    const user = userEvent.setup();
    renderBar();
    await addField(user, 'Status');
    await searchFocused('Status suchen …');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(standard.states.length + agency.states.length);
    expect(visibleText(options[0]!)).toBe('BacklogStandard');
  });

  it('offers projects, types, categories, labels and the options of a property', async () => {
    const user = userEvent.setup();
    renderBar();
    const optionsOf = async (field: string, search: string) => {
      await addField(user, field);
      await searchFocused(search);
      const texts = (await screen.findAllByRole('option')).map(visibleText);
      await user.keyboard('{Escape}');
      return texts;
    };
    expect(await optionsOf('Projekt', 'Projekt suchen …')).toEqual(['WEB', 'APP']);
    expect(await optionsOf('Typ', 'Typ suchen …')).toEqual(['Task', 'Bug', 'Epic', 'Kundenwunsch', 'Altlastarchiviert']);
    expect(await optionsOf('Kategorie', 'Kategorie suchen …')).toEqual(['Backlog', 'Unstarted', 'Started', 'Completed', 'Canceled']);
    expect(await optionsOf('Label', 'Label suchen …')).toEqual(['Formulare', 'Performance', 'Produktion', 'UX']);
    expect(await optionsOf('Kunde', 'Kunde suchen …')).toEqual(['Studio Nordlicht', 'Hafenkontor', 'Gärtnerei Moos', 'Altkundearchiviert']);
    // a property's field says it is one
    await user.keyboard('f');
    await searchFocused('Feld suchen …');
    await user.keyboard('Umgebung');
    expect(visibleText(screen.getByRole('option', { name: /Umgebung/ }))).toBe('UmgebungProperty');
    await user.keyboard('xyz');
    expect(await screen.findByText('Kein Feld passt.')).toBeTruthy();
  });

  it('shows a condition on a property that is gone as an unknown field and removes it', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'property:gone', op: 'is', value: 'x' }, { field: 'blocked', op: 'is', value: true }));
    const unknown = await findChip(/Unbekanntes Feld property:gone/);
    expect(unknown.textContent).toBe('Unbekanntes Feld');
    await user.click(within(unknown).getByRole('button', { name: 'Filter „Unbekanntes Feld“ entfernen' }));
    expect(last()).toEqual([{ field: 'blocked', op: 'is', value: true }]);
  });

  it('waits for the properties before it calls a field unknown', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    renderBar(conditions({ field: 'property:customer', op: 'is', value: 'opt_moos' }, { field: 'blocked', op: 'is', value: true }), { gate });
    expect(await findChip(/Blockiert ist ja/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Kunde|Unbekanntes Feld/ })).toBeNull();
    release();
    expect(await findChip(/^Filter: Kunde ist Gärtnerei Moos$/)).toBeTruthy();
    expect(screen.queryByText('Unbekanntes Feld')).toBeNull();
  });

  it('names an unknown project as hidden, and keeps it while other projects change', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'project', op: 'is', value: 'p_secret' }));
    const projectChip = await findChip(/^Filter: Projekt ist Verborgen$/);
    await user.click(within(projectChip).getByRole('combobox', { name: 'Projekt: Verborgen' }));
    await user.click(await screen.findByRole('option', { name: 'WEB' }));
    expect(last()).toEqual([{ field: 'project', op: 'in', value: ['p_secret', 'p_web'] }]);
    await user.click(await screen.findByRole('option', { name: 'Verborgen' }));
    expect(last()).toEqual([{ field: 'project', op: 'is', value: 'p_web' }]);
  });

  it('names a deactivated person and a state of another workflow by their names, not as hidden (T16-M2)', async () => {
    // a project list of WEB offers only the states of its workflow; Kundenfreigabe is one of the Agentur-Freigabe
    renderBar(conditions({ field: 'assignee', op: 'is', value: 'u_sven' }, { field: 'state', op: 'is', value: 'app_approval' }), { project: web });
    expect(await findChip(/^Filter: Assignee ist Sven Roth \(deaktiviert\)$/)).toBeTruthy();
    expect(await findChip(/^Filter: Status ist Kundenfreigabe$/)).toBeTruthy();
  });

  it('says a property chip could not be loaded and loads the properties again (T16-M5)', async () => {
    const user = userEvent.setup();
    let failing = true;
    const { last } = renderBar(conditions({ field: 'property:customer', op: 'is', value: 'opt_moos' }, { field: 'blocked', op: 'is', value: true }), {
      routes: { 'GET /api/v1/properties': () => (failing ? { status: 503, body: { reason: 'service_unavailable' } } : { body: list(catalog) }) },
    });
    const failed = await findChip(/^Filter: Property „customer“, nicht geladen$/);
    expect(visibleText(failed)).toBe('customerNicht geladenErneut versuchen');
    expect(screen.queryByText('Unbekanntes Feld')).toBeNull();
    failing = false;
    await user.click(within(failed).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await findChip(/^Filter: Kunde ist Gärtnerei Moos$/)).toBeTruthy();
    // the condition itself never changed
    expect(last()).toBeUndefined();
  });

  it('removes a property chip that could not be loaded', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'property:customer', op: 'is', value: 'opt_moos' }, { field: 'blocked', op: 'is', value: true }), {
      routes: { 'GET /api/v1/properties': () => ({ status: 503, body: { reason: 'service_unavailable' } }) },
    });
    const failed = await findChip(/^Filter: Property „customer“, nicht geladen$/);
    await user.click(within(failed).getByRole('button', { name: 'Filter „customer“ entfernen' }));
    expect(last()).toEqual([{ field: 'blocked', op: 'is', value: true }]);
  });

  it('says the value of a choice is loading while its list loads, and offers to try again when it failed', async () => {
    const user = userEvent.setup();
    let failing = true;
    renderBar(conditions({ field: 'label', op: 'is', value: 'lb_ux' }), {
      routes: { 'GET /api/v1/labels': () => (failing ? { status: 503, body: { reason: 'service_unavailable' } } : { body: list(labels) }) },
    });
    expect(await findChip(/Label ist (Lädt …|Verborgen)/)).toBeTruthy();
    await user.click(within(chip(/Label/)).getByRole('combobox', { name: /^Label:/ }));
    const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
    failing = false;
    await user.click(retry);
    expect(await screen.findByRole('option', { name: 'UX' })).toBeTruthy();
    expect(chip(/^Filter: Label ist UX$/)).toBeTruthy();
  });

  it('offers relative days and this week for dates', async () => {
    const user = userEvent.setup();
    const { last } = renderBar();
    await addField(user, 'Due-Date');
    const popover = await screen.findByRole('dialog', { name: 'Due-Date' });
    await user.click(within(popover).getByRole('button', { name: 'Diese Woche' }));
    expect(last()).toEqual([{ field: 'due_date', op: 'is', value: 'this_week' }]);
    const due = await findChip(/^Filter: Due-Date ist diese Woche$/);

    // two weeks ago
    await user.click(within(due).getByRole('button', { name: 'Due-Date: diese Woche' }));
    const again = await screen.findByRole('dialog', { name: 'Due-Date' });
    const amount = within(again).getByRole('textbox', { name: 'Anzahl' });
    await user.clear(amount);
    await user.type(amount, 'x');
    await user.click(within(again).getByRole('button', { name: 'Übernehmen' }));
    expect(within(again).getByText('Eine ganze Zahl von 0 bis 9999, zum Beispiel 7.')).toBeTruthy();
    expect(document.activeElement).toBe(amount);
    await user.clear(amount);
    await user.type(amount, '2');
    await user.click(within(again).getByRole('combobox', { name: 'Richtung' }));
    await user.click(await screen.findByRole('option', { name: 'Vor' }));
    await user.click(within(again).getByRole('combobox', { name: 'Einheit' }));
    await user.click(await screen.findByRole('option', { name: 'Wochen' }));
    await user.click(within(again).getByRole('button', { name: 'Übernehmen' }));
    expect(last()).toEqual([{ field: 'due_date', op: 'is', value: { relative: '-2w' } }]);
    expect(await findChip(/Due-Date ist heute − 2 Wochen/)).toBeTruthy();

    // the distance shows again, and Enter in its field applies it
    await user.click(within(chip(/Due-Date/)).getByRole('button', { name: /Due-Date: heute/ }));
    const third = await screen.findByRole('dialog', { name: 'Due-Date' });
    expect((within(third).getByRole('textbox', { name: 'Anzahl' }) as HTMLInputElement).value).toBe('2');
    await user.click(within(third).getByRole('combobox', { name: 'Richtung' }));
    await user.click(await screen.findByRole('option', { name: 'In' }));
    await user.click(within(third).getByRole('combobox', { name: 'Einheit' }));
    await user.click(await screen.findByRole('option', { name: 'Tagen' }));
    await user.type(within(third).getByRole('textbox', { name: 'Anzahl' }), '{Enter}');
    expect(last()).toEqual([{ field: 'due_date', op: 'is', value: { relative: '+2d' } }]);
  });

  it('goes the date popover with the keyboard only: quick choice, distance and calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    try {
      const user = userEvent.setup();
      const { last } = renderBar();
      await addField(user, 'Due-Date');
      const popover = await screen.findByRole('dialog', { name: 'Due-Date' });
      // the quick choice first: the arrows go through it, Enter takes one
      const today = within(within(popover).getByRole('group', { name: 'Schnellauswahl' })).getByRole('button', { name: 'Heute' });
      await waitFor(() => expect(document.activeElement).toBe(today));
      await user.keyboard('{ArrowRight}');
      expect(document.activeElement?.textContent).toBe('Diese Woche');
      await user.keyboard('{Enter}');
      expect(last()).toEqual([{ field: 'due_date', op: 'is', value: 'this_week' }]);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Due-Date' })).toBeNull());
      const trigger = within(chip(/Due-Date ist diese Woche/)).getByRole('button', { name: 'Due-Date: diese Woche' });
      await waitFor(() => expect(document.activeElement).toBe(trigger));

      // the distance: Tab to the amount, Enter applies it
      await user.keyboard('{Enter}');
      const distance = await screen.findByRole('dialog', { name: 'Due-Date' });
      const amount = within(distance).getByRole('textbox', { name: 'Anzahl' });
      await waitFor(() => expect(distance.contains(document.activeElement)).toBe(true));
      await tabUntil(user, () => document.activeElement === amount);
      await user.keyboard('{Control>}a{/Control}3{Enter}');
      expect(last()).toEqual([{ field: 'due_date', op: 'is', value: { relative: '+3d' } }]);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Due-Date' })).toBeNull());

      // the calendar: Tab to its day, the arrows move it, Enter picks
      const relative = within(chip(/Due-Date/)).getByRole('button', { name: /^Due-Date: heute/ });
      await waitFor(() => expect(document.activeElement).toBe(relative));
      await user.keyboard('{Enter}');
      const calendar = await screen.findByRole('dialog', { name: 'Due-Date' });
      const grid = within(calendar).getByRole('grid');
      await waitFor(() => expect(calendar.contains(document.activeElement)).toBe(true));
      await tabUntil(user, () => grid.contains(document.activeElement));
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Mittwoch, 28\. Oktober 2026/);
      await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
      expect(last()).toEqual([{ field: 'due_date', op: 'is', value: '2026-11-05' }]);
      expect(await findChip(/^Filter: Due-Date ist 05\.11\.2026$/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks a day from the calendar, and two for between', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'created_at', op: 'is', value: '2026-10-28' }));
    const created = await findChip(/Angelegt ist 28\.10\.2026/);
    await user.click(within(created).getByRole('button', { name: /Operator/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'zwischen' }));
    expect(last()).toEqual([{ field: 'created_at', op: 'between', value: ['2026-10-28', '2026-10-28'] }]);
    const between = await findChip(/Angelegt zwischen 28\.10\.2026 und 28\.10\.2026/);
    await user.click(within(between).getByRole('button', { name: 'Angelegt bis: 28.10.2026' }));
    const popover = await screen.findByRole('dialog', { name: 'Angelegt bis' });
    await user.click(within(popover).getByRole('button', { name: /^Freitag, 30\. Oktober 2026/ }));
    expect(last()).toEqual([{ field: 'created_at', op: 'between', value: ['2026-10-28', '2026-10-30'] }]);
    await user.click(within(chip(/Angelegt/)).getByRole('button', { name: 'Angelegt von: 28.10.2026' }));
    const first = await screen.findByRole('dialog', { name: 'Angelegt von' });
    await user.click(within(within(first).getByRole('group', { name: 'Schnellauswahl' })).getByRole('button', { name: 'Heute' }));
    expect(last()).toEqual([{ field: 'created_at', op: 'between', value: ['today', '2026-10-30'] }]);
  });

  it('fills the other end of between with the first day chosen', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'start_date', op: 'between', value: [null, null] }));
    const start = await findChip(/Start-Date zwischen Datum wählen … und Datum wählen …, noch ohne Wert/);
    await user.click(within(start).getByRole('button', { name: 'Start-Date bis: kein Wert' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Start-Date bis' })).getByRole('button', { name: 'Dieser Monat' }));
    expect(last()).toEqual([{ field: 'start_date', op: 'between', value: ['this_month', 'this_month'] }]);
    await user.click(within(chip(/Start-Date/)).getByRole('button', { name: /Operator/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'ist leer' }));
    expect(last()).toEqual([{ field: 'start_date', op: 'is_empty' }]);
    expect(chip(/^Filter: Start-Date ist leer$/)).toBeTruthy();
    // and back: the value asked for again, in its popover
    await user.click(within(chip(/Start-Date/)).getByRole('button', { name: /Operator/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'vor' }));
    expect(await screen.findByRole('dialog', { name: 'Start-Date' })).toBeTruthy();
    await user.click(within(within(screen.getByRole('dialog', { name: 'Start-Date' })).getByRole('group', { name: 'Schnellauswahl' })).getByRole('button', { name: 'Heute' }));
    expect(last()).toEqual([{ field: 'start_date', op: 'before', value: 'today' }]);
  });

  it('parses 1.234,5 and refuses 1.500', async () => {
    const user = userEvent.setup();
    const { last } = renderBar(conditions({ field: 'property:effort', op: 'gt', value: 2.5 }));
    const effort = await findChip(/Aufwand \(h\) größer als 2,5/);
    const field = within(effort).getByRole('textbox', { name: 'Aufwand (h) größer als' });
    await user.clear(field);
    await user.type(field, '1.500{Enter}');
    expect(await screen.findByText('Mehrdeutig: 1500 oder 1,5? Schreib 1500 oder 1,5.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(last()).toBeUndefined();
    // a number past what the server takes says so (A152)
    await user.clear(field);
    await user.type(field, '100000000000000000000{Enter}');
    expect(await screen.findByText('Dem Betrag nach kleiner als 10²⁰')).toBeTruthy();
    expect(last()).toBeUndefined();
    // Escape takes the typing back
    await user.keyboard('{Escape}');
    expect((field as HTMLInputElement).value).toBe('2,5');
    await user.clear(field);
    await user.type(field, 'drei{Enter}');
    expect(screen.getByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeTruthy();
    await user.clear(field);
    await user.type(field, '1.234,5{Enter}');
    expect(last()).toEqual([{ field: 'property:effort', op: 'gt', value: 1234.5 }]);
    // leaving a field it cannot read keeps nothing
    await user.clear(field);
    await user.type(field, 'x');
    await user.tab();
    expect(last()).toEqual([{ field: 'property:effort', op: 'gt', value: 1234.5 }]);
  });

  it('filters by the text of a property, and a text needs one', async () => {
    const user = userEvent.setup();
    const { last } = renderBar();
    await addField(user, 'Notiz');
    const notes = await screen.findByRole('textbox', { name: 'Notiz enthält' });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    await user.keyboard('   {Enter}');
    expect(screen.getByText('Gib einen Text ein.')).toBeTruthy();
    await user.clear(notes);
    await user.keyboard(' Rückruf {Enter}');
    expect(last()).toEqual([{ field: 'property:notes', op: 'contains', value: 'Rückruf' }]);
    expect(chip(/^Filter: Notiz enthält „Rückruf“$/)).toBeTruthy();
    // Enter on the same text and leaving change nothing
    await user.keyboard('{Enter}');
    await user.tab();
    expect(last()).toEqual([{ field: 'property:notes', op: 'contains', value: 'Rückruf' }]);
  });

  it('names the values of yes or no, people and dates by kind', async () => {
    renderBar(
      conditions(
        { field: 'property:approved', op: 'is', value: false },
        { field: 'property:reviewer', op: 'in', value: ['u_mara', 'u_theo'] },
        { field: 'property:launch', op: 'is_not_empty' },
        { field: 'due_date', op: 'overdue' },
        { field: 'state', op: 'in', value: [] },
        { field: 'property:notes', op: 'is', value: '' },
        { field: 'property:effort', op: 'is' },
        { field: 'property:effort', op: 'between', value: [null, 4] },
      ),
    );
    expect(await findChip(/^Filter: Freigegeben ist nein$/)).toBeTruthy();
    expect(await findChip(/^Filter: Prüferin ist eines von Mara Lindqvist, Theo Okafor$/)).toBeTruthy();
    expect(chip(/^Filter: Livegang ist nicht leer$/)).toBeTruthy();
    expect(chip(/^Filter: Due-Date ist überfällig$/)).toBeTruthy();
    expect(chip(/^Filter: Status ist kein Wert, noch ohne Wert$/)).toBeTruthy();
    expect(chip(/^Filter: Notiz ist kein Wert, noch ohne Wert$/)).toBeTruthy();
    expect(chip(/^Filter: Aufwand \(h\) ist kein Wert, noch ohne Wert$/)).toBeTruthy();
    expect(chip(/^Filter: Aufwand \(h\) zwischen kein Wert und 4, noch ohne Wert$/)).toBeTruthy();
  });

  it('pauses the shortcuts of the page while a date popover is open', async () => {
    const user = userEvent.setup();
    renderBar(conditions({ field: 'due_date', op: 'is', value: 'today' }));
    await user.click(within(await findChip(/Due-Date ist heute/)).getByRole('button', { name: 'Due-Date: heute' }));
    await screen.findByRole('dialog', { name: 'Due-Date' });
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true })));
    expect(screen.queryByRole('dialog', { name: 'Feld der Bedingung' })).toBeNull();
  });
});
