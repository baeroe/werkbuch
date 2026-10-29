import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAIL_KEY } from '@/api/client';
import { getDb, saveDb } from '@/api/db';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { isWide } from '@/lib/media';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { useShellBindings } from './bindings';
import { CreateHost } from './CreateHost';

function Bindings() {
  useShellBindings();
  return null;
}

/** What `matchMedia('(min-width: 48rem)')` answers: a phone or a wider screen. */
const screenWidth = (wide: boolean) => {
  window.matchMedia = vi.fn((media: string) => ({
    matches: wide,
    media,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => Reflect.deleteProperty(window, 'matchMedia'));

describe('the md breakpoint', () => {
  it('counts a screen without matchMedia as wide, and otherwise asks for 48rem', () => {
    expect(isWide()).toBe(true);
    screenWidth(false);
    expect(isWide()).toBe(false);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)');
    screenWidth(true);
    expect(isWide()).toBe(true);
  });

  it('offers "Seitenleiste einklappen" on wide screens only, with the same default as the preview', () => {
    resetApi();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bindings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const sidebar = () => listCommands().find((command) => command.id === 'shell.sidebar');
    try {
      // jsdom has no matchMedia: wide, as PeekHost counts it
      expect(sidebar()?.when?.()).toBe(true);
      screenWidth(false);
      expect(sidebar()?.when?.()).toBe(false);
    } finally {
      view.unmount();
    }
  });
});

describe('"Vorlage anwenden …" in the palette', () => {
  beforeAll(async () => {
    // the create dialog holds the editor, which measures text jsdom does not lay out
    const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
    Range.prototype.getBoundingClientRect = empty;
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
    document.elementFromPoint = () => null;
    await preloadEditor();
  });

  beforeEach(() => {
    resetApi();
    useUiStore.setState(useUiStore.getInitialState());
  });

  afterEach(() => {
    act(() => resetToasts());
  });

  /** The shell's commands with the palette and the create dialog, as the shell mounts them. */
  function renderShell() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/my-items']}>
          <Bindings />
          <CommandPalette />
          <CreateHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const command = () => listCommands().find((entry) => entry.id === 'shell.template');

  /** mod+k (Strg+K in jsdom, which is no Mac), "Vorlage" and Enter: the command, chosen by keyboard only. */
  async function chooseCommand(user: ReturnType<typeof userEvent.setup>) {
    // the command waits for the templates, the projects and the rights
    await waitFor(() => expect(command()?.when?.()).toBe(true));
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox', { name: 'Suchen oder Befehl eingeben' });
    await user.keyboard('Vorlage{Enter}');
  }

  const optionTexts = (list: HTMLElement) => within(list).getAllByRole('option').map((option) => option.textContent ?? '');

  it('lists the templates of the projects where the person may create items, each with its project', async () => {
    const user = userEvent.setup();
    const view = renderShell();
    await chooseCommand(user);

    // Mara is org admin: the templates of all three projects, in the order of the projects
    const list = await screen.findByRole('listbox', { name: 'Vorlage anwenden …' });
    const texts = optionTexts(list);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain('Wöchentliche Wartung');
    expect(texts[0]).toContain('Website-Relaunch');
    expect(texts[1]).toContain('Monatsbericht');
    expect(texts[1]).toContain('Kunden-App');
    expect(texts[2]).toContain('Zertifikate prüfen');
    expect(texts[2]).toContain('Infrastruktur');
    view.unmount();
    act(() => useUiStore.setState(useUiStore.getInitialState()));

    // Theo only reads WEB (viewer) and does not see OPS: the template of APP, where he is admin, is left
    asUser('u_theo');
    renderShell();
    await chooseCommand(user);
    const his = await screen.findByRole('listbox', { name: 'Vorlage anwenden …' });
    expect(optionTexts(his)).toEqual([expect.stringContaining('Monatsbericht')]);
  });

  it('choosing a template opens the create dialog with its project and the template applied', async () => {
    const user = userEvent.setup();
    renderShell();
    await chooseCommand(user);
    await screen.findByRole('listbox', { name: 'Vorlage anwenden …' });

    await user.keyboard('Monats{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(useUiStore.getState().createDefaults).toEqual({ project_id: 'p_app', template_id: 'tpl_app_report' });
    // the dialog applies the template: its title (with the month filled in) and the toast that says so
    await waitFor(() => expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: /Titel/ }).value).toBe('Monatsbericht Oktober 2026'));
    expect(currentToasts().map((toast) => toast.title)).toContain('Vorlage „Monatsbericht“ angewendet');
  });

  it('says why instead of opening an empty list when the person may create items nowhere', async () => {
    // Theo reads WEB as a viewer; here he is a viewer in APP as well
    const db = getDb();
    db.project_members.find((member) => member.user_id === 'u_theo' && member.project_id === 'p_app')!.role = 'viewer';
    saveDb();
    asUser('u_theo');
    const user = userEvent.setup();
    renderShell();

    await chooseCommand(user);

    expect(screen.queryByRole('listbox', { name: 'Vorlage anwenden …' })).toBeNull();
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Keine Vorlage anwendbar', description: 'Items anlegen darfst du in keinem Projekt.' });
  });

  it('says that the templates did not load, and its "Erneut versuchen" brings the list', async () => {
    localStorage.setItem(FAIL_KEY, '1');
    const user = userEvent.setup();
    renderShell();

    await chooseCommand(user);

    const failure = currentToasts().at(-1)!;
    expect(failure).toMatchObject({ title: 'Vorlagen nicht geladen', tone: 'error', action: { label: 'Erneut versuchen' } });
    localStorage.removeItem(FAIL_KEY);
    act(() => runToastAction(failure.id));
    // the retry fetched the templates, the projects and the rights again: now the command has its list
    await waitFor(() => expect(command()?.subpage).toBeDefined());
  });

  it('says why as well when the projects where the person may create items have no template', async () => {
    const db = getDb();
    db.templates = db.templates.filter((template) => template.project_id === 'p_ops');
    saveDb();
    // Lene is a member of WEB and APP, and does not see OPS
    asUser('u_lene');
    const user = userEvent.setup();
    renderShell();

    await chooseCommand(user);

    expect(screen.queryByRole('listbox', { name: 'Vorlage anwenden …' })).toBeNull();
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Keine Vorlage anwendbar', description: expect.stringMatching(/^In den Projekten, in denen du Items anlegen darfst, gibt es noch keine Vorlage\./) });
  });
});
