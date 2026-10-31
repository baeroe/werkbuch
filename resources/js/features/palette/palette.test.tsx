/*
 * The command palette as the shell mounts it (`PaletteHost` with the shell's commands from `useShellBindings`): what it
 * lists, how the keyboard moves through it, its sub-lists, and where the focus goes when it closes.
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
import { mockApi, type MockApi } from '@/test/api';
import { lene, list, project } from '@/test/fixtures';
import type { Project } from '@/types';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] } }, url: '/my-items' }),
  router: { visit: vi.fn() },
}));

let api: MockApi | undefined;
let projects: Project[] = [project('WEB', 'member')];

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
  vi.mocked(router.visit).mockClear();
});

afterEach(() => {
  api?.restore();
  api = undefined;
  projects = [project('WEB', 'member')];
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
  api = mockApi({ 'GET /api/v1/projects': () => ({ body: list(projects) }) });
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

describe('CommandPalette', () => {
  it('opens on mod+k with the commands of the screen first', async () => {
    renderShell();
    // "Neues Item" waits for the rights
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));

    pressModK();
    const dialog = await palette();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await waitFor(() => expect(labels()).toContain('Neues Item'));

    expect(outline()).toEqual([
      ['Projekte', 'Neues Projekt'],
      ['Aktionen', 'Neues Item', 'Theme wechseln …'],
      ['Navigation', 'Inbox öffnen', 'Meine Items öffnen', 'Alle Views öffnen', 'Alle Projekte öffnen'],
    ]);
    // with their shortcuts, and a chevron where a list opens
    const row = (name: RegExp) => within(dialog).getByRole('option', { name });
    expect(row(/^Neues Item/).querySelector('kbd')).not.toBeNull();
    expect(row(/^Theme/).querySelector('svg.lucide-chevron-right')).not.toBeNull();
    expect(active()).toBe('Neues Projekt');
    expect(within(dialog).getByText('Befehle findest du über ihren Namen, etwa „Theme“.')).toBeTruthy();

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
    expect(screen.getByRole('combobox', { name: 'Befehl eingeben' })).toBeTruthy();
    await user.keyboard('theme');
    expect(screen.getByRole('status').textContent).toBe('Ein Treffer');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Theme wechseln …' })).toBeTruthy();

    // the chip goes back as well
    await user.click(screen.getByRole('button', { name: 'Zurück zu allen Befehlen (Theme wechseln …)' }));
    expect(screen.getByRole('combobox', { name: 'Befehl eingeben' })).toBe(document.activeElement);
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

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    renderShell();

    pressModK();
    await palette();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await user.keyboard('xyz');
    expect(screen.getByText('Keine Befehle gefunden')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('0 Treffer');
    // the arrows and Enter have nothing to do
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();

    // in a sub-list it says what was typed
    await user.keyboard('{Backspace>3/}theme{Enter}xyz');
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
