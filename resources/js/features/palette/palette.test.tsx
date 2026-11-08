/*
 * The command palette as the shell mounts it (`PaletteHost` with the shell's commands from `useShellBindings`): what it
 * lists, how the keyboard moves through it, its sub-lists, the search hits after the commands, and where the focus goes
 * when it closes.
 */

import { router } from '@inertiajs/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { useCommand } from '@/lib/commands';
import { PaletteHost } from '@/shell/PaletteHost';
import { useShellBindings } from '@/shell/bindings';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, lene, list, makePage, makeView, makeWorkItem, mara, pageSummary, person, project, searchResults, standard, types, web47 } from '@/test/fixtures';
import type { Project, User } from '@/types';

const signedIn = vi.hoisted(() => ({ user: undefined as unknown }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn.user, permissions: [] } }, url: '/my-items' }),
  router: { visit: vi.fn() },
}));

let api: MockApi | undefined;
let projects: Project[] = [project('WEB', 'member')];
let searchRoute: MockRoute | undefined;

beforeEach(() => {
  signedIn.user = lene;
  useUiStore.setState(useUiStore.getInitialState());
  vi.mocked(router.visit).mockClear();
});

afterEach(() => {
  api?.restore();
  api = undefined;
  projects = [project('WEB', 'member')];
  searchRoute = undefined;
  act(() => resetToasts());
});

/** A screen with a command of its own, registered after the shell's. */
function ProjectsScreen() {
  useCommand({ id: 'projects.create', label: 'Neues Projekt', group: 'Projekte', run: () => {} });
  return <button type="button">Auf der Seite</button>;
}

function Shell() {
  useShellBindings();
  return (
    <>
      <ProjectsScreen />
      <PaletteHost />
    </>
  );
}

function renderShell() {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/templates': () => ({ body: list([]) }),
    ...(searchRoute && { 'GET /api/v1/search': searchRoute }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  );
}

const pressModK = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'k', ctrlKey: true });
const palette = () => screen.findByRole('dialog', { name: 'Befehlspalette' });
const input = () => screen.getByRole('combobox');
/** The label of a row, without its icon, shortcut and hint. */
const labelOf = (option: HTMLElement) => option.querySelector('.flex-1')!.textContent;
const labels = () => screen.getAllByRole('option').map(labelOf);
/** The groups of the list with the labels of their rows. */
const outline = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('group')
    .map((group) => [document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent, ...within(group).getAllByRole('option').map(labelOf)]);
const active = () => labelOf(screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')!);
/** The live region of the palette (the skeleton of a running search is a status of its own). */
const live = () => document.querySelector('p[role="status"]')!.textContent;
/** The queries the palette sent to the search, in order. */
const searched = () => api!.calls.filter((call) => call.url.startsWith('/api/v1/search')).map((call) => new URL(call.url, 'http://x').searchParams.get('q'));

/** Answers the search from a table of queries. */
const answers =
  (table: Record<string, Parameters<typeof searchResults>[0]>): MockRoute =>
  (_body, url) => ({ body: { data: searchResults(table[url.searchParams.get('q')!] ?? {}) } });

/** Holds every answer of the search until the test releases it by its query (after `renderShell`). */
function holdSearch() {
  const waiting = new Map<string, () => void>();
  const answering = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/v1/search') await new Promise<void>((resolve) => waiting.set(url.searchParams.get('q')!, resolve));
    return answering(input, init);
  };
  return { asked: (q: string) => waiting.has(q), release: (q: string) => act(() => waiting.get(q)!()) };
}

async function openPalette() {
  pressModK();
  await palette();
  await waitFor(() => expect(document.activeElement).toBe(input()));
}

const bot: User = { ...person('u_kira', 'Kira', 'kira'), type: 'bot' };

describe('CommandPalette', () => {
  it('opens on mod+k with the commands of the screen first', async () => {
    renderShell();
    // "Neues Item" waits for the rights
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));

    pressModK();
    const dialog = await palette();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    // "Neues Item" and "Vorlage anwenden …" wait for the rights, the latter for the templates as well
    await waitFor(() => expect(labels()).toContain('Vorlage anwenden …'));

    expect(outline()).toEqual([
      ['Projekte', 'Neues Projekt'],
      ['Aktionen', 'Neues Item', 'Vorlage anwenden …', 'Theme wechseln …', 'Seitenleiste einklappen', 'Alle Tastaturkürzel'],
      ['Navigation', 'Inbox öffnen', 'Meine Items öffnen', 'Alle Views öffnen', 'Alle Projekte öffnen'],
    ]);
    // with their shortcuts, and a chevron where a list opens
    const row = (name: RegExp) => within(dialog).getByRole('option', { name });
    expect(row(/^Neues Item/).querySelector('kbd')).not.toBeNull();
    expect(row(/^Theme/).querySelector('svg.lucide-chevron-right')).not.toBeNull();
    expect(active()).toBe('Neues Projekt');
    expect(within(dialog).getByText('Befehle findest du über ihren Namen, etwa „Theme“.')).toBeTruthy();
    expect(within(dialog).getByText('Ein Key wie WEB-47 springt direkt zum Item.')).toBeTruthy();
    expect(within(dialog).getByRole('listbox', { name: 'Befehle und Treffer' })).toBeTruthy();
    expect(input().getAttribute('placeholder')).toBe('Suchen oder Befehl …');

    // mod+k again closes it
    pressModK();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('starts in the sub-list of a command, goes back with Backspace and takes a choice', async () => {
    const user = userEvent.setup();
    renderShell();

    act(() => useUiStore.getState().openPalette('shell.theme'));
    await palette();
    const list = await screen.findByRole('combobox', { name: 'Theme wechseln …' });
    await waitFor(() => expect(document.activeElement).toBe(list));
    expect(list.getAttribute('placeholder')).toBe('Theme wählen …');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Systemaktiv', 'Hell', 'Dunkel']);
    expect(document.getElementById(screen.getByRole('group').getAttribute('aria-labelledby')!)!.className).toBe('sr-only');

    // Backspace in the empty input: back to all commands; the theme opens its list again from there
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('combobox', { name: 'Suchen oder Befehl eingeben' })).toBeTruthy();
    await user.keyboard('theme');
    expect(live()).toBe('Suche läuft …');
    await waitFor(() => expect(live()).toBe('Ein Treffer'));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Theme wechseln …' })).toBeTruthy();

    // the chip goes back as well
    await user.click(screen.getByRole('button', { name: 'Zurück zu allen Befehlen (Theme wechseln …)' }));
    expect(screen.getByRole('combobox', { name: 'Suchen oder Befehl eingeben' })).toBe(document.activeElement);
    await user.keyboard('dunkel{Enter}');
    expect(labels()).toEqual(['System', 'Hell', 'Dunkel']);

    // the words of a theme find it; Enter takes it and closes the palette
    await user.keyboard('nacht');
    expect(labels()).toEqual(['Dunkel']);
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().theme).toBe('dark');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => useUiStore.getState().setTheme('system'));
  });

  it('runs a navigation command and closes', async () => {
    const user = userEvent.setup();
    renderShell();

    pressModK();
    await palette();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await user.keyboard('alle projekte');

    // the hits are marked; the arrows move the active row and wrap around
    expect(outline()).toEqual([['Navigation', 'Alle Projekte öffnen']]);
    expect([...screen.getByRole('option').querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Alle', 'Projekte']);
    await user.keyboard('{Backspace>13/}öffnen');
    expect(active()).toBe('Inbox öffnen');
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe('Alle Projekte öffnen');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toBe('Meine Items öffnen');
    expect(input().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id);

    // an input method that composes keeps its Enter
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(router.visit).not.toHaveBeenCalled();

    // the pointer moves the active row too, and a click runs it
    fireEvent.mouseMove(screen.getByRole('option', { name: /Alle Views/ }));
    expect(active()).toBe('Alle Views öffnen');
    await user.click(screen.getByRole('option', { name: /Alle Projekte/ }));
    expect(router.visit).toHaveBeenCalledWith('/projects');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says there are no hits and shows the tips', async () => {
    const user = userEvent.setup();
    renderShell();

    await openPalette();
    await user.keyboard('xyz');
    expect(await screen.findByText('Keine Treffer für „xyz“')).toBeTruthy();
    expect(screen.getByText('Ein Key wie WEB-47 springt direkt zum Item.')).toBeTruthy();
    expect(screen.getByText('Befehle findest du über ihren Namen, etwa „Theme“.')).toBeTruthy();
    expect(live()).toBe('0 Treffer');
    // the arrows and Enter have nothing to do
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();

    // in a sub-list it says what was typed
    await user.keyboard('{Backspace>3/}theme');
    await waitFor(() => expect(labels()).toEqual(['Theme wechseln …']));
    await user.keyboard('{Enter}xyz');
    expect(screen.getByText('Nichts passt zu „xyz“.')).toBeTruthy();
  });

  it('restores the focus on escape', async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Auf der Seite' });
    trigger.focus();

    pressModK();
    await palette();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('search', () => {
  it('shows hits a moment after typing and opens an item with Enter', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ kontakt: { items: [web47] } });
    renderShell();

    await openPalette();
    await user.keyboard('kontakt');
    const row = await screen.findByRole('option', { name: /Kontaktformular sendet doppelt/ });
    // one question for the last key, not one per key, for no more hits than the palette shows
    expect(searched()).toEqual(['kontakt']);
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/search')).map((call) => new URL(call.url, 'http://x').searchParams.get('limit'))).toEqual(['8']);
    expect(outline()).toEqual([['Items', 'Kontaktformular sendet doppelt']]);
    expect(row.textContent).toContain('WEB-47');
    expect([...row.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Kontakt']);
    // its type in its tone, its state beside it
    const state = standard.states.find((entry) => entry.id === web47.state_id)!;
    await waitFor(() => expect(row.textContent).toContain(state.name));
    expect(row.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe(types.find((type) => type.id === web47.type_id)!.tone);

    await user.keyboard('{Enter}');
    expect(router.visit).toHaveBeenCalledWith('/items/WEB-47');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('jumps to a typed key with Enter before the search answers', async () => {
    const user = userEvent.setup();
    renderShell();
    const search = holdSearch();

    await openPalette();
    await user.keyboard('web-47');
    expect(outline()[0]).toEqual(['Items', 'WEB-47 öffnen']);
    expect(active()).toBe('WEB-47 öffnen');
    await user.keyboard('{Enter}');

    expect(router.visit).toHaveBeenCalledWith('/items/WEB-47');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(search.asked('web-47')).toBe(false);
  });

  it('puts the item a former key names first, in place of the jump', async () => {
    const user = userEvent.setup();
    const moved = makeWorkItem({ id: 'wi_new_12', key: 'NEW-12', title: 'Umgezogen' });
    searchRoute = answers({ 'old-12': { items: [moved], key_match: 'wi_new_12' } });
    renderShell();

    await openPalette();
    await user.keyboard('old-12');
    await screen.findByRole('option', { name: /Umgezogen/ });
    expect(outline()[0]).toEqual(['Items', 'Umgezogen']);
    await user.keyboard('{Enter}');
    expect(router.visit).toHaveBeenCalledWith('/items/NEW-12');
  });

  it('jumps to the key typed now, not to the item the last answer matched', async () => {
    const user = userEvent.setup();
    const web48 = makeWorkItem({ id: 'wi_web_48', key: 'WEB-48', title: 'Footer verrutscht' });
    searchRoute = answers({ 'web-47': { items: [web47], key_match: web47.id }, 'web-48': { items: [web48], key_match: web48.id } });
    renderShell();
    const search = holdSearch();

    await openPalette();
    await user.keyboard('web-47');
    await waitFor(() => expect(search.asked('web-47')).toBe(true));
    search.release('web-47');
    await waitFor(() => expect(outline()[0]).toEqual(['Items', 'Kontaktformular sendet doppelt']));

    // the answer to web-47 stays while web-48 is on its way: its match no longer leads
    await user.keyboard('{Backspace}8');
    expect(outline()[0]).toEqual(['Items', 'WEB-48 öffnen', 'Kontaktformular sendet doppelt']);
    await waitFor(() => expect(search.asked('web-48')).toBe(true));
    expect(outline()[0]).toEqual(['Items', 'WEB-48 öffnen', 'Kontaktformular sendet doppelt']);
    search.release('web-48');
    await waitFor(() => expect(outline()[0]).toEqual(['Items', 'Footer verrutscht']));
    await user.keyboard('{Enter}');
    expect(router.visit).toHaveBeenCalledWith('/items/WEB-48');
  });

  it('keeps the hits of the newer query when an older answer arrives late', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ kon: { items: [makeWorkItem({ id: 'wi_konf', key: 'WEB-9', title: 'Konferenz planen' })] }, kontakt: { items: [web47] } });
    renderShell();
    const search = holdSearch();

    await openPalette();
    await user.keyboard('kon');
    await waitFor(() => expect(search.asked('kon')).toBe(true));
    await user.keyboard('takt');
    await waitFor(() => expect(search.asked('kontakt')).toBe(true));

    search.release('kontakt');
    await screen.findByRole('option', { name: /Kontaktformular/ });
    search.release('kon');
    await waitFor(() => expect(searched()).toEqual(['kontakt', 'kon']));
    // let the late answer land
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(labels()).toEqual(['Kontaktformular sendet doppelt']);
  });

  it('names the new hit as the active one when it takes the place of the last', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ kon: { items: [makeWorkItem({ id: 'wi_konf', key: 'WEB-9', title: 'Konferenz planen' })] }, kontakt: { items: [web47] } });
    renderShell();
    const activeRow = () => document.getElementById(input().getAttribute('aria-activedescendant')!)!.textContent;

    await openPalette();
    await user.keyboard('kon');
    await screen.findByRole('option', { name: /Konferenz planen/ });
    await waitFor(() => expect(activeRow()).toContain('Konferenz planen'));
    const before = input().getAttribute('aria-activedescendant');

    await user.keyboard('takt');
    await screen.findByRole('option', { name: /Kontaktformular/ });
    await waitFor(() => expect(activeRow()).toContain('Kontaktformular sendet doppelt'));
    expect(input().getAttribute('aria-activedescendant')).not.toBe(before);
  });

  it('says it is searching and then how many hits there are', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ kontakt: { items: [web47, makeWorkItem({ id: 'wi_ops', key: 'OPS-3', title: 'Kontakt-Mails hängen' })] } });
    renderShell();
    const search = holdSearch();

    await openPalette();
    await user.keyboard('kontakt');
    expect(live()).toBe('Suche läuft …');
    // nothing to show yet: a skeleton says the same, after a moment
    await waitFor(() => expect(within(screen.getByRole('dialog')).getAllByRole('status').map((status) => status.textContent)).toEqual(['Suche läuft …', 'Suche läuft …']));

    await waitFor(() => expect(search.asked('kontakt')).toBe(true));
    search.release('kontakt');
    await waitFor(() => expect(live()).toBe('2 Treffer'));
    expect(within(screen.getByRole('dialog')).getAllByRole('status')).toHaveLength(1);
  });

  it('shows the error with Try again and still jumps to a typed key', async () => {
    const user = userEvent.setup();
    searchRoute = () => ({ status: 503, body: { reason: 'search_unavailable', detail: 'Die Suche ist gerade nicht erreichbar.' } });
    renderShell();

    await openPalette();
    await user.keyboard('kontakt');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Die Suche hat nicht geantwortet: Die Suche ist gerade nicht erreichbar.');
    expect(screen.queryByText(/Keine Treffer/)).toBeNull();
    // the alert speaks: the live region names no count beside it
    expect(live()).toBe('');

    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(searched()).toEqual(['kontakt', 'kontakt']));

    // a typed key still jumps
    await user.click(input());
    await user.keyboard('{Backspace>7/}web-47');
    expect(outline()[0]).toEqual(['Items', 'WEB-47 öffnen']);
    await user.keyboard('{Enter}');
    expect(router.visit).toHaveBeenCalledWith('/items/WEB-47');
  });

  it('cuts a long query to what the search takes', async () => {
    const user = userEvent.setup();
    renderShell();

    await openPalette();
    fireEvent.change(input(), { target: { value: `${'ä'.repeat(254)}😀😀` } });
    await waitFor(() => expect(searched()).toHaveLength(1));
    expect([...searched()[0]!]).toHaveLength(255);
    expect(searched()[0]!.endsWith('ä😀')).toBe(true);
    await user.keyboard('{Escape}');
  });

  it('shows the commands again when the input is emptied', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ kontakt: { items: [web47] } });
    renderShell();

    await openPalette();
    await user.keyboard('kontakt');
    await screen.findByRole('option', { name: /Kontaktformular/ });
    await user.keyboard('{Backspace>7/}');
    expect(labels()).toContain('Theme wechseln …');
    expect(labels()).not.toContain('Kontaktformular sendet doppelt');
    expect(live()).toBe('');
  });

  it('opens a project, a view, a person and a bot', async () => {
    const user = userEvent.setup();
    signedIn.user = mara;
    const website = project('WEB', 'admin', { name: 'Feldwerk Website' });
    searchRoute = answers({ feld: { projects: [website], views: [makeView({ id: 'v_feld', name: 'Feldwerk-Bugs' })], people: [ida, bot] } });
    renderShell();
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));

    const open = async (name: string) => {
      await openPalette();
      await user.keyboard('feld');
      await waitFor(() => expect(labels()).toContain('Kira'));
      await user.click(screen.getByRole('option', { name: new RegExp(name) }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      return vi.mocked(router.visit).mock.calls.at(-1)![0];
    };

    await openPalette();
    await user.keyboard('feld');
    await waitFor(() => expect(labels()).toContain('Kira'));
    expect(outline()).toEqual([
      ['Projekte', 'Feldwerk Website'],
      ['Personen', 'Ida Brenner', 'Kira'],
      ['Views', 'Feldwerk-Bugs'],
    ]);
    expect(screen.getByRole('option', { name: /Feldwerk Website/ }).textContent).toContain('WEB');
    expect(screen.getByRole('option', { name: /Ida/ }).textContent).toContain('@ida');
    expect(screen.getByRole('option', { name: /Kira/ }).textContent).toContain('Bot');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(await open('Feldwerk Website')).toBe('/projects/WEB');
    expect(await open('Feldwerk-Bugs')).toBe('/views/v_feld');
    expect(await open('Ida Brenner')).toBe('/settings/people');
    expect(await open('Kira')).toBe('/settings/bots');
  });

  it('opens a page from the results', async () => {
    const user = userEvent.setup();
    const structure = pageSummary(makePage({ id: 'pg_web_structure', title: 'Seitenstruktur', emoji: '🧭' }));
    // a page of a project the cached list does not hold (yet): its id leads there, the server names the identifier
    const elsewhere = pageSummary(makePage({ id: 'pg_new_start', project_id: 'p_new', title: 'Struktur im neuen Projekt' }));
    searchRoute = answers({ struktur: { items: [web47], pages: [structure, elsewhere] } });
    renderShell();
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));

    await openPalette();
    await user.keyboard('struktur');
    const row = await screen.findByRole('option', { name: /Seitenstruktur/ });
    expect(outline()).toEqual([
      ['Items', 'Kontaktformular sendet doppelt'],
      ['Seiten', 'Seitenstruktur', 'Struktur im neuen Projekt'],
    ]);
    // its emoji (decorative), its title, where it lives (as in flow 5 of the clickdummy)
    await waitFor(() => expect(row.textContent).toBe('🧭SeitenstrukturWiki WEB'));
    expect(row.querySelector('[aria-hidden="true"]')!.textContent).toBe('🧭');
    expect([...row.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['struktur']);
    // the hits of both kinds count
    await waitFor(() => expect(live()).toBe('3 Treffer'));

    await user.keyboard('{ArrowDown}');
    expect(active()).toBe('Seitenstruktur');
    await user.keyboard('{Enter}');
    expect(router.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_structure');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await openPalette();
    await user.keyboard('struktur');
    await user.click(await screen.findByRole('option', { name: /Struktur im neuen Projekt/ }));
    expect(router.visit).toHaveBeenLastCalledWith('/projects/p_new/wiki/pg_new_start');
  });

  it('shows a member no people', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ feld: { projects: [project('WEB', 'member', { name: 'Feldwerk Website' })], people: [ida, bot] } });
    renderShell();
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));

    await openPalette();
    await user.keyboard('feld');
    await screen.findByRole('option', { name: /Feldwerk Website/ });
    expect(outline()).toEqual([['Projekte', 'Feldwerk Website']]);
  });

  it('does not search in a sub-list', async () => {
    const user = userEvent.setup();
    renderShell();

    act(() => useUiStore.getState().openPalette('shell.theme'));
    const list = await screen.findByRole('combobox', { name: 'Theme wechseln …' });
    await waitFor(() => expect(document.activeElement).toBe(list));
    await user.keyboard('dunkel');
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(labels()).toEqual(['Dunkel']);
    expect(searched()).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('searches over a list with its item commands', async () => {
    const user = userEvent.setup();
    searchRoute = answers({ status: { items: [makeWorkItem({ id: 'wi_status', key: 'WEB-5', title: 'Status-Seite lädt langsam' })] } });
    function ItemScreen() {
      useCommand({ id: 'item.state', label: 'Status ändern …', group: 'Aktionen für WEB-47', run: () => {} });
      return null;
    }
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list(projects) }), 'GET /api/v1/search': searchRoute });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ItemScreen />
        <PaletteHost />
      </QueryClientProvider>,
    );

    await openPalette();
    await user.keyboard('status');
    await screen.findByRole('option', { name: /Status-Seite/ });
    expect(outline()).toEqual([
      ['Aktionen für WEB-47', 'Status ändern …'],
      ['Items', 'Status-Seite lädt langsam'],
    ]);
    expect(active()).toBe('Status ändern …');
  });
});

describe('new item', () => {
  it('opens the create dialog with c, once, and says why without the right', async () => {
    renderShell();
    const press = () => fireEvent.keyDown(document.body, { key: 'c' });

    // the rights are still loading: "c" says so instead of opening
    press();
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Kein neues Item möglich', tone: 'error' });
    await waitFor(() => {
      press();
      expect(useUiStore.getState().createOpen).toBe(true);
    });
    // already open: a second "c" changes nothing
    act(() => useUiStore.setState({ createDefaults: { title: 'Angefangen' } }));
    press();
    expect(useUiStore.getState().createDefaults).toEqual({ title: 'Angefangen' });
  });

  it('leaves "Neues Item" out of the palette where no project allows it', async () => {
    projects = [project('WEB', 'viewer')];
    renderShell();
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));

    act(() => useUiStore.getState().setPaletteOpen(true));
    await palette();
    await waitFor(() => expect(labels()).toContain('Theme wechseln …'));
    expect(labels()).not.toContain('Neues Item');
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
});
