import { router } from '@inertiajs/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as renderDom, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { drafts } from '@/lib/drafts';
import { useUiStore } from '@/store/ui';
import { expectLabelInName } from '@/test/a11y';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, makeView, project } from '@/test/fixtures';
import { pauseLive } from '@/api/live';
import { ProfileMenu } from './ProfileMenu';
import { Shell } from './Shell';

// What the server flashed shows as a toast once per visit: a status as a success, an error as an error. The browser suite cannot provoke a flashed
// error inside the shell (a refused request needs a stale CSRF token, which a same-origin browser never sends).

type Flash = { status: string | null; error: string | null };
let flash: Flash = { status: null, error: null };
let url = '/my-items';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({
    props: { auth: { user: { id: '1', type: 'person', name: 'Mara Lindqvist', handle: 'mara', email: null, locale: 'de', timezone: null, avatar_url: null }, permissions: [] }, flash, features: { mail: true, live: null } },
    url,
  }),
  router: { visit: vi.fn(), post: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const live = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock('@/api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/live')>()), pauseLive: vi.fn(() => live.resume) }));

let api: MockApi | undefined;
let client: QueryClient;
let routes: Record<string, MockRoute>;

const web = project('WEB', 'member', { id: 'p_web', name: 'Website-Relaunch' });
const app = project('APP', 'admin', { id: 'p_app', name: 'Kunden-App' });
const old = project('OLD', 'admin', { id: 'p_old', name: 'Altes Projekt', archived_at: '2026-10-01T10:00:00.000Z' });
const favorite = (id: string, position: number) => ({ user_id: '1', kind: 'project', id, position });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  routes = {
    'GET /api/v1/projects': () => ({ body: list([web, app]) }),
    'GET /api/v1/favorites': () => ({ body: list([]) }),
    'GET /api/v1/views': () => ({ body: list([]) }),
    'GET /api/v1/notifications': () => ({ body: list([], 0) }),
  };
  vi.mocked(router.post).mockClear();
  useUiStore.setState(useUiStore.getInitialState());
});

/** The shell with the data it reads (favorites, projects) from a fake API: `routes` as the test set them. */
function render(element: ReactElement) {
  api = mockApi(routes);
  const result = renderDom(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...result, rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => resetToasts());
  flash = { status: null, error: null };
  url = '/my-items';
  api?.restore();
  api = undefined;
});

/** The error toasts with how often each was shown again (the same error refreshes the toast on screen). */
const errors = () => currentToasts().filter((item) => item.tone === 'error').map((item) => [item.title, item.round]);
const successes = () => currentToasts().filter((item) => item.tone === 'success').map((item) => item.title);

describe('Shell', () => {
  it('shows a flashed error as a toast once per visit', () => {
    flash = { status: null, error: 'Die Seite ist abgelaufen.' };
    const { rerender } = render(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 0]]);

    // the same visit renders again: the toast is not shown again
    rerender(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 0]]);

    // the next visit brings a new flash, even with the same text: shown again
    flash = { status: null, error: 'Die Seite ist abgelaufen.' };
    rerender(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 1]]);
  });

  it('shows a flashed status as a success toast once per visit', () => {
    flash = { status: 'Willkommen, Lea.', error: null };
    const { rerender } = render(<Shell>Inhalt</Shell>);
    expect(successes()).toEqual(['Willkommen, Lea.']);
    expect(errors()).toEqual([]);

    // the same visit renders again: the toast is not shown again
    rerender(<Shell>Inhalt</Shell>);
    expect(successes()).toEqual(['Willkommen, Lea.']);

    // dismissed meanwhile, the same flash object does not bring it back
    act(() => resetToasts());
    rerender(<Shell>Inhalt</Shell>);
    expect(successes()).toEqual([]);
  });

  it('links the gear straight to the first section of the settings, marked on every section', () => {
    const { unmount } = render(<Shell>Inhalt</Shell>);
    const gear = () => screen.getAllByRole('link', { name: 'Einstellungen der Organisation' })[0]!;
    expect(gear().getAttribute('href')).toBe('/settings/general');
    expect(gear().getAttribute('aria-current')).toBeNull();
    unmount();

    url = '/settings/people';
    render(<Shell>Inhalt</Shell>);
    expect(gear().getAttribute('aria-current')).toBe('page');
  });

  it('keeps the drawer open when only the query of the address changes, and closes it on a new path', async () => {
    url = '/projects/WEB?layout=board';
    const { rerender } = render(<Shell>Inhalt</Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeTruthy();

    // the list writes its state into the query (a canonical address, a parameter taken out): the drawer stays
    url = '/projects/WEB?layout=table';
    rerender(<Shell>Inhalt</Shell>);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy();

    // a link to another page closes it
    url = '/inbox';
    rerender(<Shell>Inhalt</Shell>);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
  });

  it('closes the drawer on a link chosen in it, also one to the page it is on', async () => {
    url = '/my-items';
    render(<Shell>Inhalt</Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Meine Items' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
  });

  it('keeps the drawer open on a link opened in a new tab or window (20b-M6)', async () => {
    url = '/my-items';
    render(<Shell>Inhalt</Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    const link = within(drawer).getByRole('link', { name: 'Meine Items' });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { button: 1 });
    await act(async () => {});
    expect(screen.getByRole('dialog', { name: 'Navigation' }).hasAttribute('data-ending-style')).toBe(false);
    // a plain click still closes it
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
  });

  it('shows nothing when the visit flashed nothing', () => {
    render(<Shell>Inhalt</Shell>);

    expect(screen.getByText('Inhalt')).toBeTruthy();
    expect(errors()).toEqual([]);
    expect(successes()).toEqual([]);
  });
});

describe('Inbox badge', () => {
  /** The inbox answers `total` unread notifications to the badge (a page of one row). */
  const unread = (total: number) => {
    routes['GET /api/v1/notifications'] = () => ({ body: list([], total) });
  };
  const inboxLinks = () => screen.getAllByRole('link', { name: /^Inbox/ });

  it('shows the unread count on the inbox in the sidebar, the rail and the mobile bar', async () => {
    unread(3);
    render(<Shell>Inhalt</Shell>);
    const header = screen.getByRole('banner');

    // the sidebar and the phone bar: the name says it, the badge shows it
    const full = await within(sidebar()).findByRole('link', { name: 'Inbox, 3 ungelesen' });
    // the word and the count stay two words for anyone reading the text (WCAG 2.5.3)
    expect(full.textContent).toBe('Inbox 3');
    expectLabelInName(full);
    expect(full.getAttribute('href')).toBe('/inbox');
    const bar = within(header).getByRole('link', { name: 'Inbox, 3 ungelesen' });
    expect(bar.textContent).toBe('3');
    expectLabelInName(bar);
    // the badge is a picture of the name: read once, through the link
    expect(full.querySelector('[data-inbox-badge]')?.getAttribute('aria-hidden')).toBe('true');

    // the rail
    act(() => useUiStore.getState().toggleSidebar());
    const rail = await within(sidebar()).findByRole('link', { name: 'Inbox, 3 ungelesen' });
    expect(rail.textContent).toBe('3');
    expectLabelInName(rail);

    // the count follows the inbox: `notifications.changed` makes it stale, the badge asks again (Task 14)
    unread(4);
    await act(() => client.invalidateQueries({ queryKey: ['notifications'] }));
    expect(await within(sidebar()).findByRole('link', { name: 'Inbox, 4 ungelesen' })).toBe(within(sidebar()).getByRole('link', { name: /^Inbox/ }));
    expect(within(header).getByRole('link', { name: 'Inbox, 4 ungelesen' }).textContent).toBe('4');
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/notifications')).map((call) => call.url)).toContain('/api/v1/notifications?per_page=1&filter%5Bunread%5D=1');
  });

  it('hides the badge at zero and says 99+ above 99', async () => {
    render(<Shell>Inhalt</Shell>);
    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/notifications'))).toBe(true));
    // nothing unread: no badge, the plain name
    await waitFor(() => expect(inboxLinks().map((link) => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['Inbox', 'Inbox']));
    expect(document.querySelector('[data-inbox-badge]')).toBeNull();

    unread(120);
    await act(() => client.invalidateQueries({ queryKey: ['notifications'] }));
    // the name says what the badge shows, and keeps the whole number
    const many = 'Inbox, 99+ ungelesen (insgesamt 120)';
    const full = await within(sidebar()).findByRole('link', { name: many });
    expect(full.querySelector('[data-inbox-badge]')?.textContent).toBe('99+');
    expectLabelInName(full);
    const bar = within(screen.getByRole('banner')).getByRole('link', { name: many });
    expect(bar.textContent).toBe('99+');
    expectLabelInName(bar);
    act(() => useUiStore.getState().toggleSidebar());
    const rail = await within(sidebar()).findByRole('link', { name: many });
    expect(rail.textContent).toBe('99+');
    expectLabelInName(rail);
  });
});

describe('Search', () => {
  it('opens the palette with / outside lists', async () => {
    render(<Shell>Inhalt</Shell>);

    await userEvent.keyboard('/');

    expect(useUiStore.getState().paletteOpen).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Befehlspalette' })).toBeTruthy();
  });

  it('opens the palette from the search button of the sidebar, of the rail and of the phone bar', async () => {
    render(<Shell>Inhalt</Shell>);
    const close = () => act(() => useUiStore.getState().setPaletteOpen(false));

    const full = within(sidebar()).getByRole('button', { name: 'Suchen …' });
    expect(full.getAttribute('aria-keyshortcuts')).toBe(ariaKeyshortcuts('mod+k'));
    await userEvent.click(full);
    expect(useUiStore.getState().paletteOpen).toBe(true);
    close();

    // the phone bar: the one way into the palette there
    const header = screen.getByRole('banner');
    await userEvent.click(within(header).getByRole('button', { name: 'Suchen' }));
    expect(useUiStore.getState().paletteOpen).toBe(true);
    close();

    act(() => useUiStore.getState().toggleSidebar());
    const rail = within(sidebar()).getByRole('button', { name: 'Suchen' });
    expect(rail.getAttribute('aria-keyshortcuts')).toBe(ariaKeyshortcuts('mod+k'));
    await userEvent.click(rail);
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });

  it('closes the drawer before the palette opens over the page', async () => {
    render(<Shell>Inhalt</Shell>);
    const menu = screen.getByRole('button', { name: 'Navigation öffnen' });
    await userEvent.click(menu);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });

    await userEvent.click(within(drawer).getByRole('button', { name: 'Suchen …' }));

    // one modal dialog at a time: the palette, never over the drawer
    const palette = await screen.findByRole('dialog', { name: 'Befehlspalette' });
    // (the palette hides the rest of the page from the tree: count the hidden too)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation', hidden: true })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(palette).getByRole('combobox')));
  });

  it('lists Alle Tastaturkürzel and the sidebar toggle in the palette', () => {
    render(<Shell>Inhalt</Shell>);
    const command = (id: string) => listCommands().find((entry) => entry.id === id)!;

    const help = command('shell.help');
    expect([help.label, help.group, help.keys, help.keywords]).toEqual(['Alle Tastaturkürzel', 'Aktionen', '?', ['hilfe kürzel tastatur']]);
    act(() => help.run());
    expect(useUiStore.getState().helpOpen).toBe(true);

    expect(command('shell.sidebar').label).toBe('Seitenleiste einklappen');
    expect(command('shell.sidebar').when!()).toBe(true);
    act(() => command('shell.sidebar').run());
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(command('shell.sidebar').label).toBe('Seitenleiste ausklappen');

    // below md the sidebar is a drawer behind the menu button: no toggle in the palette
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    expect(command('shell.sidebar').when!()).toBe(false);
  });
});

/** The sidebar of the desktop (the drawer of the phone holds the same content, but only while open). */
const sidebar = () => screen.getAllByRole('navigation', { name: 'Seitenleiste' })[0]!;

describe('Sidebar projects', () => {
  it('lists the starred projects in the order of the favorites, without archived ones, and opens the current one', async () => {
    url = '/projects/APP/settings/members';
    routes['GET /api/v1/projects'] = () => ({ body: list([web, app, old]) });
    routes['GET /api/v1/favorites'] = () => ({ body: list([favorite('p_app', 0), favorite('p_old', 1), favorite('p_web', 2)]) });
    render(<Shell>Inhalt</Shell>);

    const nav = sidebar();
    const apps = await within(nav).findByRole('button', { name: 'Kunden-App' });
    const webs = within(nav).getByRole('button', { name: 'Website-Relaunch' });
    expect(apps.compareDocumentPosition(webs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).queryByText('Altes Projekt')).toBeNull();

    // the project of the page is open, with its settings marked
    expect(apps.getAttribute('aria-expanded')).toBe('true');
    expect(within(nav).getByRole('link', { name: 'Einstellungen' }).getAttribute('href')).toBe('/projects/APP/settings');
    expect(within(nav).getByRole('link', { name: 'Einstellungen' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Items' }).getAttribute('href')).toBe('/projects/APP');
    expect(within(nav).getByRole('link', { name: 'Wiki' }).getAttribute('href')).toBe('/projects/APP/wiki');
    expect(within(nav).getByRole('link', { name: 'Vorlagen' }).getAttribute('href')).toBe('/projects/APP/templates');
    expect(webs.getAttribute('aria-expanded')).toBe('false');

    // the chevron opens and closes a project
    await userEvent.click(webs);
    expect(webs.getAttribute('aria-expanded')).toBe('true');
    expect(within(nav).getAllByRole('link', { name: 'Einstellungen' })).toHaveLength(2);
    await userEvent.click(apps);
    expect(apps.getAttribute('aria-expanded')).toBe('false');

    // the sidebar and the rights share one list of the projects
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/projects')).map((call) => call.url)).toEqual(['/api/v1/projects?include_archived=1']);
  });

  it('says so while nothing is starred, and links "Create project" to the dialog', async () => {
    render(<Shell>Inhalt</Shell>);

    const nav = sidebar();
    expect(await within(nav).findByText('Projekte mit Stern stehen hier.')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Projekt anlegen' }).getAttribute('href')).toBe('/projects?create=1');
  });

  it('shows the projects as loading until favorites and projects are there', async () => {
    render(<Shell>Inhalt</Shell>);

    expect(within(sidebar()).getByText('Projekte werden geladen …')).toBeTruthy();
    expect(await within(sidebar()).findByText('Projekte mit Stern stehen hier.')).toBeTruthy();
  });

  it('says when the projects could not be loaded and loads them again on request', async () => {
    let fail = true;
    routes['GET /api/v1/favorites'] = () => (fail ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable' } } : { body: list([favorite('p_web', 0)]) });
    render(<Shell>Inhalt</Shell>);

    // the favorites fail for the views as well: the retry of the projects is the one of their section
    const nav = within(sidebar()).getByRole('region', { name: 'Projekte' });
    expect(await within(nav).findByText('Projekte nicht geladen.')).toBeTruthy();
    fail = false;
    await userEvent.click(within(nav).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(nav).findByRole('button', { name: 'Website-Relaunch' })).toBeTruthy();
  });
});

describe('Sidebar views', () => {
  const roadmap = makeView({ id: 'v_roadmap', name: 'Roadmap', icon: 'route' });
  const kira = makeView({ id: 'v_kira', name: 'Für Kira', icon: '🤖' });
  const view = (id: string, position: number) => ({ user_id: '1', kind: 'view', id, position });

  it('lists the starred views in the order of the sidebar', async () => {
    url = '/views/v_roadmap';
    routes['GET /api/v1/views'] = () => ({ body: list([kira, roadmap, makeView()]) });
    // a view that is gone is not among the views any more (the server leaves its favorite out as well)
    routes['GET /api/v1/favorites'] = () => ({ body: list([view('v_roadmap', 0), favorite('p_web', 1), view('v_gone', 2), view('v_kira', 3)]) });
    render(<Shell>Inhalt</Shell>);

    const nav = sidebar();
    const section = within(nav).getByRole('region', { name: 'Views' });
    const first = await within(section).findByRole('link', { name: 'Roadmap' });
    expect(within(section).getAllByRole('link').map((link) => [link.getAttribute('aria-label') ?? link.textContent, link.getAttribute('href')])).toEqual([
      ['View anlegen', '/views?create=1'],
      ['Roadmap', '/views/v_roadmap'],
      ['🤖Für Kira', '/views/v_kira'],
      ['Alle Views', '/views'],
    ]);
    // the view of the page is marked; "Fällig diese Woche" has no star
    expect(first.getAttribute('aria-current')).toBe('page');
    expect(within(section).queryByText('Fällig diese Woche')).toBeNull();
  });

  it('says so while no view is starred', async () => {
    render(<Shell>Inhalt</Shell>);

    expect(within(sidebar()).getByText('Views werden geladen …')).toBeTruthy();
    expect(await within(sidebar()).findByText('Views mit Stern stehen hier.')).toBeTruthy();
  });

  it('says when the views could not be loaded', async () => {
    let fail = true;
    routes['GET /api/v1/views'] = () => (fail ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable' } } : { body: list([roadmap]) });
    routes['GET /api/v1/favorites'] = () => ({ body: list([view('v_roadmap', 0)]) });
    render(<Shell>Inhalt</Shell>);

    const section = within(sidebar()).getByRole('region', { name: 'Views' });
    expect(await within(section).findByText('Views nicht geladen.')).toBeTruthy();
    fail = false;
    await userEvent.click(within(section).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(section).findByRole('link', { name: 'Roadmap' })).toBeTruthy();
  });
});

describe('ProfileMenu', () => {
  /** Signs out through the menu; answers the options the shell gave the visit. */
  async function signOut() {
    render(<Shell>Inhalt</Shell>);
    await userEvent.click(within(sidebar()).getByRole('button', { name: /Mara Lindqvist/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Abmelden' }));
    expect(router.post).toHaveBeenCalledWith('/logout', {}, expect.any(Object));
    return vi.mocked(router.post).mock.calls[0]![2] as {
      onHttpException: (response: { status: number }) => boolean;
      onNetworkError: (error: Error) => boolean;
      onSuccess: () => void;
      onFinish: () => void;
    };
  }

  it('stops live updates and every fetch while signing out: nothing asks with a session that is ending', async () => {
    live.resume.mockClear();
    const options = await signOut();

    expect(pauseLive).toHaveBeenCalled();
    expect(onlineManager.isOnline()).toBe(false);
    const calls = api!.calls.length;
    await act(() => client.invalidateQueries());
    expect(api!.calls.length).toBe(calls);

    // the sign-in page is there (the cache of the person went with the visit): fetching may go on
    act(() => {
      options.onSuccess();
      options.onFinish();
    });
    expect(onlineManager.isOnline()).toBe(true);
    expect(live.resume).not.toHaveBeenCalled();
  });

  it('connects again and fetches again when signing out fails', async () => {
    live.resume.mockClear();
    const options = await signOut();

    act(() => {
      options.onNetworkError(new Error('offline'));
      options.onFinish();
    });
    expect(live.resume).toHaveBeenCalledTimes(1);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('names the status of the server when signing out is refused', async () => {
    const options = await signOut();

    act(() => expect(options.onHttpException({ status: 500 })).toBe(false));
    expect(currentToasts().map((entry) => [entry.title, entry.description])).toEqual([['Abmelden hat nicht geklappt', 'Der Server hat mit Status 500 geantwortet.']]);
  });

  it('says that the server did not answer when signing out gets no answer', async () => {
    const options = await signOut();

    act(() => expect(options.onNetworkError(new Error('offline'))).toBe(false));
    expect(currentToasts().map((entry) => [entry.title, entry.description])).toEqual([['Abmelden hat nicht geklappt', 'Der Server hat nicht geantwortet.']]);
  });

  it('asks before signing out with unsent text, and stays on "Weiterschreiben"', async () => {
    drafts.set('comment:wi_web_47', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halb fertig' }] }] });
    render(<Shell>Inhalt</Shell>);
    await userEvent.click(within(sidebar()).getByRole('button', { name: /Mara Lindqvist/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Abmelden' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Ungesendeten Text verwerfen?' });
    expect(router.post).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Weiterschreiben' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(sidebar()).getByRole('button', { name: /Mara Lindqvist/ })));
    expect(router.post).not.toHaveBeenCalled();
    expect(drafts.pending()).toEqual(['comment:wi_web_47']);

    // "Abmelden" in the dialog signs out
    await userEvent.click(within(sidebar()).getByRole('button', { name: /Mara Lindqvist/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Abmelden' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Trotzdem abmelden' }));
    expect(router.post).toHaveBeenCalledWith('/logout', {}, expect.any(Object));
  });

  it('asks with the keyboard in the compact menu and gives the focus back to its button (T18-M7)', async () => {
    drafts.set('comment:wi_web_47', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halb fertig' }] }] });
    const user = userEvent.setup();
    render(<ProfileMenu compact />);
    const button = screen.getByRole('button', { name: 'Profil von Mara Lindqvist' });
    act(() => button.focus());
    await user.keyboard('{Enter}');
    const signOut = await screen.findByRole('menuitem', { name: 'Abmelden' });
    // Base UI moves the focus into the menu a frame later
    await waitFor(() => expect(document.activeElement).not.toBe(button));
    act(() => signOut.focus());
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('alertdialog', { name: 'Ungesendeten Text verwerfen?' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Escape keeps the text and the focus goes back to the button that opened the menu
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(router.post).not.toHaveBeenCalled();
    expect(drafts.pending()).toEqual(['comment:wi_web_47']);
  });
});
